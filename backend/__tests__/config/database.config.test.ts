import dotEnv from "dotenv";
import { sql } from "kysely";
import { types } from "pg";
import { testDatabase } from "../../src/config/database.config";
import { createLink, recordClick, resolveCode } from "../../src/services/link.service";
import { resetTable } from "../../test-helpers/reset-table";

dotEnv.config();

let ownerId: number;

beforeEach(async () => {
  await resetTable("users");

  const user = await testDatabase
    .insertInto("users")
    .values({ email: "owner@example.com", password_hash: "not-a-real-hash" })
    .returning("id")
    .executeTakeFirstOrThrow();

  ownerId = user.id;
});

afterEach(async () => {
  await resetTable("users");
});

/** The database's own clock, read as a timestamptz so it is always the true instant. */
async function databaseNow(): Promise<Date> {
  const row = await sql<{ now: Date }>`SELECT NOW() AS now`.execute(testDatabase);

  return row.rows[0].now;
}

describe("reading a plain timestamp", () => {
  const readTimestamp = types.getTypeParser(types.builtins.TIMESTAMP) as (value: string) => Date;

  it.each([
    ["with microseconds", "2026-10-14 06:19:38.766673", "2026-10-14T06:19:38.766Z"],
    ["with milliseconds", "2026-10-14 06:19:38.766", "2026-10-14T06:19:38.766Z"],
    ["without a fraction", "2026-10-14 06:19:38", "2026-10-14T06:19:38.000Z"],
    ["around midnight", "2026-12-31 23:59:59.5", "2026-12-31T23:59:59.500Z"],
  ])("treats the stored value as UTC, %s", (_name, stored, expected) => {
    expect(readTimestamp(stored).toISOString()).toEqual(expected);
  });
});

describe("writing a Node date to a plain timestamp", () => {
  it.each([
    ["2026-10-14T06:19:38.766Z", "2026-10-14 06:19:38.766"],
    ["2026-01-01T00:00:00.000Z", "2026-01-01 00:00:00"], // Postgres prints no trailing zeros
    ["2026-07-15T23:59:59.999Z", "2026-07-15 23:59:59.999"],
  ])("stores %s as the same UTC clock reading", async (iso, expectedText) => {
    const result = await sql<{ stored: string }>`SELECT ${new Date(iso)}::timestamp::text AS stored`.execute(testDatabase);

    expect(result.rows[0].stored).toEqual(expectedText);
  });
});

describe("plain timestamp columns end to end", () => {
  it("reads created_at as the moment the database stored it", async () => {
    const link = await createLink(ownerId, "https://example.com/a", testDatabase);

    expect(Math.abs(link.created_at.getTime() - (await databaseNow()).getTime())).toBeLessThan(10_000);
  });

  it("reads clicked_at as the moment the database stored it", async () => {
    await createLink(ownerId, "https://example.com/a", testDatabase);
    const { id } = await testDatabase.selectFrom("links").select("id").executeTakeFirstOrThrow();

    await recordClick(id, undefined, undefined, testDatabase);

    const click = await testDatabase.selectFrom("clicks").select("clicked_at").executeTakeFirstOrThrow();

    expect(Math.abs(click.clicked_at.getTime() - (await databaseNow()).getTime())).toBeLessThan(10_000);
  });

  it("writes a Node date as the same moment and reads the same value back", async () => {
    const { code } = await createLink(ownerId, "https://example.com/a", testDatabase);
    const oneMinuteAgo = new Date(Date.now() - 60_000);

    await testDatabase.updateTable("links").set({ expires_at: oneMinuteAgo }).where("code", "=", code).execute();

    const link = await testDatabase.selectFrom("links").select("expires_at").where("code", "=", code).executeTakeFirstOrThrow();

    expect(link.expires_at!.getTime()).toEqual(oneMinuteAgo.getTime());
    // The database compares expires_at against its own NOW(), so it must also see this as a past moment.
    await expect(resolveCode(code, testDatabase)).resolves.toBeNull();
  });

  it("keeps a link alive whose Node-written expiry is still in the future", async () => {
    const { code } = await createLink(ownerId, "https://example.com/a", testDatabase);

    await testDatabase.updateTable("links").set({ expires_at: new Date(Date.now() + 60_000) }).where("code", "=", code).execute();

    await expect(resolveCode(code, testDatabase)).resolves.not.toBeNull();
  });
});

describe("timestamptz columns are unaffected", () => {
  it("still reads users.created_at as the true moment", async () => {
    const user = await testDatabase.selectFrom("users").select("created_at").executeTakeFirstOrThrow();

    expect(Math.abs(user.created_at!.getTime() - (await databaseNow()).getTime())).toBeLessThan(10_000);
  });
});
