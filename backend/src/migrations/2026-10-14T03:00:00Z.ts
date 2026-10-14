import { Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable("links")
        .ifNotExists()
        .addColumn("id", "serial", (col) => col.primaryKey())
        .addColumn("code", "text", (col) => col.notNull().unique()) // random short code, the part after the domain
        .addColumn("target_url", "text", (col) => col.notNull())
        .addColumn("owner_id", "integer", (col) => col.notNull().references("users.id").onDelete("cascade"))
        .addColumn("created_at", "timestamp", (col) => col.notNull().defaultTo(sql`NOW()`))
        .addColumn("expires_at", "timestamp") // null = never expires
        .addColumn("disabled", "boolean", (col) => col.notNull().defaultTo(false))
        .execute();

    await db.schema
        .createIndex("links_owner_id_index")
        .ifNotExists()
        .on("links")
        .column("owner_id")
        .execute();

    await db.schema
        .createTable("clicks")
        .ifNotExists()
        .addColumn("id", "serial", (col) => col.primaryKey())
        .addColumn("link_id", "integer", (col) => col.notNull().references("links.id").onDelete("cascade"))
        .addColumn("clicked_at", "timestamp", (col) => col.notNull().defaultTo(sql`NOW()`))
        .addColumn("referrer", "text")
        .addColumn("user_agent", "text")
        .execute();

    await db.schema
        .createIndex("clicks_link_id_index")
        .ifNotExists()
        .on("clicks")
        .column("link_id")
        .execute();
}
