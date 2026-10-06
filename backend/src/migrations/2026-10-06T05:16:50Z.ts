import { Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  /** @todo change this to reflect actual DB schema */

  await db.schema
    .createTable("sample_table")
    .ifNotExists()
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(sql`NOW ()`))
    .execute();
}
