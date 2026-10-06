import dotEnv from "dotenv";
import { FileMigrationProvider, Migrator, sql } from "kysely";
import { promises as fs } from "fs";
import * as path from "path";
import { testDatabase } from "../src/config/database.config";

dotEnv.config();

export default async function () {
  console.log("GLOBAL SETUP");
  process.env.NODE_ENV = "testing";

  console.info("Checking if test database exits...");
  const checkIfDatabaseExists = await sql`SELECT 1 as exists FROM pg_database WHERE datname = 'test'`.execute(testDatabase);

  if (checkIfDatabaseExists.rows.length <= 0) {
    console.error("'test' database does not exist. Please ensure it's created before running test");
    process.exit(1);
  }

  console.info("Checking if database needs to updated...");

  const migrator = new Migrator({
    db: testDatabase,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, "../src/migrations"),
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
    testDatabase.destroy();
  }

  if (migrateToLatestResult.error) {
    console.error("STOP \n \n");
    console.error("Database migration failed.");
    console.error(migrateToLatestResult.error);
    process.exit(1);
  }
}
