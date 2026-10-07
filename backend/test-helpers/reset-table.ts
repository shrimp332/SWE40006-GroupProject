import { sql } from "kysely";
import { testDatabase } from "../src/config/database.config";

/**
 * `WARNING:` DO NOT USE THIS OUTSIDE OF TESTING.
 *
 * This query is not escaped and parametrised. This is prone to SQL injection.
 *
 * @description Truncates all rows from a given table
 */
export async function resetTable(tableName: string) {
  if (tableName.length <= 0) {
    console.error("Table name has be greater than 0 characters");
    process.exit(1);
  }

  const query = sql.raw(`TRUNCATE ${tableName} CASCADE`).compile(testDatabase);
  await testDatabase.executeQuery(query);
}
