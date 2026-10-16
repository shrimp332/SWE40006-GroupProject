import dotEnv from "dotenv";
import { superRequestAgent } from "../../test-helpers/after-global-setup";
import { resetTable } from "../../test-helpers/reset-table";
import { testDatabase } from "../../src/config/database.config";
import { SESSION_COOKIE } from "../../src/middlewares/auth.middleware";
import * as linkService from "../../src/services/link.service";
import { CODE_PATTERN } from "../../src/services/link.service";

dotEnv.config();

const EMAIL = "owner@example.com";
const PASSWORD = "password";
const TARGET_URL = "https://example.com/a/very/long/path?with=query";

let cookie: string;

beforeEach(async () => {
  await resetTable("users");

  cookie = await signUp(EMAIL);
});

afterEach(async () => {
  await resetTable("users");
});

/** Registers and logs in, returns the Cookie header value. */
async function signUp(email: string): Promise<string> {
  await superRequestAgent.post("/api/register").send({ email, password: PASSWORD });
  const response = await superRequestAgent.post("/api/login").send({ email, password: PASSWORD });
  const setCookie = (response.headers["set-cookie"] as unknown as string[]).find((value) => value.startsWith(`${SESSION_COOKIE}=`))!;

  return setCookie.split(";")[0];
}

function createLink(body: object, withCookie: string | null = cookie) {
  const request = superRequestAgent.post("/api/links");

  return (withCookie ? request.set("Cookie", withCookie) : request).send(body);
}

function allLinks() {
  return testDatabase.selectFrom("links").selectAll().execute();
}

describe("POST /api/links", () => {
  it("responds 201 with the new link", async () => {
    const response = await createLink({ url: TARGET_URL });

    expect(response.statusCode).toEqual(201);
    expect(response.body.code).toMatch(CODE_PATTERN);
    expect(response.body.target_url).toEqual(TARGET_URL);
    expect(response.body.disabled).toEqual(false);
    expect(response.body.expires_at).toBeNull();
    expect(Object.keys(response.body).sort()).toEqual(["code", "created_at", "disabled", "expires_at", "target_url"]);
  });

  it("stores the link against the logged-in user", async () => {
    const response = await createLink({ url: TARGET_URL });

    const user = await testDatabase.selectFrom("users").select("id").where("email", "=", EMAIL).executeTakeFirstOrThrow();
    const row = await testDatabase.selectFrom("links").select(["code", "owner_id"]).executeTakeFirstOrThrow();

    expect(row).toEqual({ code: response.body.code, owner_id: user.id });
  });

  it("accepts a url at the 2048 character limit", async () => {
    const url = `https://example.com/${"a".repeat(2048 - "https://example.com/".length)}`;

    const response = await createLink({ url });

    expect(url).toHaveLength(2048);
    expect(response.statusCode).toEqual(201);
  });

  it.each([
    ["url is missing", {}],
    ["url is not a url", { url: "not a url" }],
    ["url uses javascript:", { url: "javascript:alert(1)" }],
    ["url uses data:", { url: "data:text/html,<script>alert(1)</script>" }],
    ["url uses ftp:", { url: "ftp://example.com/file" }],
    ["url is longer than 2048 characters", { url: `https://example.com/${"a".repeat(2049)}` }],
    ["body has unknown fields", { url: TARGET_URL, code: "custom1" }],
  ])("responds 400 and stores nothing when %s", async (_name, body) => {
    const response = await createLink(body);

    expect(response.statusCode).toEqual(400);
    expect(response.body.error).toEqual("Invalid data");
    await expect(allLinks()).resolves.toEqual([]);
  });

  it("redirects to /login without a session cookie and stores nothing", async () => {
    const response = await createLink({ url: TARGET_URL }, null);

    expect(response.statusCode).toEqual(302);
    expect(response.headers.location).toEqual("/login");
    await expect(allLinks()).resolves.toEqual([]);
  });

  it("redirects to /login for a cookie that matches no session and stores nothing", async () => {
    const response = await createLink({ url: TARGET_URL }, `${SESSION_COOKIE}=not-a-real-cookie`);

    expect(response.statusCode).toEqual(302);
    expect(response.headers.location).toEqual("/login");
    await expect(allLinks()).resolves.toEqual([]);
  });

  it("responds 500 when saving fails", async () => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const createLinkSpy = jest.spyOn(linkService, "createLink").mockRejectedValue(new Error("database down"));

    try {
      const response = await createLink({ url: TARGET_URL });

      expect(response.statusCode).toEqual(500);
      expect(createLinkSpy).toHaveBeenCalledTimes(1);
    } finally {
      createLinkSpy.mockRestore();
      errorLog.mockRestore();
    }
  });
});

