import dotEnv from "dotenv";
import crypto = require("node:crypto"); // the real module object, a `* as` import wraps it in read-only getters that jest.spyOn can't replace
import { sql } from "kysely";
import { CODE_LENGTH, CODE_PATTERN, MAX_CODE_ATTEMPTS, createLink, generateCode, listLinks, recordClick, resolveCode } from "../../src/services/link.service";
import { testDatabase } from "../../src/config/database.config";
import { resetTable } from "../../test-helpers/reset-table";

dotEnv.config();

const TARGET_URL = "https://example.com/a/very/long/path?with=query";

let ownerId: number;

beforeEach(async () => {
  // links get reset implicitly through cascade delete
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

function countLinks(): Promise<number> {
  return testDatabase
    .selectFrom("links")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .executeTakeFirstOrThrow()
    .then((row) => Number(row.count));
}

describe("generateCode", () => {
  it("returns seven letters or digits", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();

      expect(code).toHaveLength(CODE_LENGTH);
      expect(code).toMatch(CODE_PATTERN);
    }
  });

  it("does not repeat itself", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateCode()));

    expect(codes.size).toEqual(500);
  });
});

describe("createLink", () => {
  it("stores the link against the owner and returns it", async () => {
    const link = await createLink(ownerId, TARGET_URL, testDatabase);

    expect(link.code).toMatch(CODE_PATTERN);
    expect(link.target_url).toEqual(TARGET_URL);
    expect(link.disabled).toEqual(false);
    expect(link.expires_at).toBeNull();
    expect(link.created_at).toBeInstanceOf(Date);

    const row = await testDatabase.selectFrom("links").select(["code", "target_url", "owner_id"]).executeTakeFirstOrThrow();

    expect(row).toEqual({ code: link.code, target_url: TARGET_URL, owner_id: ownerId });
  });

  it("gives two links to the same url different codes", async () => {
    const first = await createLink(ownerId, TARGET_URL, testDatabase);
    const second = await createLink(ownerId, TARGET_URL, testDatabase);

    expect(first.code).not.toEqual(second.code);
    await expect(countLinks()).resolves.toEqual(2);
  });

  it("does not return the owner or the internal id", async () => {
    const link = await createLink(ownerId, TARGET_URL, testDatabase);

    expect(Object.keys(link).sort()).toEqual(["code", "created_at", "disabled", "expires_at", "target_url"]);
  });

  it("stores a long url unchanged", async () => {
    const longUrl = `https://example.com/${"a".repeat(2000)}?q=1&r=%20two#frag`;

    const link = await createLink(ownerId, longUrl, testDatabase);

    expect(link.target_url).toEqual(longUrl);
  });

  it("rejects an owner that does not exist and stores nothing", async () => {
    // Silences the Kysely error log for the deliberate failure below.
    const kyselyErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(createLink(ownerId + 1000, TARGET_URL, testDatabase)).rejects.toMatchObject({ code: "23503" }); // postgres foreign key violation
      await expect(countLinks()).resolves.toEqual(0);
    } finally {
      kyselyErrorLog.mockRestore();
    }
  });

  describe("when a generated code is already taken", () => {
    const TAKEN = "AAAAAAA";

    // Makes the next `calls` characters all index 0, which spells out "AAAAAAA".
    function forceTakenCode(calls: number) {
      const randomInt = jest.spyOn(crypto, "randomInt") as unknown as jest.SpyInstance<number>;

      for (let i = 0; i < calls; i++) randomInt.mockReturnValueOnce(0);

      return randomInt;
    }

    async function insertTakenLink() {
      await testDatabase.insertInto("links").values({ code: TAKEN, target_url: "https://example.com/first", owner_id: ownerId }).execute();
    }

    it("retries with a new code and succeeds", async () => {
      const kyselyErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});
      await insertTakenLink();
      const randomInt = forceTakenCode(CODE_LENGTH); // first attempt collides, later ones are random

      try {
        const link = await createLink(ownerId, TARGET_URL, testDatabase);

        expect(link.code).not.toEqual(TAKEN);
        expect(link.code).toMatch(CODE_PATTERN);
        await expect(countLinks()).resolves.toEqual(2);
      } finally {
        randomInt.mockRestore();
        kyselyErrorLog.mockRestore();
      }
    });

    it("gives up with the unique violation after the maximum number of attempts", async () => {
      const kyselyErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});
      await insertTakenLink();
      const randomInt = forceTakenCode(CODE_LENGTH * MAX_CODE_ATTEMPTS); // every attempt collides

      try {
        await expect(createLink(ownerId, TARGET_URL, testDatabase)).rejects.toMatchObject({ code: "23505" });
        await expect(countLinks()).resolves.toEqual(1);
      } finally {
        randomInt.mockRestore();
        kyselyErrorLog.mockRestore();
      }
    });
  });
});

function setExpiry(offset: "-1 minute" | "+1 minute") {
  return testDatabase
    .updateTable("links")
    .set({ expires_at: sql<Date>`NOW() + ${offset}::interval` })
    .execute();
}

function countClicks(): Promise<number> {
  return testDatabase
    .selectFrom("clicks")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .executeTakeFirstOrThrow()
    .then((row) => Number(row.count));
}

