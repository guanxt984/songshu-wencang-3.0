import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresWarehouseRepository } from "./postgres-warehouse-repository.js";

const now = new Date("2026-09-08T00:00:00Z");
const row = {
  id: "warehouse-id", user_id: "user-id", name: "产品资料", position: 0,
  schema_version: 1, revision: 2, status: "ready", active_ai_job_id: null,
  snapshot: { version: 1, warehouse: {} }, created_at: now, updated_at: now,
};
const mapped = {
  id: "warehouse-id", userId: "user-id", name: "产品资料", position: 0,
  schemaVersion: 1, revision: 2, status: "ready", activeAiJobId: null,
  snapshot: { version: 1, warehouse: {} }, createdAt: now, updatedAt: now,
};
const owner = [{ warehouse_order_revision: 4 }];
const record = {
  id: "warehouse-id", revision: 0, status: "ready",
  snapshot: { version: 1, name: "产品资料", pinecones: [], shelves: [], document: {} },
  createdAt: now, updatedAt: now,
};

// The external SQL boundary is recorded; transaction callbacks execute for real.
function setup(responses = []) {
  const database = {
    calls: [], transactions: 0, commits: 0, rollbacks: 0,
    async query(text, values = []) { return query(text, values, false); },
    async withTransaction(work) {
      database.transactions += 1;
      try {
        const result = await work({ query: (text, values = []) => query(text, values, true) });
        database.commits += 1;
        return result;
      } catch (error) { database.rollbacks += 1; throw error; }
    },
  };
  async function query(text, values, inTransaction) {
    database.calls.push({ text: text.replace(/\s+/g, " ").trim(), values, inTransaction });
    assert.ok(responses.length, `Unexpected query: ${text}`);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return { rows: response };
  }
  return { database, repository: createPostgresWarehouseRepository({ database }), exhausted: () => assert.equal(responses.length, 0) };
}

function assertOwned(call) {
  assert.match(call.text, /user_id = \$1 AND id = \$2/);
  assert.deepEqual(call.values.slice(0, 2), ["user-id", "warehouse-id"]);
}

function assertTransaction(database) {
  assert.equal(database.transactions, 1);
  assert.equal(database.commits, 1);
  assert.ok(database.calls.every((call) => call.inTransaction));
}

test("get scopes by owner and ID, maps complete rows, and clones JSON and dates", async () => {
  const { repository, database } = setup([[row], []]);
  const result = await repository.get("user-id", "warehouse-id");
  assert.deepEqual(result, mapped);
  result.snapshot.warehouse.changed = true;
  result.createdAt.setFullYear(2000);
  assert.deepEqual(row.snapshot, { version: 1, warehouse: {} });
  assert.equal(now.getUTCFullYear(), 2026);
  assertOwned(database.calls[0]);
  assert.equal(await repository.get("other-user", "warehouse-id"), null);
  assert.deepEqual(database.calls[1].values, ["other-user", "warehouse-id"]);
});

test("list and order revision come from one statement snapshot including an empty account", async () => {
  const { repository, database } = setup([
    [{ ...row, warehouse_order_revision: 4 }],
    [{ id: null, warehouse_order_revision: 7 }], [],
  ]);
  assert.deepEqual(await repository.listWithOrderRevision("user-id"), { revision: 4, warehouses: [mapped] });
  assert.equal(database.calls.length, 1);
  assert.match(database.calls[0].text, /LEFT JOIN warehouses/);
  assert.match(database.calls[0].text, /ORDER BY .*position/);
  assert.deepEqual(database.calls[0].values, ["user-id"]);
  assert.deepEqual(await repository.listWithOrderRevision("empty-user"), { revision: 7, warehouses: [] });
  assert.deepEqual(await repository.listWithOrderRevision("missing-user"), { revision: 0, warehouses: [] });
});

test("list and getOrderRevision filter ownership and map numeric/date driver values", async () => {
  const { repository, database } = setup([[{ ...row, revision: "2", updated_at: now.toISOString() }], [{ warehouse_order_revision: "4" }], []]);
  assert.deepEqual(await repository.list("user-id"), [mapped]);
  assert.match(database.calls[0].text, /WHERE user_id = \$1 ORDER BY position/);
  assert.equal(await repository.getOrderRevision("user-id"), 4);
  assert.equal(await repository.getOrderRevision("missing-user"), 0);
});

