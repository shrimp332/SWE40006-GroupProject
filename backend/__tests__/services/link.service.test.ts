import dotEnv from "dotenv";
import crypto = require("node:crypto"); // the real module object, a `* as` import wraps it in read-only getters that jest.spyOn can't replace
import { CODE_LENGTH, CODE_PATTERN, MAX_CODE_ATTEMPTS, createLink, generateCode } from "../../src/services/link.service";
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