async function createdCode(url = TARGET_URL): Promise<string> {
  const response = await createLink({ url });

  return response.body.code;
}

function countClicks(): Promise<number> {
  return testDatabase
    .selectFrom("clicks")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .executeTakeFirstOrThrow()
    .then((row) => Number(row.count));
}

describe("GET /x/:code", () => {
  it("responds 302 to the destination without needing a session", async () => {
    const code = await createdCode();

    const response = await superRequestAgent.get(`/x/${code}`); // no cookie: visitors are not logged in

    expect(response.statusCode).toEqual(302);
    expect(response.headers.location).toEqual(TARGET_URL);
  });

  it("redirects to the stored url unchanged, query string included", async () => {
    const url = "https://example.com/path?a=1&b=two%20words&c=%E2%9C%93#section";
    const code = await createdCode(url);

    const response = await superRequestAgent.get(`/x/${code}`);

    expect(response.headers.location).toEqual(url);
  });

  it("records the click with the referrer and user agent", async () => {
    const code = await createdCode();

    await superRequestAgent.get(`/x/${code}`).set("Referer", "https://social.example/post").set("User-Agent", "Mozilla/5.0 (test)");

    const click = await testDatabase.selectFrom("clicks").select(["referrer", "user_agent"]).executeTakeFirstOrThrow();

    expect(click).toEqual({ referrer: "https://social.example/post", user_agent: "Mozilla/5.0 (test)" });
  });

  it("responds 404 and records nothing for a code that does not exist", async () => {
    const response = await superRequestAgent.get("/x/Nope123");

    expect(response.statusCode).toEqual(404);
    expect(response.headers.location).toBeUndefined();
    await expect(countClicks()).resolves.toEqual(0);
  });

  it("responds 404 and records nothing for a disabled link, and redirects again once it is enabled", async () => {
    const code = await createdCode();

    await testDatabase.updateTable("links").set({ disabled: true }).execute();
    const disabled = await superRequestAgent.get(`/x/${code}`);

    expect(disabled.statusCode).toEqual(404);
    await expect(countClicks()).resolves.toEqual(0);

    await testDatabase.updateTable("links").set({ disabled: false }).execute();

    expect((await superRequestAgent.get(`/x/${code}`)).statusCode).toEqual(302);
  });

  it("responds 404 and records nothing for an expired link", async () => {
    const code = await createdCode();
    await testDatabase.updateTable("links").set({ expires_at: new Date(Date.now() - 86_400_000) }).execute();

    const response = await superRequestAgent.get(`/x/${code}`);

    expect(response.statusCode).toEqual(404);
    await expect(countClicks()).resolves.toEqual(0);
  });

  it.each([
    ["too short", "abc"],
    ["a file name", "favicon.ico"],
  ])("responds 404 without querying the database when the code is %s", async (_name, code) => {
    const resolveCode = jest.spyOn(linkService, "resolveCode");

    try {
      const response = await superRequestAgent.get(`/x/${code}`);

      expect(response.statusCode).toEqual(404);
      expect(resolveCode).not.toHaveBeenCalled();
    } finally {
      resolveCode.mockRestore();
    }
  });

  it("still redirects when recording the click fails", async () => {
    const code = await createdCode();
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const recordClick = jest.spyOn(linkService, "recordClick").mockRejectedValue(new Error("analytics down"));

    try {
      const response = await superRequestAgent.get(`/x/${code}`);

      expect(recordClick).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toEqual(302);
      expect(response.headers.location).toEqual(TARGET_URL);
    } finally {
      recordClick.mockRestore();
      errorLog.mockRestore();
    }
  });

  it("responds 500 when looking up the code fails", async () => {
    const code = await createdCode();
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const resolveCode = jest.spyOn(linkService, "resolveCode").mockRejectedValue(new Error("database down"));

    try {
      const response = await superRequestAgent.get(`/x/${code}`);

      expect(response.statusCode).toEqual(500);
      expect(response.headers.location).toBeUndefined();
    } finally {
      resolveCode.mockRestore();
      errorLog.mockRestore();
    }
  });

  it("does not shadow the existing routes", async () => {
    const health = await superRequestAgent.get("/health");

    expect(health.statusCode).toEqual(200);
    expect(health.text).toEqual("HEALTHY");
  });
});