for (const [existing, revision, outcome] of [
  [[], 2, "not_found"], [[{ ...row, status: "organizing" }], 1, "organizing"], [[row], 1, "conflict"],
]) {
  test(`save returns ${outcome} without writing`, async () => {
    const { repository, database, exhausted } = setup([existing]);
    assert.deepEqual(await repository.updateIfRevision("user-id", "warehouse-id", revision, { snapshot: record.snapshot, updatedAt: now }), { outcome });
    assertOwned(database.calls[0]);
    assert.match(database.calls[0].text, /FOR UPDATE/);
    assertTransaction(database);
    exhausted();
  });

  test(`delete returns ${outcome} after locking the owner and record without writing`, async () => {
    const { repository, database, exhausted } = setup([owner, existing]);
    assert.equal(await repository.deleteReadyIfRevision("user-id", "warehouse-id", revision), outcome);
    assert.match(database.calls[0].text, /FROM users WHERE id = \$1 FOR UPDATE/);
    assertOwned(database.calls[1]);
    assert.match(database.calls[1].text, /FOR UPDATE/);
    assertTransaction(database);
    exhausted();
  });
}

test("save increments revision and synchronizes snapshot metadata with owner-scoped UPDATE", async () => {
  const updatedRow = { ...row, revision: 3, snapshot: record.snapshot };
  const { repository, database } = setup([[row], [updatedRow]]);
  const result = await repository.updateIfRevision("user-id", "warehouse-id", 2, { snapshot: record.snapshot, updatedAt: now });
  assert.deepEqual(result, { outcome: "updated", warehouse: { ...mapped, revision: 3, snapshot: record.snapshot } });
  assertOwned(database.calls[1]);
  assert.match(database.calls[1].text, /revision = revision \+ 1/);
  assert.match(database.calls[1].text, /name = \$3, schema_version = \$4, snapshot = \$5::jsonb, updated_at = \$6::timestamptz/);
  assert.deepEqual(database.calls[1].values, ["user-id", "warehouse-id", "产品资料", 1, JSON.stringify(record.snapshot), now]);
  assertTransaction(database);
});

test("create locks the owner, checks capacity, appends a record and advances order in one transaction", async () => {
  const { repository, database } = setup([owner, [{ count: "3" }], [{ ...row, position: 3, revision: 0, snapshot: record.snapshot }], [{ warehouse_order_revision: 5 }]]);
  assert.deepEqual(await repository.create("user-id", record), { ...mapped, position: 3, revision: 0, snapshot: record.snapshot });
  assert.match(database.calls[0].text, /FROM users WHERE id = \$1 FOR UPDATE/);
  assert.match(database.calls[1].text, /WHERE user_id = \$1/);
  assert.deepEqual(database.calls[2].values, ["user-id", "warehouse-id", "产品资料", 3, 1, 0, "ready", null, JSON.stringify(record.snapshot), now, now]);
  assert.match(database.calls[3].text, /warehouse_order_revision = warehouse_order_revision \+ 1 WHERE id = \$1/);
  assertTransaction(database);
});

test("create rejects a full account before inserting", async () => {
  const { repository, database, exhausted } = setup([owner, [{ count: 10 }]]);
  await assert.rejects(repository.create("user-id", record), { code: "WAREHOUSE_LIMIT_REACHED" });
  assert.equal(database.rollbacks, 1);
  exhausted();
});

test("delete defers uniqueness, removes only the owned record, compacts positions and advances order", async () => {
  const { repository, database } = setup([owner, [row], [], [], [], [{ warehouse_order_revision: 5 }]]);
  assert.equal(await repository.deleteReadyIfRevision("user-id", "warehouse-id", 2), "deleted");
  assert.match(database.calls[2].text, /SET CONSTRAINTS warehouses_user_id_position_key DEFERRED/);
  assertOwned(database.calls[3]);
  assert.match(database.calls[3].text, /^DELETE FROM warehouses/);
  assert.match(database.calls[4].text, /row_number\(\) OVER \(ORDER BY position\)/);
  assert.match(database.calls[4].text, /WHERE user_id = \$1/);
  assert.match(database.calls[5].text, /warehouse_order_revision = warehouse_order_revision \+ 1/);
  assertTransaction(database);
});

