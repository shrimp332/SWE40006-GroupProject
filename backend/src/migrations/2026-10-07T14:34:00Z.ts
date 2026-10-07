import { Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable("users")
        .ifNotExists()
        .addColumn("id", "serial", (col) => col.primaryKey())
        .addColumn("email", "text", (col) => col.notNull().unique())
        .addColumn("password_hash", "text", (col) => col.notNull()) // argon2 hash
        .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`NOW()`))
        .execute();

    await db.schema
        .createTable("sessions")
        .ifNotExists()
        .addColumn("id", "text", (col) => col.primaryKey()) // sha-256 of cookie
        .addColumn("user_id", "integer", (col) => col.notNull().references("users.id").onDelete("cascade"))
        .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`NOW()`))
        .addColumn("expires_at", "timestamptz", (col) => col.defaultTo(sql`NOW()  + INTERVAL '7 days'`))
        .execute();

    await db.schema
        .createIndex("sessions_user_id_index")
        .ifNotExists()
        .on("sessions")
        .column("user_id")
        .execute();
}