function listLinks(withCookie: string | null = cookie) {
  const request = superRequestAgent.get("/api/links");

  return withCookie ? request.set("Cookie", withCookie) : request;
}

describe("GET /api/links", () => {
  it("responds 200 with the caller's links, newest first", async () => {
    const first = await createdCode("https://example.com/first");
    const second = await createdCode("https://example.com/second");

    const response = await listLinks();

    expect(response.statusCode).toEqual(200);
    expect(response.body.map((link: { code: string }) => link.code)).toEqual([second, first]);
  });

  it("each user sees only their own links when both have some", async () => {
    const otherCookie = await signUp("other@example.com");
    const mine = await createdCode("https://example.com/mine");
    const theirs = (await createLink({ url: "https://example.com/theirs" }, otherCookie)).body.code;

    const myList = await listLinks();
    const theirList = await listLinks(otherCookie);

    expect(myList.body.map((link: { code: string }) => link.code)).toEqual([mine]);
    expect(theirList.body.map((link: { code: string }) => link.code)).toEqual([theirs]);
  });

  it("responds 200 with an empty list when the user has no links", async () => {
    const response = await listLinks();

    expect(response.statusCode).toEqual(200);
    expect(response.body).toEqual([]);
  });

  it("includes disabled and expired links", async () => {
    const disabled = await createdCode("https://example.com/disabled");
    const expired = await createdCode("https://example.com/expired");
    await testDatabase.updateTable("links").set({ disabled: true }).where("code", "=", disabled).execute();
    await testDatabase.updateTable("links").set({ expires_at: new Date(Date.now() - 86_400_000) }).where("code", "=", expired).execute();

    const response = await listLinks();

    expect(response.body).toHaveLength(2);
    expect(response.body.find((link: { code: string }) => link.code === disabled).disabled).toEqual(true);
    expect(response.body.find((link: { code: string }) => link.code === expired).expires_at).not.toBeNull();
  });

  it("redirects to /login without a session cookie", async () => {
    await createdCode();

    const response = await listLinks(null);

    expect(response.statusCode).toEqual(302);
    expect(response.headers.location).toEqual("/login");
  });

});

function patchLink(code: string, body: object, withCookie: string | null = cookie) {
  const request = superRequestAgent.patch(`/api/links/${code}`);

  return (withCookie ? request.set("Cookie", withCookie) : request).send(body);
}

function storedLink(code: string) {
  return testDatabase.selectFrom("links").selectAll().where("code", "=", code).executeTakeFirstOrThrow();
}