test("reorder locks owner and rows, defers uniqueness, updates via ordinality and returns sorted rows", async () => {
  const other = { ...row, id: "second-id", position: 1 };
  const { repository, database } = setup([owner, [row, other], [], [], [{ warehouse_order_revision: 5 }], [{ ...other, position: 0 }, { ...row, position: 1 }]]);
  const result = await repository.reorderIfRevision("user-id", 4, ["second-id", "warehouse-id"]);
  assert.equal(result.outcome, "updated");
  assert.equal(result.revision, 5);
  assert.deepEqual(result.warehouses.map(({ id, position }) => ({ id, position })), [{ id: "second-id", position: 0 }, { id: "warehouse-id", position: 1 }]);
  assert.match(database.calls[0].text, /FROM users WHERE id = \$1 FOR UPDATE/);
  assert.match(database.calls[1].text, /WHERE user_id = \$1 ORDER BY position FOR UPDATE/);
  assert.match(database.calls[2].text, /SET CONSTRAINTS warehouses_user_id_position_key DEFERRED/);
  assert.match(database.calls[3].text, /unnest\(\$2::uuid\[\]\) WITH ORDINALITY/);
  assert.match(database.calls[3].text, /user_id = \$1/);
  assert.deepEqual(database.calls[3].values, ["user-id", ["second-id", "warehouse-id"]]);
  assertTransaction(database);
});

test("reorder rejects a stale order revision before changing positions", async () => {
  const { repository, database } = setup([owner]);
  assert.deepEqual(await repository.reorderIfRevision("user-id", 3, ["warehouse-id"]), { outcome: "conflict" });
  assertTransaction(database);
});

test("reorder returns organizing when any owned warehouse is busy", async () => {
  const { repository, database } = setup([owner, [{ ...row, status: "organizing" }]]);
  assert.deepEqual(await repository.reorderIfRevision("user-id", 4, ["warehouse-id"]), { outcome: "organizing" });
  assertTransaction(database);
});

for (const ids of [[], ["foreign-id"], ["warehouse-id", "warehouse-id"]]) {
  test(`reorder validates the exact owned ID set under lock: ${JSON.stringify(ids)}`, async () => {
    const { repository, database, exhausted } = setup([owner, [row]]);
    await assert.rejects(repository.reorderIfRevision("user-id", 4, ids), { code: "VALIDATION_FAILED" });
    assert.equal(database.rollbacks, 1);
    exhausted();
  });
}

const batchRow = { source_fingerprint: "fingerprint", result: { warehouses: [{ id: "warehouse-id", updatedAt: now.toISOString() }] } };

test("getImportBatch filters owner/key and returns cloned recorded JSON or null", async () => {
  const { repository, database } = setup([[batchRow], []]);
  const result = await repository.getImportBatch("user-id", "batch-key");
  assert.deepEqual(result, { fingerprint: "fingerprint", result: batchRow.result });
  result.result.warehouses[0].id = "changed";
  assert.equal(batchRow.result.warehouses[0].id, "warehouse-id");
  assert.match(database.calls[0].text, /WHERE user_id = \$1 AND idempotency_key = \$2/);
  assert.deepEqual(database.calls[0].values, ["user-id", "batch-key"]);
  assert.equal(await repository.getImportBatch("other-user", "batch-key"), null);
});

test("import replays the recorded batch under owner lock without reinserting", async () => {
  const { repository, database } = setup([owner, [batchRow]]);
  assert.deepEqual(await repository.importEmptyBatch("user-id", "batch-key", "fingerprint", [record], () => assert.fail("must not rebuild a replay")), { fingerprint: "fingerprint", result: batchRow.result });
  assert.match(database.calls[0].text, /FROM users WHERE id = \$1 FOR UPDATE/);
  assertTransaction(database);
});

test("import rejects an idempotency key reused with a different fingerprint", async () => {
  const { repository, database } = setup([owner, [batchRow]]);
  await assert.rejects(repository.importEmptyBatch("user-id", "batch-key", "different", [record], () => ({})), { code: "VALIDATION_FAILED" });
  assert.equal(database.rollbacks, 1);
});