describe("resolveCode", () => {
  it("returns the id and destination of a live link", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);

    await expect(resolveCode(code, testDatabase)).resolves.toEqual({ id: expect.any(Number), target_url: TARGET_URL });
  });

  it("returns null for a code that does not exist", async () => {
    await createLink(ownerId, TARGET_URL, testDatabase);

    await expect(resolveCode("Nope123", testDatabase)).resolves.toBeNull();
  });

  it("returns null for a disabled link and the link again once it is enabled", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);

    await testDatabase.updateTable("links").set({ disabled: true }).execute();
    await expect(resolveCode(code, testDatabase)).resolves.toBeNull();

    await testDatabase.updateTable("links").set({ disabled: false }).execute();
    await expect(resolveCode(code, testDatabase)).resolves.not.toBeNull();
  });

  it("returns null for an expired link", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
    await setExpiry("-1 minute");

    await expect(resolveCode(code, testDatabase)).resolves.toBeNull();
  });

  it("returns the link while its expiry is still in the future", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
    await setExpiry("+1 minute");

    await expect(resolveCode(code, testDatabase)).resolves.not.toBeNull();
  });

  it("matches the code case-sensitively", async () => {
    await testDatabase.insertInto("links").values({ code: "AbCdEfG", target_url: TARGET_URL, owner_id: ownerId }).execute();

    await expect(resolveCode("AbCdEfG", testDatabase)).resolves.not.toBeNull();
    await expect(resolveCode("abcdefg", testDatabase)).resolves.toBeNull();
    await expect(resolveCode("ABCDEFG", testDatabase)).resolves.toBeNull();
  });

  it("finds the right link when several exist", async () => {
    const first = await createLink(ownerId, "https://example.com/first", testDatabase);
    const second = await createLink(ownerId, "https://example.com/second", testDatabase);

    await expect(resolveCode(first.code, testDatabase)).resolves.toMatchObject({ target_url: "https://example.com/first" });
    await expect(resolveCode(second.code, testDatabase)).resolves.toMatchObject({ target_url: "https://example.com/second" });
  });
});

describe("recordClick", () => {
  async function linkId(): Promise<number> {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);

    return (await resolveCode(code, testDatabase))!.id;
  }

  it("stores the referrer and user agent against the link", async () => {
    const id = await linkId();

    await recordClick(id, "https://social.example/post", "Mozilla/5.0 (test)", testDatabase);

    const click = await testDatabase.selectFrom("clicks").selectAll().executeTakeFirstOrThrow();

    expect(click.link_id).toEqual(id);
    expect(click.referrer).toEqual("https://social.example/post");
    expect(click.user_agent).toEqual("Mozilla/5.0 (test)");
    expect(click.clicked_at).toBeInstanceOf(Date);
  });

  it("stores null when the headers are missing", async () => {
    const id = await linkId();

    await recordClick(id, undefined, undefined, testDatabase);

    const click = await testDatabase.selectFrom("clicks").selectAll().executeTakeFirstOrThrow();

    expect(click.referrer).toBeNull();
    expect(click.user_agent).toBeNull();
  });

  it("adds a row for every call", async () => {
    const id = await linkId();

    await recordClick(id, undefined, undefined, testDatabase);
    await recordClick(id, undefined, undefined, testDatabase);

    await expect(countClicks()).resolves.toEqual(2);
  });

  it("rejects a link that does not exist and stores nothing", async () => {
    // Silences the Kysely error log for the deliberate failure below.
    const kyselyErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(recordClick(999_999, undefined, undefined, testDatabase)).rejects.toMatchObject({ code: "23503" }); // postgres foreign key violation
      await expect(countClicks()).resolves.toEqual(0);
    } finally {
      kyselyErrorLog.mockRestore();
    }
  });
});

describe("listLinks", () => {
  async function insertOtherUser(): Promise<number> {
    const user = await testDatabase
      .insertInto("users")
      .values({ email: "other@example.com", password_hash: "not-a-real-hash" })
      .returning("id")
      .executeTakeFirstOrThrow();

    return user.id;
  }

  it("returns only the owner's links, newest first", async () => {
    const otherId = await insertOtherUser();
    const older = await createLink(ownerId, "https://example.com/older", testDatabase);
    const newer = await createLink(ownerId, "https://example.com/newer", testDatabase);
    await createLink(otherId, "https://example.com/not-mine", testDatabase);

    const links = await listLinks(ownerId, testDatabase);

    expect(links.map((link) => link.code)).toEqual([newer.code, older.code]);
  });

  it("returns the same fields as createLink and nothing else", async () => {
    const created = await createLink(ownerId, TARGET_URL, testDatabase);

    const [listed] = await listLinks(ownerId, testDatabase);

    expect(listed).toEqual(created);
    expect(Object.keys(listed).sort()).toEqual(["code", "created_at", "disabled", "expires_at", "target_url"]);
  });

  it("returns an empty list when the user has no links", async () => {
    const otherId = await insertOtherUser();
    await createLink(otherId, TARGET_URL, testDatabase);

    await expect(listLinks(ownerId, testDatabase)).resolves.toEqual([]);
  });

  it("includes disabled and expired links so the owner can manage them", async () => {
    const disabled = await createLink(ownerId, "https://example.com/disabled", testDatabase);
    const expired = await createLink(ownerId, "https://example.com/expired", testDatabase);
    await testDatabase.updateTable("links").set({ disabled: true }).where("code", "=", disabled.code).execute();
    await testDatabase.updateTable("links").set({ expires_at: sql<Date>`NOW() - INTERVAL '1 minute'` }).where("code", "=", expired.code).execute();

    const links = await listLinks(ownerId, testDatabase);

    expect(links).toHaveLength(2);
    expect(links.find((link) => link.code === disabled.code)).toMatchObject({ disabled: true });
    expect(links.find((link) => link.code === expired.code)?.expires_at).toBeInstanceOf(Date);
  });

  it("keeps a stable newest-first order for links created in quick succession", async () => {
    const created = [];

    for (let i = 0; i < 5; i++) created.push(await createLink(ownerId, `https://example.com/${i}`, testDatabase));

    const links = await listLinks(ownerId, testDatabase);

    expect(links.map((link) => link.code)).toEqual(created.map((link) => link.code).reverse());
  });
});
