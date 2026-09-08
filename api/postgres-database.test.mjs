import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresDatabase } from "./postgres-database.js";

class FakePool {
  static options;
  static transactionCommands;
  static released;
  static endCalls;

  constructor(options) {
    FakePool.options = options;
    FakePool.transactionCommands = [];
    FakePool.released = 0;
    FakePool.endCalls = 0;
  }

  async query(text, values) {
    return { rows: [{ text, values }] };
  }

  async connect() {
    return {
      query: async (text, values) => {
        FakePool.transactionCommands.push(text);
        return { rows: [{ text, values }] };
      },
      release: () => { FakePool.released += 1; },
    };
  }

  async end() {
    FakePool.endCalls += 1;
  }
}

test("creates a bounded pool and commits transactional work", async () => {
  const database = createPostgresDatabase({
    connectionString: "postgresql://example.invalid/test",
    PoolClass: FakePool,
    poolOptions: { max: 4 },
  });

  assert.deepEqual(FakePool.options, {
    connectionString: "postgresql://example.invalid/test",
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  });
  assert.deepEqual(await database.query("SELECT $1::int AS value", [7]), {
    rows: [{ text: "SELECT $1::int AS value", values: [7] }],
  });
  assert.equal(await database.withTransaction(async (client) => {
    await client.query("SELECT $1::int AS value", [7]);
    return "committed";
  }), "committed");
  assert.deepEqual(FakePool.transactionCommands, ["BEGIN", "SELECT $1::int AS value", "COMMIT"]);
  assert.equal(FakePool.released, 1);
});

test("rolls back and releases a client when transactional work rejects", async () => {
  const database = createPostgresDatabase({
    connectionString: "postgresql://example.invalid/test",
    PoolClass: FakePool,
  });

  await assert.rejects(
    () => database.withTransaction(async () => { throw new Error("write failed"); }),
    /write failed/,
  );
  assert.deepEqual(FakePool.transactionCommands, ["BEGIN", "ROLLBACK"]);
  assert.equal(FakePool.released, 1);
});

test("rejects a missing connection string", () => {
  assert.throws(() => createPostgresDatabase({ PoolClass: FakePool }), /connectionString/);
});

test("closes the pool only once", async () => {
  const database = createPostgresDatabase({
    connectionString: "postgresql://example.invalid/test",
    PoolClass: FakePool,
  });

  await Promise.all([database.close(), database.close()]);
  assert.equal(FakePool.endCalls, 1);
});