describe("PATCH /api/links/:code", () => {
  it("responds 200 with the disabled link and its short link stops redirecting", async () => {
    const code = await createdCode();

    const response = await patchLink(code, { disabled: true });

    expect(response.statusCode).toEqual(200);
    expect(response.body).toMatchObject({ code, target_url: TARGET_URL, disabled: true });
    expect((await superRequestAgent.get(`/x/${code}`)).statusCode).toEqual(404);
  });

  it("enables the link again and its short link redirects again", async () => {
    const code = await createdCode();
    await patchLink(code, { disabled: true });

    const response = await patchLink(code, { disabled: false });

    expect(response.statusCode).toEqual(200);
    expect(response.body.disabled).toEqual(false);

    const redirect = await superRequestAgent.get(`/x/${code}`);

    expect(redirect.statusCode).toEqual(302);
    expect(redirect.headers.location).toEqual(TARGET_URL);
  });

  it("changes only the disabled flag and only on that link", async () => {
    const target = await createdCode("https://example.com/target");
    const other = await createdCode("https://example.com/other");
    const before = await storedLink(target);

    await patchLink(target, { disabled: true });

    expect(await storedLink(target)).toEqual({ ...before, disabled: true });
    expect((await storedLink(other)).disabled).toEqual(false);
    expect((await superRequestAgent.get(`/x/${other}`)).statusCode).toEqual(302);
  });

  it("responds 404 for a code that does not exist", async () => {
    const response = await patchLink("Nope123", { disabled: true });

    expect(response.statusCode).toEqual(404);
    expect(response.body).toEqual({ error: "Link not found" });
  });

  it("responds 404 and changes nothing for another user's link", async () => {
    const otherCookie = await signUp("other@example.com");
    const code = (await createLink({ url: TARGET_URL }, otherCookie)).body.code;

    const response = await patchLink(code, { disabled: true });

    expect(response.statusCode).toEqual(404);
    expect(response.body).toEqual({ error: "Link not found" }); // same 404 as a missing code
    expect((await storedLink(code)).disabled).toEqual(false);
    expect((await superRequestAgent.get(`/x/${code}`)).statusCode).toEqual(302);
  });

  it.each([
    ["disabled is missing", {}],
    ["disabled is a string", { disabled: "true" }],
    ["body tries to change the destination", { disabled: true, target_url: "https://evil.example" }],
  ])("responds 400 and changes nothing when %s", async (_name, body) => {
    const code = await createdCode();
    const before = await storedLink(code);

    const response = await patchLink(code, body);

    expect(response.statusCode).toEqual(400);
    expect(response.body.error).toEqual("Invalid data");
    expect(await storedLink(code)).toEqual(before);
  });

  it("redirects to /login without a session cookie and changes nothing", async () => {
    const code = await createdCode();

    const response = await patchLink(code, { disabled: true }, null);

    expect(response.statusCode).toEqual(302);
    expect(response.headers.location).toEqual("/login");
    expect((await storedLink(code)).disabled).toEqual(false);
  });

});

function regenerateLink(code: string, withCookie: string | null = cookie) {
  const request = superRequestAgent.post(`/api/links/${code}/regenerate`);

  return withCookie ? request.set("Cookie", withCookie) : request;
}

function storedCodes(): Promise<string[]> {
  return testDatabase.selectFrom("links").select("code").orderBy("id").execute().then((rows) => rows.map((row) => row.code));
}

describe("POST /api/links/:code/regenerate", () => {
  it("responds 200 with a new code for the same destination", async () => {
    const code = await createdCode();

    const response = await regenerateLink(code).send({});

    expect(response.statusCode).toEqual(200);
    expect(response.body.code).toMatch(CODE_PATTERN);
    expect(response.body.code).not.toEqual(code);
    expect(response.body).toMatchObject({ target_url: TARGET_URL, disabled: false, expires_at: null });
    expect(Object.keys(response.body).sort()).toEqual(["code", "created_at", "disabled", "expires_at", "target_url"]);
  });

  it("works without sending any body", async () => {
    const code = await createdCode();

    const response = await regenerateLink(code);

    expect(response.statusCode).toEqual(200);
    expect(response.body.code).not.toEqual(code);
  });

  it("stops the old short link and the new one redirects to the same destination", async () => {
    const code = await createdCode();

    const response = await regenerateLink(code).send({});

    expect((await superRequestAgent.get(`/x/${code}`)).statusCode).toEqual(404);

    const redirect = await superRequestAgent.get(`/x/${response.body.code}`);

    expect(redirect.statusCode).toEqual(302);
    expect(redirect.headers.location).toEqual(TARGET_URL);
  });

  it("keeps the click history, so clicks before and after the change belong to one link", async () => {
    const code = await createdCode();
    await superRequestAgent.get(`/x/${code}`).set("User-Agent", "before");

    const response = await regenerateLink(code).send({});
    await superRequestAgent.get(`/x/${response.body.code}`).set("User-Agent", "after");

    const clicks = await testDatabase.selectFrom("clicks").select(["link_id", "user_agent"]).orderBy("id").execute();

    expect(clicks.map((click) => click.user_agent)).toEqual(["before", "after"]);
    expect(new Set(clicks.map((click) => click.link_id)).size).toEqual(1);
  });

  it("responds 404 for a code that does not exist", async () => {
    const response = await regenerateLink("Nope123").send({});

    expect(response.statusCode).toEqual(404);
    expect(response.body).toEqual({ error: "Link not found" });
  });

  it("responds 404 and changes nothing for another user's link", async () => {
    const otherCookie = await signUp("other@example.com");
    const code = (await createLink({ url: TARGET_URL }, otherCookie)).body.code;

    const response = await regenerateLink(code).send({});

    expect(response.statusCode).toEqual(404);
    expect(response.body).toEqual({ error: "Link not found" }); // same 404 as a missing code
    await expect(storedCodes()).resolves.toEqual([code]);
    expect((await superRequestAgent.get(`/x/${code}`)).statusCode).toEqual(302);
  });

  it.each([
    ["the body tries to choose the code", { code: "custom1" }],
  ])("responds 400 and keeps the code when %s", async (_name, body) => {
    const code = await createdCode();

    const response = await regenerateLink(code).send(body);

    expect(response.statusCode).toEqual(400);
    expect(response.body.error).toEqual("Invalid data");
    await expect(storedCodes()).resolves.toEqual([code]);
  });

  it("redirects to /login without a session cookie and keeps the code", async () => {
    const code = await createdCode();

    const response = await regenerateLink(code, null).send({});

    expect(response.statusCode).toEqual(302);
    expect(response.headers.location).toEqual("/login");
    await expect(storedCodes()).resolves.toEqual([code]);
  });

});

