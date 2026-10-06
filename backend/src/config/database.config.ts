import { FileMigrationProvider, Kysely, Migrator, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { promises as fs } from "fs";
import * as path from "path";
import { DB } from "../types/kysely-types";

export const PG_DIALECT = new PostgresDialect({
  pool: new Pool({
    host: "swe40006-db",
    port: 5432,
    user: "postgres",
    password: "password",
    database: "swe40006-db",
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 5_000,
    maxLifetimeSeconds: 60,
    max: 10,
  }),
});

export const TEST_PG_DIALECT = new PostgresDialect({
  pool: new Pool({
    host: "localhost",
    port: 5436,
    user: "postgres",
    password: "password",
    database: "test",
  }),
});

export const database = new Kysely<DB>({
  dialect: PG_DIALECT,
  log: ["error", "query"],
});

export const testDatabase = new Kysely<DB>({
  dialect: TEST_PG_DIALECT,
  log: ["error"],
});

export async function testDatabaseConnection(): Promise<void> {
  try {
    const query = sql`SELECT 1`.compile(database);
    await database.executeQuery(query);
    console.info("Database connection test successful");
  } catch (error) {
    console.error("STOP \n \n");
    console.error("Database connection failed. Server shutting down.");
    process.exit(1);
  }
}

export async function runMigration(): Promise<void> {
  console.info("Checking if database needs to updated...");

  const migrator = new Migrator({
    db: database,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, "../migrations"),
    }),
  });

  const migrateToLatestResult = await migrator.migrateToLatest();

  if (migrateToLatestResult.results) {
    migrateToLatestResult.results.forEach((run) => {
      console.log(`Running migration file: ${run.migrationName}`);
      console.log(`> direction: ${run.direction}`);

      if (run.status === "Success") {
        console.log(`> status: ${run.status}`);
      } else if (run.status === "Error") {
        console.log(`ERROR: Failed to migrate using this file.`);
      } else if (run.status === "NotExecuted") {
        console.log(`WARNING: Cannot execute due an earlier migration file failure.`);
      }
    });
  }

  if (migrateToLatestResult.results && migrateToLatestResult.results.length === 0) {
    console.log(`Database is updated to latest version`);
  }

  if (migrateToLatestResult.error) {
    console.error("STOP \n \n");
    console.error("Database migration failed.");
    console.error(migrateToLatestResult.error);
    process.exit(1);
  }
}
