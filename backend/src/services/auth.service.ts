import * as argon2 from "argon2";
import { Kysely, sql } from "kysely";
import { createHash, randomBytes } from "node:crypto";

/** Throws postgres 23505 if the email is already registered. */
export async function register(email: string, password: string, db: Kysely<any>): Promise<void> {
    const password_hash = await argon2.hash(password);

    await db.insertInto("users")
        .values({ email: email.toLowerCase(), password_hash })
        .execute()
}

export async function login(email: string, password: string, db: Kysely<any>): Promise<string | null> {
    const user_id = await verifyUserPassword(email, password, db);

    if (!user_id) return null;

    const cookie = randomBytes(32).toString("base64url");
    const sessionId = createHash("sha256").update(cookie).digest("hex");

    await db.insertInto("sessions")
        .values([{ id: sessionId, user_id: user_id }])
        .execute();

    return cookie;
}

export async function logout(cookie: string, db: Kysely<any>): Promise<void> {
    const sessionId = createHash("sha256").update(cookie).digest("hex");

    await db.deleteFrom("sessions")
        .where("id", '=', sessionId)
        .execute()
}

export async function getUserIdFromCookie(cookie: string, db: Kysely<any>): Promise<number | null> {
    const sessionId = createHash("sha256").update(cookie).digest("hex");

    const session = await db.selectFrom("sessions")
        .select(["id", "user_id"])
        .where("id", '=', sessionId)
        .where("expires_at", ">", sql<Date>`NOW()`)
        .executeTakeFirst()

    if (!session) return null;

    return session.user_id;
}

async function verifyUserPassword(email: string, password: string, db: Kysely<any>): Promise<number | null> {
    const user = await db.selectFrom("users")
        .select(["id", "password_hash"])
        .where("email", '=', email.toLowerCase())
        .executeTakeFirst()

    if (!user) return null;

    const valid = await argon2.verify(user.password_hash, password);
    return valid ? user.id : null;
}