function deleteLink(code: string, withCookie: string | null = cookie) {
  const request = superRequestAgent.delete(`/api/links/${code}`);

  return withCookie ? request.set("Cookie", withCookie) : request;
}

describe("DELETE /api/links/:code", () => {
  it("responds 204 with no body and removes the link", async () => {
    const code = await createdCode();

    const response = await deleteLink(code);

    expect(response.statusCode).toEqual(204);
    expect(response.text).toEqual("");
    await expect(storedCodes()).resolves.toEqual([]);
  });

  it("stops the short link", async () => {
    const code = await createdCode();

    await deleteLink(code);

    const response = await superRequestAgent.get(`/x/${code}`);

    expect(response.statusCode).toEqual(404);
    expect(response.headers.location).toBeUndefined();
  });

  it("deletes the link's clicks with it", async () => {
    const code = await createdCode();
    await superRequestAgent.get(`/x/${code}`);
    await superRequestAgent.get(`/x/${code}`);

    await deleteLink(code);

    await expect(countClicks()).resolves.toEqual(0);
  });

  it("leaves the owner's other links and their clicks alone", async () => {
    const doomed = await createdCode("https://example.com/doomed");
    const kept = await createdCode("https://example.com/kept");
    await superRequestAgent.get(`/x/${doomed}`);
    await superRequestAgent.get(`/x/${kept}`);

    await deleteLink(doomed);

    expect((await superRequestAgent.get(`/x/${kept}`)).headers.location).toEqual("https://example.com/kept");
    await expect(countClicks()).resolves.toEqual(2); // the kept link's first click plus the one just made
  });

  it("responds 404 for a code that does not exist", async () => {
    const response = await deleteLink("Nope123");

    expect(response.statusCode).toEqual(404);
    expect(response.body).toEqual({ error: "Link not found" });
  });

  it("responds 404 and deletes nothing for another user's link", async () => {
    const otherCookie = await signUp("other@example.com");
    const code = (await createLink({ url: TARGET_URL }, otherCookie)).body.code;

    const response = await deleteLink(code);

    expect(response.statusCode).toEqual(404);
    expect(response.body).toEqual({ error: "Link not found" }); // same 404 as a missing code
    await expect(storedCodes()).resolves.toEqual([code]);
    expect((await superRequestAgent.get(`/x/${code}`)).statusCode).toEqual(302);
  });

  it("redirects to /login without a session cookie and deletes nothing", async () => {
    const code = await createdCode();

    const response = await deleteLink(code, null);

    expect(response.statusCode).toEqual(302);
    expect(response.headers.location).toEqual("/login");
    await expect(storedCodes()).resolves.toEqual([code]);
  });

});

function getStats(code: string, withCookie: string | null = cookie) {
  const request = superRequestAgent.get(`/api/links/${code}/stats`);

  return withCookie ? request.set("Cookie", withCookie) : request;
}

function visit(code: string, headers: { referer?: string; userAgent?: string } = {}) {
  const request = superRequestAgent.get(`/x/${code}`);

  if (headers.referer) request.set("Referer", headers.referer);

  return headers.userAgent ? request.set("User-Agent", headers.userAgent) : request.unset("User-Agent");
}

