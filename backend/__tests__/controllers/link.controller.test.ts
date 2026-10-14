import dotEnv from "dotenv";
import { sql } from "kysely";
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

/** Registers and logs in through the real endpoints, returns the Cookie header value. */
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

  it("stores the link against the right user when two users are registered", async () => {
    const otherCookie = await signUp("other@example.com");

    await createLink({ url: TARGET_URL }, otherCookie);

    const other = await testDatabase.selectFrom("users").select("id").where("email", "=", "other@example.com").executeTakeFirstOrThrow();
    const row = await testDatabase.selectFrom("links").select("owner_id").executeTakeFirstOrThrow();

    expect(row.owner_id).toEqual(other.id);
  });

  it("gives the same url a different code each time", async () => {
    const first = await createLink({ url: TARGET_URL });
    const second = await createLink({ url: TARGET_URL });

    expect(first.statusCode).toEqual(201);
    expect(second.statusCode).toEqual(201);
    expect(first.body.code).not.toEqual(second.body.code);
    await expect(allLinks()).resolves.toHaveLength(2);
  });

  it("accepts http as well as https", async () => {
    const response = await createLink({ url: "http://example.com/plain" });

    expect(response.statusCode).toEqual(201);
  });

  it("accepts a url at the 2048 character limit", async () => {
    const url = `https://example.com/${"a".repeat(2048 - "https://example.com/".length)}`;

    const response = await createLink({ url });

    expect(url).toHaveLength(2048);
    expect(response.statusCode).toEqual(201);
  });

  it.each([
    ["url is missing", {}],
    ["url is empty", { url: "" }],
    ["url is not a url", { url: "not a url" }],
    ["url is not a string", { url: 42 }],
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

describe("GET /:code", () => {
  it("responds 302 to the destination without needing a session", async () => {
    const code = await createdCode();

    const response = await superRequestAgent.get(`/${code}`); // no cookie: visitors are not logged in

    expect(response.statusCode).toEqual(302);
    expect(response.headers.location).toEqual(TARGET_URL);
  });

  it("is a 302 and not a cacheable 301", async () => {
    const code = await createdCode();

    const response = await superRequestAgent.get(`/${code}`);

    expect(response.statusCode).not.toEqual(301);
    expect(response.headers["cache-control"]).toBeUndefined();
  });

  it("redirects to the stored url unchanged, query string included", async () => {
    const url = "https://example.com/path?a=1&b=two%20words&c=%E2%9C%93#section";
    const code = await createdCode(url);

    const response = await superRequestAgent.get(`/${code}`);

    expect(response.headers.location).toEqual(url);
  });

  it("sends each code to its own destination", async () => {
    const first = await createdCode("https://example.com/first");
    const second = await createdCode("https://example.com/second");

    expect((await superRequestAgent.get(`/${first}`)).headers.location).toEqual("https://example.com/first");
    expect((await superRequestAgent.get(`/${second}`)).headers.location).toEqual("https://example.com/second");
  });

  it("records the click with the referrer and user agent", async () => {
    const code = await createdCode();

    await superRequestAgent.get(`/${code}`).set("Referer", "https://social.example/post").set("User-Agent", "Mozilla/5.0 (test)");

    const click = await testDatabase.selectFrom("clicks").select(["referrer", "user_agent"]).executeTakeFirstOrThrow();

    expect(click).toEqual({ referrer: "https://social.example/post", user_agent: "Mozilla/5.0 (test)" });
  });

  it("records a click with empty referrer when the visitor sends none", async () => {
    const code = await createdCode();

    await superRequestAgent.get(`/${code}`).unset("Referer");

    const click = await testDatabase.selectFrom("clicks").select("referrer").executeTakeFirstOrThrow();

    expect(click.referrer).toBeNull();
  });

  it("records the click against the right link", async () => {
    const first = await createdCode("https://example.com/first");
    await createdCode("https://example.com/second");

    await superRequestAgent.get(`/${first}`);

    const click = await testDatabase
      .selectFrom("clicks")
      .innerJoin("links", "links.id", "clicks.link_id")
      .select("links.code")
      .executeTakeFirstOrThrow();

    expect(click.code).toEqual(first);
  });

  it("records one click per visit", async () => {
    const code = await createdCode();

    await superRequestAgent.get(`/${code}`);
    await superRequestAgent.get(`/${code}`);
    await superRequestAgent.get(`/${code}`);

    await expect(countClicks()).resolves.toEqual(3);
  });

  it("responds 404 and records nothing for a code that does not exist", async () => {
    const response = await superRequestAgent.get("/Nope123");

    expect(response.statusCode).toEqual(404);
    expect(response.headers.location).toBeUndefined();
    await expect(countClicks()).resolves.toEqual(0);
  });

  it("responds 404 and records nothing for a disabled link, and redirects again once it is enabled", async () => {
    const code = await createdCode();

    await testDatabase.updateTable("links").set({ disabled: true }).execute();
    const disabled = await superRequestAgent.get(`/${code}`);

    expect(disabled.statusCode).toEqual(404);
    await expect(countClicks()).resolves.toEqual(0);

    await testDatabase.updateTable("links").set({ disabled: false }).execute();

    expect((await superRequestAgent.get(`/${code}`)).statusCode).toEqual(302);
  });

  it("responds 404 and records nothing for an expired link", async () => {
    const code = await createdCode();
    // Written by the database's own clock: expires_at is a plain timestamp, a Node Date could be hours off.
    await testDatabase.updateTable("links").set({ expires_at: sql<Date>`NOW() - INTERVAL '1 minute'` }).execute();

    const response = await superRequestAgent.get(`/${code}`);

    expect(response.statusCode).toEqual(404);
    await expect(countClicks()).resolves.toEqual(0);
  });

  it.each([
    ["too short", "abc"],
    ["too long", "abcdefgh"],
    ["not letters and digits", "abc-123"],
    ["a file name", "favicon.ico"],
  ])("responds 404 without querying the database when the code is %s", async (_name, code) => {
    const resolveCode = jest.spyOn(linkService, "resolveCode");

    try {
      const response = await superRequestAgent.get(`/${code}`);

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
      const response = await superRequestAgent.get(`/${code}`);

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
      const response = await superRequestAgent.get(`/${code}`);

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

  it("returns each link with the same fields as when it was created", async () => {
    const created = await createLink({ url: TARGET_URL });

    const response = await listLinks();

    expect(response.body).toEqual([created.body]);
    expect(Object.keys(response.body[0]).sort()).toEqual(["code", "created_at", "disabled", "expires_at", "target_url"]);
  });

  it("does not list another user's links", async () => {
    const otherCookie = await signUp("other@example.com");
    await createLink({ url: "https://example.com/not-mine" }, otherCookie);
    const mine = await createdCode("https://example.com/mine");

    const response = await listLinks();

    expect(response.body.map((link: { code: string }) => link.code)).toEqual([mine]);
    expect(JSON.stringify(response.body)).not.toContain("not-mine");
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
    // Written by the database's own clock: expires_at is a plain timestamp, a Node Date could be hours off.
    await testDatabase.updateTable("links").set({ expires_at: sql<Date>`NOW() - INTERVAL '1 minute'` }).where("code", "=", expired).execute();

    const response = await listLinks();

    expect(response.body).toHaveLength(2);
    expect(response.body.find((link: { code: string }) => link.code === disabled).disabled).toEqual(true);
    expect(response.body.find((link: { code: string }) => link.code === expired).expires_at).not.toBeNull();
  });

  it("does not record a click or change anything", async () => {
    await createdCode();

    await listLinks();
    await listLinks();

    await expect(countClicks()).resolves.toEqual(0);
    await expect(testDatabase.selectFrom("links").selectAll().execute()).resolves.toHaveLength(1);
  });

  it("redirects to /login without a session cookie", async () => {
    await createdCode();

    const response = await listLinks(null);

    expect(response.statusCode).toEqual(302);
    expect(response.headers.location).toEqual("/login");
  });

  it("redirects to /login for a cookie that matches no session", async () => {
    const response = await listLinks(`${SESSION_COOKIE}=not-a-real-cookie`);

    expect(response.statusCode).toEqual(302);
    expect(response.headers.location).toEqual("/login");
  });

  it("is not caught by the public redirect route", async () => {
    const response = await listLinks();

    expect(response.statusCode).toEqual(200);
    expect(response.headers.location).toBeUndefined();
  });

  it("responds 500 when listing fails", async () => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const listSpy = jest.spyOn(linkService, "listLinks").mockRejectedValue(new Error("database down"));

    try {
      const response = await listLinks();

      expect(response.statusCode).toEqual(500);
      expect(listSpy).toHaveBeenCalledTimes(1);
    } finally {
      listSpy.mockRestore();
      errorLog.mockRestore();
    }
  });
});
