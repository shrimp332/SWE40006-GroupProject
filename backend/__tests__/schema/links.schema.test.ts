import dotEnv from "dotenv";
import { sql } from "kysely";
import { testDatabase } from "../../src/config/database.config";
import { resetTable } from "../../test-helpers/reset-table";

dotEnv.config();

const TARGET_URL = "https://example.com/a/very/long/path";

let ownerId: number;

beforeEach(async () => {
  // links and clicks get reset implicitly through cascade delete
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

async function insertLink(code = "abc1234"): Promise<number> {
  const link = await testDatabase
    .insertInto("links")
    .values({ code, target_url: TARGET_URL, owner_id: ownerId })
    .returning("id")
    .executeTakeFirstOrThrow();

  return link.id;
}

function insertClick(linkId: number) {
  return testDatabase.insertInto("clicks").values({ link_id: linkId }).execute();
}

function countRows(table: "links" | "clicks"): Promise<number> {
  return testDatabase
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .executeTakeFirstOrThrow()
    .then((row) => Number(row.count));
}

describe("links schema", () => {
  it("fills in the defaults for a new link", async () => {
    await insertLink();

    const link = await testDatabase.selectFrom("links").selectAll().executeTakeFirstOrThrow();

    expect(link.disabled).toEqual(false);
    expect(link.expires_at).toBeNull();
    expect(link.created_at).toBeInstanceOf(Date);
    expect(link.owner_id).toEqual(ownerId);
  });

  it("rejects a duplicate code at the database level", async () => {
    // Silences the Kysely error log for the deliberate failure below.
    const kyselyErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      await insertLink("duplicate");

      await expect(insertLink("duplicate")).rejects.toMatchObject({ code: "23505" }); // postgres unique violation
    } finally {
      kyselyErrorLog.mockRestore();
    }
  });

  it("rejects a link whose owner does not exist", async () => {
    const kyselyErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        testDatabase.insertInto("links").values({ code: "orphan1", target_url: TARGET_URL, owner_id: ownerId + 1000 }).execute(),
      ).rejects.toMatchObject({ code: "23503" }); // postgres foreign key violation
    } finally {
      kyselyErrorLog.mockRestore();
    }
  });

  it("drops a user's links and their clicks when the user is deleted", async () => {
    const linkId = await insertLink();
    await insertClick(linkId);

    await testDatabase.deleteFrom("users").where("id", "=", ownerId).execute();

    await expect(countRows("links")).resolves.toEqual(0);
    await expect(countRows("clicks")).resolves.toEqual(0);
  });
});

describe("clicks schema", () => {
  it("fills in clicked_at and leaves referrer and user_agent empty by default", async () => {
    const linkId = await insertLink();

    await insertClick(linkId);

    const click = await testDatabase.selectFrom("clicks").selectAll().executeTakeFirstOrThrow();

    expect(click.link_id).toEqual(linkId);
    expect(click.clicked_at).toBeInstanceOf(Date);
    expect(click.referrer).toBeNull();
    expect(click.user_agent).toBeNull();
  });

  it("rejects a click for a link that does not exist", async () => {
    const kyselyErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(insertClick(999_999)).rejects.toMatchObject({ code: "23503" }); // postgres foreign key violation
    } finally {
      kyselyErrorLog.mockRestore();
    }
  });

  it("drops a link's clicks when the link is deleted, and keeps other links' clicks", async () => {
    const doomed = await insertLink("doomed1");
    const kept = await insertLink("kept123");
    await insertClick(doomed);
    await insertClick(kept);

    await testDatabase.deleteFrom("links").where("id", "=", doomed).execute();

    const remaining = await testDatabase.selectFrom("clicks").select("link_id").execute();

    expect(remaining.map((click) => click.link_id)).toEqual([kept]);
  });
});

describe("time columns", () => {
  it("are timestamptz, so they do not depend on the machine's time zone", async () => {
    const result = await sql<{ table_name: string; column_name: string; data_type: string }>`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (('links', 'created_at'), ('links', 'expires_at'), ('clicks', 'clicked_at'))
      ORDER BY table_name, column_name
    `.execute(testDatabase);

    expect(result.rows).toEqual([
      { table_name: "clicks", column_name: "clicked_at", data_type: "timestamp with time zone" },
      { table_name: "links", column_name: "created_at", data_type: "timestamp with time zone" },
      { table_name: "links", column_name: "expires_at", data_type: "timestamp with time zone" },
    ]);
  });

  it("read back the same time that Node wrote", async () => {
    const linkId = await insertLink();
    const oneMinuteAgo = new Date(Date.now() - 60_000);

    await testDatabase.updateTable("links").set({ expires_at: oneMinuteAgo }).where("id", "=", linkId).execute();

    const link = await testDatabase.selectFrom("links").select("expires_at").where("id", "=", linkId).executeTakeFirstOrThrow();

    expect(link.expires_at!.getTime()).toEqual(oneMinuteAgo.getTime());
  });
});
