import { app as App } from "./app";
import * as dotEnv from "dotenv";
import { database, runMigration, testDatabaseConnection } from "./config/database.config";

dotEnv.config();

const port = process.env.API_PORT ?? 3005;
const expressApp = App(database);

expressApp.listen(port, async (error) => {
  if (error) {
    console.error("FAILED TO START SERVER");
    console.error(error.message);
    process.exit(1);
  } else {
    await testDatabaseConnection().then(async () => {
      await runMigration();
    });
    console.info(`Server is running on port ${port}`);
  }
});
