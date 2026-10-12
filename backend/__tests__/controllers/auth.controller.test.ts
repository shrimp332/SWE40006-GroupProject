import dotEnv from "dotenv";
import { superRequestAgent } from "../../test-helpers/after-global-setup";
import { resetTable } from "../../test-helpers/reset-table";
import { testDatabase } from "../../src/config/database.config";
import { SESSION_COOKIE } from "../../src/middlewares/auth.middleware";

dotEnv.config();

const EMAIL = "test-user@example.com";
const PASSWORD = "password";

beforeEach(async () => {
  await resetTable("users");
});

afterEach(async () => {
  await resetTable("users");
});

function register(body: object) {
  return superRequestAgent.post("/api/register").send(body);
}

function login(body: object) {
  return superRequestAgent.post("/api/login").send(body);
}

function sessionCookieFrom(response: { headers: Record<string, any> }): string | undefined {
  const cookies: string[] = response.headers["set-cookie"] ?? [];

  return cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
}

function cookieValue(setCookie: string): string {
  return setCookie.split(";")[0].slice(`${SESSION_COOKIE}=`.length);
}

function countSessions(): Promise<number> {
  return testDatabase
    .selectFrom("sessions")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .executeTakeFirstOrThrow()
    .then((row) => Number(row.count));
}

describe("POST /api/register", () => {
  it("responds 201 and creates the user", async () => {
    const response = await register({ email: EMAIL, password: PASSWORD });

    expect(response.statusCode).toEqual(201);

    const user = await testDatabase.selectFrom("users").select("email").executeTakeFirstOrThrow();

    expect(user.email).toEqual(EMAIL);
  });

  it("stores the email lowercased", async () => {
    const response = await register({ email: "Mixed.Case@Example.com", password: PASSWORD });

    expect(response.statusCode).toEqual(201);

    const user = await testDatabase.selectFrom("users").select("email").executeTakeFirstOrThrow();

    expect(user.email).toEqual("mixed.case@example.com");
  });

  it("responds 409 when the email is already registered", async () => {
    const kyselyErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      await register({ email: EMAIL, password: PASSWORD });

      const response = await register({ email: EMAIL, password: PASSWORD });

      expect(response.statusCode).toEqual(409);
      expect(response.body).toEqual({ error: "Email already registered" });
    } finally {
      kyselyErrorLog.mockRestore();
    }
  });
});

describe("POST /api/login", () => {
  beforeEach(async () => {
    await register({ email: EMAIL, password: PASSWORD });
  });

  it("responds 204 and sets the session cookie", async () => {
    const response = await login({ email: EMAIL, password: PASSWORD });

    expect(response.statusCode).toEqual(204);
    expect(sessionCookieFrom(response)).toBeDefined();
  });

  it("matches the email case-insensitively", async () => {
    const response = await login({ email: EMAIL.toUpperCase(), password: PASSWORD });

    expect(response.statusCode).toEqual(204);
    expect(sessionCookieFrom(response)).toBeDefined();
  });

  it("responds 401 when the password is wrong", async () => {
    const response = await login({ email: EMAIL, password: "not-password" });

    expect(response.statusCode).toEqual(401);
    expect(response.body).toEqual({ error: "Invalid email or password" });
    expect(sessionCookieFrom(response)).toBeUndefined();
    await expect(countSessions()).resolves.toEqual(0);
  });

  it("responds 401 with the same error when the email does not exist", async () => {
    const response = await login({ email: "not-email@example.com", password: PASSWORD });

    expect(response.statusCode).toEqual(401);
    expect(response.body).toEqual({ error: "Invalid email or password" });
    expect(sessionCookieFrom(response)).toBeUndefined();
    await expect(countSessions()).resolves.toEqual(0);
  });

  it.each([
    ["email is missing", { password: PASSWORD }],
    ["password is missing", { email: EMAIL }],
    ["email is not an email address", { email: "not-an-email", password: PASSWORD }],
    ["body has unknown fields", { email: EMAIL, password: PASSWORD, admin: true }],
  ])("responds 400 when %s", async (_name, body) => {
    const response = await login(body);

    expect(response.statusCode).toEqual(400);
    expect(response.body.error).toEqual("Invalid data");
    expect(sessionCookieFrom(response)).toBeUndefined();
  });
});

describe("POST /api/logout", () => {
  it("responds 204, deletes the session and clears the cookie", async () => {
    await register({ email: EMAIL, password: PASSWORD });
    const loginResponse = await login({ email: EMAIL, password: PASSWORD });
    const cookie = cookieValue(sessionCookieFrom(loginResponse)!);

    const response = await superRequestAgent.post("/api/logout").set("Cookie", `${SESSION_COOKIE}=${cookie}`);

    expect(response.statusCode).toEqual(204);
    await expect(countSessions()).resolves.toEqual(0);

    const cleared = sessionCookieFrom(response);

    expect(cleared).toBeDefined();
    expect(cookieValue(cleared!)).toEqual("");
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("responds 204 when there is no session cookie", async () => {
    const response = await superRequestAgent.post("/api/logout");

    expect(response.statusCode).toEqual(204);
  });

  it("responds 204 for a cookie that matches no session", async () => {
    const response = await superRequestAgent.post("/api/logout").set("Cookie", `${SESSION_COOKIE}=not-a-real-cookie`);

    expect(response.statusCode).toEqual(204);
  });
});