describe("GET /api/links/:code/stats", () => {
  it("responds 200 with zeros for a link nobody has visited", async () => {
    const code = await createdCode();

    const response = await getStats(code);

    expect(response.statusCode).toEqual(200);
    expect(response.body).toEqual({ code, total_clicks: 0, clicks_per_day: [], referrers: [], user_agents: [] });
  });

  it("reports the visits made through the short link", async () => {
    const code = await createdCode();
    await visit(code, { referer: "https://social.example/post", userAgent: "Chrome" });
    await visit(code, { referer: "https://social.example/post", userAgent: "Chrome" });
    await visit(code, { userAgent: "Safari" });

    const response = await getStats(code);

    expect(response.statusCode).toEqual(200);
    expect(response.body.total_clicks).toEqual(3);
    expect(response.body.referrers).toEqual([
      { referrer: "https://social.example/post", clicks: 2 },
      { referrer: null, clicks: 1 }, // came directly
    ]);
    expect(response.body.user_agents).toEqual([
      { user_agent: "Chrome", clicks: 2 },
      { user_agent: "Safari", clicks: 1 },
    ]);
  });

  it("has exactly the documented fields", async () => {
    const code = await createdCode();
    await visit(code, { userAgent: "Chrome" });

    const response = await getStats(code);

    expect(Object.keys(response.body).sort()).toEqual(["clicks_per_day", "code", "referrers", "total_clicks", "user_agents"]);
    expect(Object.keys(response.body.clicks_per_day[0]).sort()).toEqual(["clicks", "date"]);
    expect(Object.keys(response.body.referrers[0]).sort()).toEqual(["clicks", "referrer"]);
    expect(Object.keys(response.body.user_agents[0]).sort()).toEqual(["clicks", "user_agent"]);
  });

  it("groups clicks per UTC day and the days add up to the total", async () => {
    const code = await createdCode();
    const { id } = await testDatabase.selectFrom("links").select("id").where("code", "=", code).executeTakeFirstOrThrow();
    for (const at of ["2026-10-13T23:30:00Z", "2026-10-14T00:30:00Z", "2026-10-14T08:00:00Z"]) {
      await testDatabase.insertInto("clicks").values({ link_id: id, clicked_at: new Date(at) }).execute();
    }

    const response = await getStats(code);

    expect(response.body.clicks_per_day).toEqual([
      { date: "2026-10-13", clicks: 1 },
      { date: "2026-10-14", clicks: 2 },
    ]);
    expect(response.body.total_clicks).toEqual(3);
  });

  it("counts only the clicks of that link", async () => {
    const mine = await createdCode("https://example.com/mine");
    const other = await createdCode("https://example.com/other");
    await visit(mine);
    await visit(other);
    await visit(other);

    expect((await getStats(mine)).body.total_clicks).toEqual(1);
    expect((await getStats(other)).body.total_clicks).toEqual(2);
  });

  it("responds 404 for a code that does not exist", async () => {
    const response = await getStats("Nope123");

    expect(response.statusCode).toEqual(404);
    expect(response.body).toEqual({ error: "Link not found" });
  });

  it("responds 404 and shows nothing for another user's link", async () => {
    const otherCookie = await signUp("other@example.com");
    const code = (await createLink({ url: TARGET_URL }, otherCookie)).body.code;
    await visit(code, { userAgent: "Chrome" });

    const response = await getStats(code);

    expect(response.statusCode).toEqual(404);
    expect(response.body).toEqual({ error: "Link not found" }); // same 404 as a missing code
    expect(JSON.stringify(response.body)).not.toContain("Chrome");
  });

  it("redirects to /login without a session cookie", async () => {
    const code = await createdCode();

    const response = await getStats(code, null);

    expect(response.statusCode).toEqual(302);
    expect(response.headers.location).toEqual("/login");
  });

});

describe("when the database fails", () => {
  it("responds 500 on list, update, regenerate, delete and stats", async () => {
    const code = await createdCode();
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const names = ["listLinks", "setDisabled", "regenerateCode", "deleteLink", "getLinkStats"] as const;
    const spies = names.map((name) => jest.spyOn(linkService, name as any).mockRejectedValue(new Error("database down")));

    try {
      const responses = [
        await listLinks(),
        await patchLink(code, { disabled: true }),
        await regenerateLink(code).send({}),
        await deleteLink(code),
        await getStats(code),
      ];

      expect(responses.map((response) => response.statusCode)).toEqual([500, 500, 500, 500, 500]);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
      errorLog.mockRestore();
    }
  });
});
