import dotEnv from "dotenv";
import { superRequestAgent } from "../../test-helpers/after-global-setup";
import { resetTable } from "../../test-helpers/reset-table";
import { testDatabase } from "../../src/config/database.config";
import { SESSION_COOKIE } from "../../src/middlewares/auth.middleware";

dotEnv.config();

const EMAIL = "test-user@example.com";
const PASSWORD = "password";

function sessionCookieFrom(response: { headers: Record<string, any> }): string | undefined {
  const cookies: string[] = response.headers["set-cookie"] ?? [];

  return cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
}

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

describe("GET /api/me", () => {
  it("responds 200 and returns 1", async () => {
    await register({ email: EMAIL, password: PASSWORD });

    const loginResponse = await login({ email: EMAIL, password: PASSWORD });
    expect(loginResponse.statusCode).toEqual(204);

    const sessionCookie = sessionCookieFrom(loginResponse);
    expect(sessionCookie).toBeDefined();

    const response = await superRequestAgent.get("/api/me").set("Cookie", sessionCookie!);
    expect(response.statusCode).toEqual(200);
    expect(response.text).toEqual("1");
  });
});
