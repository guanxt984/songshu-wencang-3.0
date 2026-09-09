import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createPostgresAuthRepository } from "./postgres-auth-repository.js";
import { createPostgresTestContext } from "./postgres-test-support.js";
import { createPostgresWarehouseRepository } from "./postgres-warehouse-repository.js";

const now = new Date("2026-09-09T12:00:00Z");

test("PostgreSQL warehouse repositories enforce persistence, ownership, and atomic mutations", async (t) => {
  const first = await openContextOrSkip(t);
  if (!first) return;
  const second = await createPostgresTestContext();
  t.after(async () => { await Promise.all([first.close(), second.close()]); });
  await first.reset();

  const auth = createPostgresAuthRepository({ database: first.database });
  const warehousesA = createPostgresWarehouseRepository({ database: first.database });
  const warehousesB = createPostgresWarehouseRepository({ database: second.database });
  const userA = await auth.findOrCreateUser("warehouse-a@example.com", now);

  await t.test("warehouses survive pool recreation", async () => {
    const record = await warehousesA.create(userA.id, warehouseRecord("persisted"));
    await first.close();
    assert.equal((await warehousesB.get(userA.id, record.id)).name, "persisted");
  });

  await t.test("user B cannot read, update, or delete user A warehouse", async () => {
    await second.reset();
    const secondAuth = createPostgresAuthRepository({ database: second.database });
    const owner = await secondAuth.findOrCreateUser("owner@example.com", now);
    const userB = await secondAuth.findOrCreateUser("warehouse-b@example.com", now);
    const record = await warehousesB.create(owner.id, warehouseRecord("private"));
    assert.equal(await warehousesB.get(userB.id, record.id), null);
    assert.deepEqual(await warehousesB.updateIfRevision(userB.id, record.id, 0, { snapshot: snapshot("tamper"), updatedAt: now }), { outcome: "not_found" });
    assert.equal(await warehousesB.deleteReadyIfRevision(userB.id, record.id, 0), "not_found");
    assert.equal((await warehousesB.get(owner.id, record.id)).name, "private");
  });

  await t.test("stale revisions conflict and organizing warehouses reject writes", async () => {
    await second.reset();
    const user = await createPostgresAuthRepository({ database: second.database }).findOrCreateUser("revision@example.com", now);
    const record = await warehousesB.create(user.id, warehouseRecord("revision"));
    assert.equal((await warehousesB.updateIfRevision(user.id, record.id, 0, { snapshot: snapshot("saved"), updatedAt: now })).outcome, "updated");
    assert.deepEqual(await warehousesB.updateIfRevision(user.id, record.id, 0, { snapshot: snapshot("stale"), updatedAt: now }), { outcome: "conflict" });
    await second.database.query("UPDATE warehouses SET status = 'organizing' WHERE user_id = $1 AND id = $2", [user.id, record.id]);
    assert.deepEqual(await warehousesB.updateIfRevision(user.id, record.id, 1, { snapshot: snapshot("busy"), updatedAt: now }), { outcome: "organizing" });
  });

  await t.test("create and delete advance order revision, and reorder avoids transient position conflicts", async () => {
    await second.reset();
    const user = await createPostgresAuthRepository({ database: second.database }).findOrCreateUser("order@example.com", now);
    const firstRecord = await warehousesB.create(user.id, warehouseRecord("one"));
    const secondRecord = await warehousesB.create(user.id, warehouseRecord("two"));
    assert.equal(await warehousesB.getOrderRevision(user.id), 2);
    const reordered = await warehousesB.reorderIfRevision(user.id, 2, [secondRecord.id, firstRecord.id]);
    assert.deepEqual(reordered.warehouses.map((item) => item.id), [secondRecord.id, firstRecord.id]);
    assert.equal(reordered.revision, 3);
    assert.equal(await warehousesB.deleteReadyIfRevision(user.id, firstRecord.id, 0), "deleted");
    assert.equal(await warehousesB.getOrderRevision(user.id), 4);
  });

  await t.test("a mid-import SQL failure rolls back warehouses and import batches", async () => {
    await second.reset();
    const user = await createPostgresAuthRepository({ database: second.database }).findOrCreateUser("rollback@example.com", now);
    let inserts = 0;
    const failingDatabase = {
      query: second.database.query.bind(second.database),
      withTransaction: (work) => second.database.withTransaction((client) => work({
        query: async (text, values) => {
          if (/INSERT INTO warehouses/.test(text) && inserts++ === 1) throw new Error("injected import failure");
          return client.query(text, values);
        },
      })),
    };
    const failingRepository = createPostgresWarehouseRepository({ database: failingDatabase });
    await assert.rejects(
      () => failingRepository.importEmptyBatch(user.id, "rollback-key", "rollback-fingerprint", [warehouseRecord("one"), warehouseRecord("two")], (stored) => ({ warehouses: stored })),
      { code: "INTERNAL_ERROR" },
    );
    const counts = await second.database.query("SELECT (SELECT count(*) FROM warehouses WHERE user_id = $1) AS warehouses, (SELECT count(*) FROM import_batches WHERE user_id = $1) AS batches", [user.id]);
    assert.deepEqual({ warehouses: Number(counts.rows[0].warehouses), batches: Number(counts.rows[0].batches) }, { warehouses: 0, batches: 0 });
  });

  await t.test("retrying an import key returns its stored result without duplicates", async () => {
    await second.reset();
    const user = await createPostgresAuthRepository({ database: second.database }).findOrCreateUser("import@example.com", now);
    const records = [warehouseRecord("imported")];
    const firstResult = await warehousesB.importEmptyBatch(user.id, "same-key", "same-fingerprint", records, (stored) => ({ warehouses: stored.map(({ id, name }) => ({ id, name })) }));
    const secondResult = await warehousesB.importEmptyBatch(user.id, "same-key", "same-fingerprint", records, () => assert.fail("stored batch should be returned before rebuilding"));
    assert.deepEqual(secondResult, firstResult);
    const count = await second.database.query("SELECT count(*)::integer AS count FROM warehouses WHERE user_id = $1", [user.id]);
    assert.equal(Number(count.rows[0].count), 1);
  });
});

async function openContextOrSkip(t) {
  try {
    return await createPostgresTestContext();
  } catch (error) {
    if (error?.code === "POSTGRES_TEST_DATABASE_UNAVAILABLE") {
      t.skip(error.message);
      return null;
    }
    throw error;
  }
}

function warehouseRecord(name) {
  return { id: randomUUID(), revision: 0, status: "ready", snapshot: snapshot(name), createdAt: now, updatedAt: now };
}

function snapshot(name) {
  return { version: 1, name, pinecones: [], shelves: [], document: {} };
}
