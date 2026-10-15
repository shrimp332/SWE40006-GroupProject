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

    // randomInt is uniform, so no character is favoured
    for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];

    return code;
}

/** Retries on a code collision, throws postgres 23505 if every attempt collides. */
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

/** The owner's links, newest first, including disabled and expired ones. */
export async function listLinks(ownerId: number, db: Kysely<any>): Promise<Link[]> {
    return db.selectFrom("links")
        .select(["code", "target_url", "created_at", "expires_at", "disabled"])
        .where("owner_id", "=", ownerId)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc") // links created in the same instant keep a stable order
        .execute();
}

/** Returns null if the code does not exist or belongs to another user. */
export async function setDisabled(ownerId: number, code: string, disabled: boolean, db: Kysely<any>): Promise<Link | null> {
    const link = await db.updateTable("links")
        .set({ disabled })
        .where("code", "=", code)
        .where("owner_id", "=", ownerId)
        .returning(["code", "target_url", "created_at", "expires_at", "disabled"])
        .executeTakeFirst();

    return link ?? null;
}

/**
 * Gives the link a new random code, so the old one stops working. Click history is kept.
 * Retries on a collision, throws postgres 23505 if every attempt collides.
 * Returns null if the code does not exist or belongs to another user.
 */
export async function regenerateCode(ownerId: number, code: string, db: Kysely<any>): Promise<Link | null> {
    for (let attempt = 1; ; attempt++) {
        const newCode = generateCode();

        if (newCode === code) {
            if (attempt >= MAX_CODE_ATTEMPTS) throw new Error("Could not generate a code different from the current one");
            continue;
        }

        try {
            const link = await db.updateTable("links")
                .set({ code: newCode })
                .where("code", "=", code)
                .where("owner_id", "=", ownerId)
                .returning(["code", "target_url", "created_at", "expires_at", "disabled"])
                .executeTakeFirst();

            return link ?? null;
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
