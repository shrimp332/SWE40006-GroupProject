import dotEnv from "dotenv";
import crypto = require("node:crypto"); // the real module object, a `* as` import wraps it in read-only getters that jest.spyOn can't replace
import {
  CODE_LENGTH,
  CODE_PATTERN,
  MAX_CODE_ATTEMPTS,
  STATS_TOP_LIMIT,
  createLink,
  deleteLink,
  generateCode,
  getLinkStats,
  listLinks,
  recordClick,
  regenerateCode,
  resolveCode,
  setDisabled,
} from "../../src/services/link.service";
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

  describe("when a generated code is already taken", () => {
    const TAKEN = "AAAAAAA";

    // Makes the next `calls` random characters all "A", so each 7 calls spell "AAAAAAA"
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

describe("resolveCode", () => {
  it("returns the id and destination of a live link", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);

    await expect(resolveCode(code, testDatabase)).resolves.toEqual({ id: expect.any(Number), target_url: TARGET_URL });
  });

  it("returns the link while its expiry is still in the future", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
    await testDatabase.updateTable("links").set({ expires_at: new Date(Date.now() + 86_400_000) }).execute();

    await expect(resolveCode(code, testDatabase)).resolves.not.toBeNull();
  });

  it("matches the code case-sensitively", async () => {
    await testDatabase.insertInto("links").values({ code: "AbCdEfG", target_url: TARGET_URL, owner_id: ownerId }).execute();

    await expect(resolveCode("AbCdEfG", testDatabase)).resolves.not.toBeNull();
    await expect(resolveCode("abcdefg", testDatabase)).resolves.toBeNull();
    await expect(resolveCode("ABCDEFG", testDatabase)).resolves.toBeNull();
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
});

describe("listLinks", () => {
  it("keeps newest-first order for links created at the same instant", async () => {
    const created = [];

    for (let i = 0; i < 5; i++) created.push(await createLink(ownerId, `https://example.com/${i}`, testDatabase));

    await testDatabase.updateTable("links").set({ created_at: new Date("2026-10-14T00:00:00Z") }).execute();

    const links = await listLinks(ownerId, testDatabase);

    expect(links.map((link) => link.code)).toEqual(created.map((link) => link.code).reverse());
  });
});

describe("setDisabled", () => {
  it("disables a link and returns it", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);

    const link = await setDisabled(ownerId, code, true, testDatabase);

    expect(link).toMatchObject({ code, target_url: TARGET_URL, disabled: true });
    await expect(resolveCode(code, testDatabase)).resolves.toBeNull();
  });
});

describe("regenerateCode", () => {
  const TAKEN = "AAAAAAA";

  function insertLinkWithCode(code: string, owner: number = ownerId) {
    return testDatabase.insertInto("links").values({ code, target_url: `https://example.com/${code}`, owner_id: owner }).execute();
  }

  function codesInDatabase(): Promise<string[]> {
    return testDatabase.selectFrom("links").select("code").orderBy("id").execute().then((rows) => rows.map((row) => row.code));
  }

  // Makes the next `calls` random characters all "A", so each 7 calls spell "AAAAAAA"
  function forceTakenCode(calls: number) {
    const randomInt = jest.spyOn(crypto, "randomInt") as unknown as jest.SpyInstance<number>;

    for (let i = 0; i < calls; i++) randomInt.mockReturnValueOnce(0);

    return randomInt;
  }

  it("changes only the code", async () => {
    const created = await createLink(ownerId, TARGET_URL, testDatabase);
    const before = await testDatabase.selectFrom("links").selectAll().executeTakeFirstOrThrow();

    const link = await regenerateCode(ownerId, created.code, testDatabase);

    const after = await testDatabase.selectFrom("links").selectAll().executeTakeFirstOrThrow();

    expect(after).toEqual({ ...before, code: link!.code });
    expect(link).toEqual({ ...created, code: link!.code });
    expect(Object.keys(link!).sort()).toEqual(["code", "created_at", "disabled", "expires_at", "target_url"]);
  });

  it("keeps a disabled link disabled", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
    await setDisabled(ownerId, code, true, testDatabase);

    const link = await regenerateCode(ownerId, code, testDatabase);

    expect(link!.disabled).toEqual(true);
    await expect(resolveCode(link!.code, testDatabase)).resolves.toBeNull();
  });

  describe("when the new code collides", () => {
    it("retries with another code when the new one is already taken", async () => {
      const kyselyErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});
      await insertLinkWithCode(TAKEN);
      const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
      const randomInt = forceTakenCode(CODE_LENGTH); // first attempt spells the taken code, later ones are random

      try {
        const link = await regenerateCode(ownerId, code, testDatabase);

        expect(link!.code).not.toEqual(TAKEN);
        expect(link!.code).not.toEqual(code);
        await expect(codesInDatabase()).resolves.toEqual(expect.arrayContaining([TAKEN, link!.code]));
      } finally {
        randomInt.mockRestore();
        kyselyErrorLog.mockRestore();
      }
    });

    it("never hands back the code the link already has", async () => {
      await insertLinkWithCode(TAKEN);
      const randomInt = forceTakenCode(CODE_LENGTH); // first attempt spells the current code

      try {
        const link = await regenerateCode(ownerId, TAKEN, testDatabase);

        expect(link!.code).not.toEqual(TAKEN);
      } finally {
        randomInt.mockRestore();
      }
    });

    it("gives up with the unique violation after the maximum number of attempts and keeps the old code", async () => {
      const kyselyErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});
      await insertLinkWithCode(TAKEN);
      const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
      const randomInt = forceTakenCode(CODE_LENGTH * MAX_CODE_ATTEMPTS); // every attempt collides

      try {
        await expect(regenerateCode(ownerId, code, testDatabase)).rejects.toMatchObject({ code: "23505" });
        await expect(codesInDatabase()).resolves.toEqual([TAKEN, code]);
      } finally {
        randomInt.mockRestore();
        kyselyErrorLog.mockRestore();
      }
    });
  });
});