for (const [count, records, code] of [[1, [record], "WAREHOUSE_NOT_EMPTY"], [0, Array(11).fill(record), "WAREHOUSE_LIMIT_REACHED"], [0, [], "VALIDATION_FAILED"]]) {
  test(`import rejects ${code} before inserting`, async () => {
    const { repository, database, exhausted } = setup([owner, [], [{ count }]]);
    await assert.rejects(repository.importEmptyBatch("user-id", "batch-key", "fingerprint", records, () => ({})), { code });
    assert.equal(database.rollbacks, 1);
    exhausted();
  });
}

test("import inserts all records, advances order once and returns the persisted successful batch", async () => {
  const second = { ...record, id: "second-id" };
  const { repository, database } = setup([owner, [], [{ count: 0 }], [row], [{ ...row, id: "second-id", position: 1 }], [{ warehouse_order_revision: 5 }], [batchRow]]);
  const result = await repository.importEmptyBatch("user-id", "batch-key", "fingerprint", [record, second], (stored) => {
    assert.deepEqual(stored.map(({ id, position }) => ({ id, position })), [{ id: "warehouse-id", position: 0 }, { id: "second-id", position: 1 }]);
    return batchRow.result;
  });
  assert.deepEqual(result, { fingerprint: "fingerprint", result: batchRow.result });
  assert.equal(database.calls[3].values[3], 0);
  assert.equal(database.calls[4].values[3], 1);
  assert.match(database.calls[6].text, /INSERT INTO import_batches/);
  assert.match(database.calls[6].text, /'succeeded'/);
  assert.deepEqual(database.calls[6].values.slice(0, 4), ["user-id", "batch-key", "fingerprint", JSON.stringify(batchRow.result)]);
  assertTransaction(database);
});

test("a failure during import escapes the transaction and never stores partial success", async () => {
  const error = Object.assign(new Error("private SQL and host"), { code: "XX000" });
  const { repository, database, exhausted } = setup([owner, [], [{ count: 0 }], [row], error]);
  await assert.rejects(repository.importEmptyBatch("user-id", "batch-key", "fingerprint", [record, record], () => assert.fail("must not record result")), { code: "INTERNAL_ERROR", message: "INTERNAL_ERROR" });
  assert.equal(database.rollbacks, 1);
  assert.equal(database.commits, 0);
  exhausted();
});

test("a result builder failure rolls back import inserts and order revision", async () => {
  const { repository, database } = setup([owner, [], [{ count: 0 }], [row], [{ warehouse_order_revision: 5 }]]);
  await assert.rejects(repository.importEmptyBatch("user-id", "batch-key", "fingerprint", [record], () => { throw new Error("private data"); }), { code: "INTERNAL_ERROR", message: "INTERNAL_ERROR" });
  assert.equal(database.rollbacks, 1);
  assert.equal(database.commits, 0);
});

for (const [error, code] of [
  [Object.assign(new Error("private timeout"), { code: "57014" }), "SERVICE_UNAVAILABLE"],
  [Object.assign(new Error("private timeout"), { code: "ETIMEDOUT" }), "SERVICE_UNAVAILABLE"],
  [new Error("timeout exceeded when trying to connect"), "SERVICE_UNAVAILABLE"],
  [new Error("connection terminated due to connection timeout"), "SERVICE_UNAVAILABLE"],
  [Object.assign(new Error("private constraint"), { code: "23505", constraint: "warehouses_pkey" }), "VALIDATION_FAILED"],
  [Object.assign(new Error("private check"), { code: "23514", constraint: "warehouses_schema_version_check" }), "VALIDATION_FAILED"],
  [Object.assign(new Error("private foreign key"), { code: "23503", constraint: "warehouses_user_id_fkey" }), "AUTH_REQUIRED"],
  [Object.assign(new Error("private SQL"), { code: "XX000" }), "INTERNAL_ERROR"],
]) {
  test(`database failure maps to safe ${code}: ${error.code || error.message}`, async () => {
    const { repository } = setup([error]);
    await assert.rejects(repository.get("user-id", "warehouse-id"), { code, message: code });
  });
}

test("create fails closed for a nonexistent owner", async () => {
  const { repository, database, exhausted } = setup([[]]);
  await assert.rejects(repository.create("missing-user", record), { code: "AUTH_REQUIRED" });
  assert.equal(database.rollbacks, 1);
  exhausted();
});
