import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runMigrations } from "./migrate.js";

function createFakeDatabase({ failSql } = {}) {
  const applied = new Set();
  const transactions = [];
  const queries = [];

  return {
    transactions,
    queries,
    async query(text) {
      queries.push(text);
      if (text.startsWith("SELECT filename FROM schema_migrations")) {
        return { rows: [...applied].map((filename) => ({ filename })) };
      }
      return { rows: [] };
    },
    async withTransaction(work) {
      const transaction = [];
      transactions.push(transaction);
      try {
        const result = await work({
          query: async (text, values) => {
            transaction.push({ text, values });
            if (text === failSql) throw new Error("migration SQL failed");
            if (text.startsWith("INSERT INTO schema_migrations")) applied.add(values[0]);
            return { rows: [] };
          },
        });
        transaction.push({ text: "COMMIT" });
        return result;
      } catch (error) {
        transaction.push({ text: "ROLLBACK" });
        throw error;
      }
    },
  };
}

async function withMigrationDirectory(work) {
  const directory = await mkdtemp(join(tmpdir(), "nestnote-migrations-"));
  try {
    return await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("applies new migrations in lexicographic order and skips prior files", async () => {
  await withMigrationDirectory(async (migrationsDirectory) => {
    await writeFile(join(migrationsDirectory, "0002_second.sql"), "CREATE TABLE second_table(id int);");
    await writeFile(join(migrationsDirectory, "0001_first.sql"), "CREATE TABLE first_table(id int);");
    const database = createFakeDatabase();

    const first = await runMigrations({ database, migrationsDirectory });
    assert.deepEqual(first.applied, ["0001_first.sql", "0002_second.sql"]);
    assert.deepEqual(database.transactions.map((transaction) => transaction.find((entry) => entry.text.startsWith("CREATE TABLE")).text), [
      "CREATE TABLE first_table(id int);",
      "CREATE TABLE second_table(id int);",
    ]);

    const second = await runMigrations({ database, migrationsDirectory });
    assert.deepEqual(second.applied, []);
  });
});

test("rolls back a migration when its SQL fails without recording it", async () => {
  await withMigrationDirectory(async (migrationsDirectory) => {
    const sql = "CREATE TABLE broken_table(id int);";
    await writeFile(join(migrationsDirectory, "0001_broken.sql"), sql);
    const database = createFakeDatabase({ failSql: sql });

    await assert.rejects(() => runMigrations({ database, migrationsDirectory }), /migration SQL failed/);
    assert.equal(database.transactions[0][0].text, "LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
    assert.equal(database.transactions[0].at(-1).text, "ROLLBACK");
    assert.equal(database.transactions[0].some((entry) => entry.text === sql), true);
    assert.equal(database.transactions[0].some((entry) => entry.text.startsWith("INSERT INTO schema_migrations")), false);
  });
});

test("rejects migration filenames outside the NNNN_name.sql convention", async () => {
  await withMigrationDirectory(async (migrationsDirectory) => {
    await writeFile(join(migrationsDirectory, "migration.sql"), "SELECT 1;");

    await assert.rejects(
      () => runMigrations({ database: createFakeDatabase(), migrationsDirectory }),
      /Invalid migration filename: migration\.sql/,
    );
  });
});
