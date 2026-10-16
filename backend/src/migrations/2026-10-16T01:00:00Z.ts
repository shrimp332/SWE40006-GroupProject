import { Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
    await sql`
        ALTER TABLE links
            ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
            ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC'
    `.execute(db);

    await sql`
        ALTER TABLE clicks
            ALTER COLUMN clicked_at TYPE timestamptz USING clicked_at AT TIME ZONE 'UTC'
    `.execute(db);
}
