import { Kysely, sql } from "kysely";
import { randomInt } from "node:crypto";

export const CODE_LENGTH = 7;
export const CODE_PATTERN = /^[A-Za-z0-9]{7}$/;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const MAX_CODE_ATTEMPTS = 5;

export interface Link {
    code: string;
    target_url: string;
    created_at: Date;
    expires_at: Date | null;
    disabled: boolean;
}

export function generateCode(): string {
    let code = "";

    // randomInt is uniform, so unlike `byte % 62` it does not favour some characters.
    for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];

    return code;
}

/** Retries with a fresh code on a collision, throws postgres 23505 only if every attempt collides. */
export async function createLink(ownerId: number, targetUrl: string, db: Kysely<any>): Promise<Link> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await db.insertInto("links")
                .values({ code: generateCode(), target_url: targetUrl, owner_id: ownerId })
                .returning(["code", "target_url", "created_at", "expires_at", "disabled"])
                .executeTakeFirstOrThrow();
        } catch (error: any) {
            if (error?.code !== "23505" || attempt >= MAX_CODE_ATTEMPTS) throw error;
        }
    }
}

/** Returns the link to redirect to, or null if the code is unknown, disabled or expired. */
export async function resolveCode(code: string, db: Kysely<any>): Promise<{ id: number; target_url: string } | null> {
    const link = await db.selectFrom("links")
        .select(["id", "target_url"])
        .where("code", "=", code)
        .where("disabled", "=", false)
        .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", sql<Date>`NOW()`)]))
        .executeTakeFirst();

    return link ?? null;
}

export async function recordClick(linkId: number, referrer: string | undefined, userAgent: string | undefined, db: Kysely<any>): Promise<void> {
    await db.insertInto("clicks")
        .values({ link_id: linkId, referrer: referrer ?? null, user_agent: userAgent ?? null })
        .execute();
}
