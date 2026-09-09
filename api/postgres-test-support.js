import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPostgresDatabase } from "./postgres-database.js";
import { runMigrations as applyMigrations } from "../scripts/migrate.js";

const applicationTables = [
  "account_deletion_jobs",
  "usage_daily",
  "ai_jobs",
  "import_batches",
  "warehouses",
  "sessions",
  "email_challenges",
  "beta_access",
  "users",
];
const truncateApplicationTables = `TRUNCATE TABLE ${applicationTables.join(", ")} RESTART IDENTITY CASCADE`;
const defaultMigrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../db/migrations");

export async function createPostgresTestContext({
  connectionString = process.env.TEST_DATABASE_URL,
  databaseFactory = createPostgresDatabase,
  migrationsDirectory = defaultMigrationsDirectory,
  runMigrations = applyMigrations,
} = {}) {
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    throw testDatabaseError("POSTGRES_TEST_DATABASE_UNAVAILABLE", "POSTGRES_TEST_DATABASE_UNAVAILABLE: TEST_DATABASE_URL is required");
  }

  let database;
  try {
    database = databaseFactory({ connectionString });
  } catch {
    throw testDatabaseError("POSTGRES_TEST_DATABASE_UNAVAILABLE", "POSTGRES_TEST_DATABASE_UNAVAILABLE: unable to create the test database connection");
  }

  try {
    const result = await database.query("SELECT current_database() AS name");
    const databaseName = result.rows[0]?.name;
    if (typeof databaseName !== "string" || !databaseName.endsWith("_test")) {
      throw testDatabaseError("POSTGRES_TEST_DATABASE_UNSAFE", "POSTGRES_TEST_DATABASE_UNSAFE: database name must end with _test");
    }
  } catch (error) {
    await closeQuietly(database);
    if (error?.code === "POSTGRES_TEST_DATABASE_UNSAFE") throw error;
    throw testDatabaseError("POSTGRES_TEST_DATABASE_UNAVAILABLE", "POSTGRES_TEST_DATABASE_UNAVAILABLE: unable to connect to TEST_DATABASE_URL");
  }

  try {
    await runMigrations({ database, migrationsDirectory });
  } catch (error) {
    await closeQuietly(database);
    throw error;
  }

  let closePromise;
  return {
    database,
    reset() {
      return database.query(truncateApplicationTables);
    },
    close() {
      if (!closePromise) closePromise = database.close();
      return closePromise;
    },
  };
}

function testDatabaseError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function closeQuietly(database) {
  try {
    await database.close();
  } catch {
    // The original availability or safety failure is more useful and contains no connection details.
  }
}
