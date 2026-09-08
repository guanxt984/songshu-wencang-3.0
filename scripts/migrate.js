import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPostgresDatabase } from "../api/postgres-database.js";

const migrationFilenamePattern = /^\d{4}_[^.]+\.sql$/;
const createMigrationsTable = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

export async function runMigrations({ database, migrationsDirectory } = {}) {
  if (!database || typeof database.query !== "function" || typeof database.withTransaction !== "function") {
    throw new TypeError("database must provide query() and withTransaction()");
  }
  if (typeof migrationsDirectory !== "string" || migrationsDirectory === "") {
    throw new TypeError("migrationsDirectory is required");
  }

  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  for (const filename of filenames) {
    if (!migrationFilenamePattern.test(filename)) throw new Error(`Invalid migration filename: ${filename}`);
  }

  await database.query(createMigrationsTable);
  const recorded = await database.query("SELECT filename FROM schema_migrations");
  const appliedFilenames = new Set(recorded.rows.map((row) => row.filename));
  const applied = [];

  for (const filename of filenames) {
    if (appliedFilenames.has(filename)) continue;
    const sql = await readFile(join(migrationsDirectory, filename), "utf8");
    const didApply = await database.withTransaction(async (client) => {
      await client.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
      const existing = await client.query("SELECT filename FROM schema_migrations WHERE filename = $1", [filename]);
      if (existing.rows.length > 0) return false;
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
      return true;
    });
    if (didApply) {
      applied.push(filename);
      appliedFilenames.add(filename);
    }
  }

  return { applied };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const database = createPostgresDatabase({ connectionString });
  try {
    const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../db/migrations");
    const { applied } = await runMigrations({ database, migrationsDirectory });
    console.log(`Applied ${applied.length} migration(s).`);
  } finally {
    await database.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
