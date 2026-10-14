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