describe("deleteLink", () => {
  function codesInDatabase(): Promise<string[]> {
    return testDatabase.selectFrom("links").select("code").orderBy("id").execute().then((rows) => rows.map((row) => row.code));
  }

  it("deletes the link and returns true", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);

    await expect(deleteLink(ownerId, code, testDatabase)).resolves.toEqual(true);
    await expect(codesInDatabase()).resolves.toEqual([]);
  });
});

describe("getLinkStats", () => {
  /** Adds clicks to a link, each with its own referrer, user agent and time (the click time defaults to now). */
  async function addClicks(code: string, clicks: { referrer?: string | null; user_agent?: string | null; at?: string }[]) {
    const { id } = await testDatabase.selectFrom("links").select("id").where("code", "=", code).executeTakeFirstOrThrow();

    for (const click of clicks) {
      await testDatabase
        .insertInto("clicks")
        .values({
          link_id: id,
          referrer: click.referrer ?? null,
          user_agent: click.user_agent ?? null,
          ...(click.at ? { clicked_at: new Date(click.at) } : {}),
        })
        .execute();
    }
  }

  it("counts every click and returns the numbers as numbers", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
    await addClicks(code, [{}, {}, {}, {}]);

    const stats = (await getLinkStats(ownerId, code, testDatabase))!;

    expect(stats.total_clicks).toBe(4);
    expect(stats.clicks_per_day.map((day) => typeof day.clicks)).toEqual(["number"]);
  });

  it("groups clicks by UTC day, oldest first", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
    await addClicks(code, [
      { at: "2026-10-14T00:30:00Z" },
      { at: "2026-10-13T23:30:00Z" }, // just before midnight UTC, so the day before
      { at: "2026-10-14T23:59:59Z" },
      { at: "2026-10-16T12:00:00Z" },
    ]);

    const stats = (await getLinkStats(ownerId, code, testDatabase))!;

    expect(stats.clicks_per_day).toEqual([
      { date: "2026-10-13", clicks: 1 },
      { date: "2026-10-14", clicks: 2 },
      { date: "2026-10-16", clicks: 1 },
    ]);
    expect(stats.total_clicks).toBe(4);
  });

  it("lists referrers by number of clicks, most first, with direct visits as null", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
    await addClicks(code, [
      { referrer: "https://b.example" },
      { referrer: "https://a.example" },
      { referrer: "https://a.example" },
      { referrer: null },
      { referrer: null },
      { referrer: null },
    ]);

    const stats = (await getLinkStats(ownerId, code, testDatabase))!;

    expect(stats.referrers).toEqual([
      { referrer: null, clicks: 3 },
      { referrer: "https://a.example", clicks: 2 },
      { referrer: "https://b.example", clicks: 1 },
    ]);
  });

  it("lists user agents by number of clicks, most first", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
    await addClicks(code, [
      { user_agent: "Safari" },
      { user_agent: "Chrome" },
      { user_agent: "Chrome" },
      { user_agent: null },
    ]);

    const stats = (await getLinkStats(ownerId, code, testDatabase))!;

    expect(stats.user_agents).toEqual([
      { user_agent: "Chrome", clicks: 2 },
      { user_agent: "Safari", clicks: 1 },
      { user_agent: null, clicks: 1 },
    ]);
  });

  it("orders ties the same way every time", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
    await addClicks(code, [{ referrer: "https://c.example" }, { referrer: "https://a.example" }, { referrer: "https://b.example" }]);

    const first = (await getLinkStats(ownerId, code, testDatabase))!.referrers;
    const second = (await getLinkStats(ownerId, code, testDatabase))!.referrers;

    expect(first.map((row) => row.referrer)).toEqual(["https://a.example", "https://b.example", "https://c.example"]);
    expect(second).toEqual(first);
  });

  it("returns only the top referrers and user agents", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
    const clicks = Array.from({ length: STATS_TOP_LIMIT + 2 }, (_, i) => ({ referrer: `https://site-${i}.example`, user_agent: `Agent ${i}` }));
    await addClicks(code, clicks);
    await addClicks(code, [{ referrer: "https://site-0.example", user_agent: "Agent 0" }]); // site-0 and Agent 0 are now the busiest

    const stats = (await getLinkStats(ownerId, code, testDatabase))!;

    expect(stats.referrers).toHaveLength(STATS_TOP_LIMIT);
    expect(stats.referrers[0]).toEqual({ referrer: "https://site-0.example", clicks: 2 });
    expect(stats.user_agents).toHaveLength(STATS_TOP_LIMIT);
    expect(stats.user_agents[0]).toEqual({ user_agent: "Agent 0", clicks: 2 });
    expect(stats.total_clicks).toBe(STATS_TOP_LIMIT + 3); // the totals still count everything
  });

  it("still works for a disabled link", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
    await addClicks(code, [{}, {}]);
    await setDisabled(ownerId, code, true, testDatabase);

    await expect(getLinkStats(ownerId, code, testDatabase)).resolves.toMatchObject({ total_clicks: 2 });
  });

  it("keeps the history after the code is regenerated", async () => {
    const { code } = await createLink(ownerId, TARGET_URL, testDatabase);
    await addClicks(code, [{}, {}, {}]);

    const newCode = (await regenerateCode(ownerId, code, testDatabase))!.code;

    await expect(getLinkStats(ownerId, newCode, testDatabase)).resolves.toMatchObject({ code: newCode, total_clicks: 3 });
    await expect(getLinkStats(ownerId, code, testDatabase)).resolves.toBeNull();
  });
});
