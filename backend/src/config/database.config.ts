import * as dotEnv from "dotenv";
import { FileMigrationProvider, Kysely, Migrator, PostgresDialect, sql } from "kysely";
import { Pool, defaults, types } from "pg";
import { promises as fs } from "fs";
import * as path from "path";
import { DB } from "../types/kysely-types";

dotEnv.config();

// links.expires_at and clicks.clicked_at are plain `timestamp` columns, which carry no time zone. 
// The database writesthem in UTC (its NOW()). These two settings make reading and writing both mean UTC.
types.setTypeParser(types.builtins.TIMESTAMP, (value: string) => new Date(`${value.replace(" ", "T")}Z`));
defaults.parseInputDatesAsUTC = true;

const { DATABASE_URL, TEST_DATABASE_URL, NODE_ENV } = process.env;

if (!DATABASE_URL) {
  console.error("STOP \n \n");
  console.error("DATABASE_URL is not set. Refusing to start without an explicit database connection string.");
  process.exit(1);
}

export const PG_DIALECT = new PostgresDialect({
  pool: new Pool({
    connectionString: DATABASE_URL,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 5_000,
    maxLifetimeSeconds: 60,
    max: 10,
  }),
});

export const TEST_PG_DIALECT = new PostgresDialect({
  pool: new Pool({
    connectionString: TEST_DATABASE_URL,
  }),
});

export const database = new Kysely<DB>({
  dialect: PG_DIALECT,
  log: NODE_ENV === "dev" ? ["error", "query"] : ["error"],
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
