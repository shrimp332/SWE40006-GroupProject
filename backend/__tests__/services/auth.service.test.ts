import dotEnv from "dotenv";
import * as argon2 from "argon2";
import { createHash } from "node:crypto";
import { getUserIdFromCookie, login, logout, register } from "../../src/services/auth.service";
import { testDatabase } from "../../src/config/database.config";
import { resetTable } from "../../test-helpers/reset-table";

dotEnv.config();

const EMAIL = "test-user@example.com";
const PASSWORD = "correct-horse-battery-staple";

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await argon2.hash(PASSWORD);
}, 30_000);

beforeEach(async () => {
  // sessions get reset implicitly through cascade delete
  await resetTable("users");
});

afterEach(async () => {
  await resetTable("users");
});

async function insertUser(email = EMAIL, hash = passwordHash): Promise<number> {
  const user = await testDatabase.insertInto("users").values({ email, password_hash: hash }).returning("id").executeTakeFirstOrThrow();

  return user.id;
}

function sessionIdFor(cookie: string): string {
  return createHash("sha256").update(cookie).digest("hex");
}

function countSessions(): Promise<number> {
  return testDatabase
    .selectFrom("sessions")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .executeTakeFirstOrThrow()
    .then((row) => Number(row.count));
}

describe("login", () => {
  it("returns a cookie when the password is correct", async () => {
    await insertUser();

    await expect(login(EMAIL, PASSWORD, testDatabase)).resolves.not.toBeNull();
  });

  it("store sha-256 of cookie not the cookie", async () => {
    const userId = await insertUser();

    const cookie = (await login(EMAIL, PASSWORD, testDatabase)) as string;

    const session = await testDatabase.selectFrom("sessions").select(["id", "user_id"]).executeTakeFirstOrThrow();

    expect(session.id).toEqual(sessionIdFor(cookie));
    expect(session.id).not.toEqual(cookie);
    expect(session.user_id).toEqual(userId);
  });

  it("different cookies generated per login", async () => {
    const userId = await insertUser();

    const first = (await login(EMAIL, PASSWORD, testDatabase)) as string;
    const second = (await login(EMAIL, PASSWORD, testDatabase)) as string;

    expect(first).not.toEqual(second);
    await expect(countSessions()).resolves.toEqual(2);
    await expect(getUserIdFromCookie(first, testDatabase)).resolves.toEqual(userId);
    await expect(getUserIdFromCookie(second, testDatabase)).resolves.toEqual(userId);
  });

  it("defaults the session to expire seven days after creation", async () => {
    await insertUser();

    await login(EMAIL, PASSWORD, testDatabase);

    const session = await testDatabase.selectFrom("sessions").select(["created_at", "expires_at"]).executeTakeFirstOrThrow();

    const lifetimeDays = (session.expires_at!.getTime() - session.created_at!.getTime()) / 86_400_000;

    expect(lifetimeDays).toBeCloseTo(7, 3);
  });

  it("returns null when the password is wrong", async () => {
    await insertUser();

    await expect(login(EMAIL, "not-the-password", testDatabase)).resolves.toBeNull();
    await expect(countSessions()).resolves.toEqual(0);
  });

  it("returns null when the email does not exist", async () => {
    await insertUser();

    await expect(login("nobody@example.com", PASSWORD, testDatabase)).resolves.toBeNull();
    await expect(countSessions()).resolves.toEqual(0);
  });

});

describe("getUserIdFromCookie", () => {
  it("returns the user id for a live session", async () => {
    const userId = await insertUser();
    const cookie = (await login(EMAIL, PASSWORD, testDatabase)) as string;

    await expect(getUserIdFromCookie(cookie, testDatabase)).resolves.toEqual(userId);
  });

  it("returns null for a cookie that matches no session", async () => {
    await insertUser();
    await login(EMAIL, PASSWORD, testDatabase);

    await expect(getUserIdFromCookie("not-a-real-cookie", testDatabase)).resolves.toBeNull();
  });

  it("returns null for an expired session", async () => {
    const userId = await insertUser();
    const cookie = "cookie-for-an-expired-session";

    await testDatabase
      .insertInto("sessions")
      .values({
        id: sessionIdFor(cookie),
        user_id: userId,
        expires_at: new Date(Date.now() - 60_000),
      })
      .execute();

    await expect(getUserIdFromCookie(cookie, testDatabase)).resolves.toBeNull();
  });

  it("returns null once the session has been logged out", async () => {
    await insertUser();
    const cookie = (await login(EMAIL, PASSWORD, testDatabase)) as string;

    await logout(cookie, testDatabase);

    await expect(getUserIdFromCookie(cookie, testDatabase)).resolves.toBeNull();
  });
});

describe("logout", () => {
  it("deletes the session row for the given cookie", async () => {
    await insertUser();
    const cookie = (await login(EMAIL, PASSWORD, testDatabase)) as string;

    await logout(cookie, testDatabase);

    await expect(countSessions()).resolves.toEqual(0);
  });

  it("leaves the user's other sessions alone", async () => {
    await insertUser();
    const first = (await login(EMAIL, PASSWORD, testDatabase)) as string;
    const second = (await login(EMAIL, PASSWORD, testDatabase)) as string;

    await logout(first, testDatabase);

    await expect(countSessions()).resolves.toEqual(1);
    await expect(getUserIdFromCookie(second, testDatabase)).resolves.not.toBeNull();
  });

  it("is a no-op for a cookie that matches no session", async () => {
    await insertUser();
    await login(EMAIL, PASSWORD, testDatabase);

    await expect(logout("not-a-real-cookie", testDatabase)).resolves.toBeUndefined();
    await expect(countSessions()).resolves.toEqual(1);
  });
});

describe("register", () => {
  it("creates the user row", async () => {
    await register("new-user@example.com", PASSWORD, testDatabase);

    await expect(
      testDatabase.selectFrom("users").select("id").where("email", "=", "new-user@example.com").executeTakeFirst(),
    ).resolves.not.toBeUndefined();
  });

  it("password is not plaintext", async () => {
    await register("new-user@example.com", PASSWORD, testDatabase);

    const user = await testDatabase.selectFrom("users").select("password_hash").executeTakeFirstOrThrow();

    expect(user.password_hash).not.toEqual(PASSWORD);
  });

  it("double register (unique)", async () => {
    // Silences the Kysely error log for the deliberate failure below.
    const kyselyErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      await register("duplicate@example.com", PASSWORD, testDatabase);

      await expect(register("duplicate@example.com", PASSWORD, testDatabase)).rejects.toMatchObject({ code: "23505" });
    } finally {
      kyselyErrorLog.mockRestore();
    }
  });
});

describe("sessions schema", () => {
  it("drops a user's sessions when the user is deleted", async () => {
    const userId = await insertUser();
    await login(EMAIL, PASSWORD, testDatabase);

    await testDatabase.deleteFrom("users").where("id", "=", userId).execute();

    await expect(countSessions()).resolves.toEqual(0);
  });
});

describe("users schema", () => {
  it("rejects a duplicate email at the database level", async () => {
    // Silences the Kysely error log for the deliberate failure below.
    const kyselyErrorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      await insertUser("duplicate@example.com");

      await expect(insertUser("duplicate@example.com")).rejects.toMatchObject({ code: "23505" }); // postgres unique violation
    } finally {
      kyselyErrorLog.mockRestore();
    }
  });
});
