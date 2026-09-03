import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryWarehouseRepository } from "./memory-warehouse-repository.js";
import { createWarehouseService } from "./warehouse-service.js";

function snapshot(name = "测试仓", suffix = "") {
  return {
    schema_version: 1,
    name,
    document: { sections: [{ id: `section${suffix}`, pineconeIds: [`pinecone${suffix}`] }] },
    shelves: [{ id: `shelf${suffix}`, pineconeIds: [`pinecone${suffix}`] }],
    pinecones: [{ id: `pinecone${suffix}`, content: `内容${suffix}`, shelfId: `shelf${suffix}` }],
  };
}

function setup() {
  let nextId = 0;
  const repository = createMemoryWarehouseRepository();
  const service = createWarehouseService({
    repository,
    idGenerator: (kind) => `${kind}-${++nextId}`,
    clock: () => new Date("2026-09-02T00:00:00.000Z"),
  });
  return { repository, service };
}

test("warehouse CRUD is isolated by owner and snapshots are cloned", async () => {
  const { service } = setup();
  const input = snapshot("甲的仓");
  const created = await service.createWarehouse("user-a", input);
  input.name = "篡改";

  assert.equal((await service.getWarehouse("user-a", created.id)).snapshot.name, "甲的仓");
  await assert.rejects(() => service.getWarehouse("user-b", created.id), { code: "WAREHOUSE_NOT_FOUND" });
  await assert.rejects(() => service.saveWarehouse("user-b", created.id, { revision: 0, snapshot: snapshot("越权") }), { code: "WAREHOUSE_NOT_FOUND" });
  assert.deepEqual(await service.listWarehouses("user-b"), { revision: 0, warehouses: [] });
});

test("create validates snapshots and enforces the ten warehouse limit", async () => {
  const { service } = setup();
  await assert.rejects(() => service.createWarehouse("user-a", { name: "坏数据" }), { code: "VALIDATION_FAILED" });
  for (let index = 0; index < 10; index += 1) await service.createWarehouse("user-a", snapshot(`仓 ${index}`, `-${index}`));
  await assert.rejects(() => service.createWarehouse("user-a", snapshot("第十一个", "-11")), { code: "WAREHOUSE_LIMIT_REACHED" });
});

test("save requires a ready warehouse and matching revision then increments revision", async () => {
  const { repository, service } = setup();
  const created = await service.createWarehouse("user-a", snapshot("初始"));
  const saved = await service.saveWarehouse("user-a", created.id, { revision: 0, snapshot: snapshot("更新") });
  assert.equal(saved.revision, 1);
  assert.equal(saved.snapshot.name, "更新");
  await assert.rejects(() => service.saveWarehouse("user-a", created.id, { revision: 0, snapshot: snapshot("过期") }), { code: "REVISION_CONFLICT" });

  await repository.setStatusForTest("user-a", created.id, "organizing");
  await assert.rejects(() => service.saveWarehouse("user-a", created.id, { revision: 1, snapshot: snapshot("整理中") }), { code: "WAREHOUSE_ORGANIZING" });
  await assert.rejects(() => service.deleteWarehouse("user-a", created.id, { revision: 1 }), { code: "WAREHOUSE_ORGANIZING" });
});

test("delete removes only a ready owned warehouse", async () => {
  const { service } = setup();
  const first = await service.createWarehouse("user-a", snapshot("一"));
  await service.createWarehouse("user-a", snapshot("二", "-2"));
  await assert.rejects(() => service.deleteWarehouse("user-a", first.id, { revision: 1 }), { code: "REVISION_CONFLICT" });
  await service.deleteWarehouse("user-a", first.id, { revision: 0 });
  assert.equal((await service.listWarehouses("user-a")).warehouses.length, 1);
  await assert.rejects(() => service.deleteWarehouse("user-a", first.id, { revision: 0 }), { code: "WAREHOUSE_NOT_FOUND" });
});

test("reorder requires the current order revision and exact warehouse id set", async () => {
  const { service } = setup();
  const first = await service.createWarehouse("user-a", snapshot("一"));
  const second = await service.createWarehouse("user-a", snapshot("二", "-2"));

  await assert.rejects(() => service.reorderWarehouses("user-a", { revision: 2, warehouseIds: [first.id] }), { code: "VALIDATION_FAILED" });
  const reordered = await service.reorderWarehouses("user-a", { revision: 2, warehouseIds: [second.id, first.id] });
  assert.equal(reordered.revision, 3);
  assert.deepEqual(reordered.warehouses.map((item) => item.id), [second.id, first.id]);
  await assert.rejects(() => service.reorderWarehouses("user-a", { revision: 2, warehouseIds: [first.id, second.id] }), { code: "REVISION_CONFLICT" });
});

test("import is atomic, only runs into an empty account, and remaps internal ids", async () => {
  const { service } = setup();
  await assert.rejects(() => service.importWarehouses("user-a", {
    idempotencyKey: "bad-batch",
    warehouses: [snapshot("有效"), { name: "无效" }],
  }), { code: "VALIDATION_FAILED" });
  assert.equal((await service.listWarehouses("user-a")).warehouses.length, 0);

  const imported = await service.importWarehouses("user-a", {
    idempotencyKey: "batch-1",
    warehouses: [snapshot("导入一"), snapshot("导入二", "-2")],
  });
  assert.equal(imported.warehouses.length, 2);
  assert.deepEqual(imported.warehouses.map((item) => item.position), [0, 1]);
  const detail = await service.getWarehouse("user-a", imported.warehouses[0].id);
  const newPineconeId = detail.snapshot.pinecones[0].id;
  const newShelfId = detail.snapshot.shelves[0].id;
  assert.notEqual(newPineconeId, "pinecone");
  assert.notEqual(newShelfId, "shelf");
  assert.deepEqual(detail.snapshot.document.sections[0].pineconeIds, [newPineconeId]);
  assert.deepEqual(detail.snapshot.shelves[0].pineconeIds, [newPineconeId]);
  assert.equal(detail.snapshot.pinecones[0].shelfId, newShelfId);

  await assert.rejects(() => service.importWarehouses("user-a", { idempotencyKey: "batch-2", warehouses: [snapshot("再次")] }), { code: "WAREHOUSE_NOT_EMPTY" });
});

test("create, delete, and import advance the warehouse order revision", async () => {
  const { service } = setup();
  const created = await service.createWarehouse("user-a", snapshot("一"));
  assert.equal((await service.listWarehouses("user-a")).revision, 1);
  await service.deleteWarehouse("user-a", created.id, { revision: 0 });
  assert.equal((await service.listWarehouses("user-a")).revision, 2);
  await service.importWarehouses("user-a", { idempotencyKey: "batch", warehouses: [snapshot("导入")] });
  assert.equal((await service.listWarehouses("user-a")).revision, 3);
});

test("snapshot validation rejects duplicate ids and dangling references before import", async () => {
  const { service } = setup();
  const duplicate = snapshot("重复");
  duplicate.pinecones.push({ ...duplicate.pinecones[0] });
  await assert.rejects(() => service.createWarehouse("user-a", duplicate), { code: "VALIDATION_FAILED" });

  const dangling = snapshot("悬空");
  dangling.document.sections[0].pineconeIds = ["missing"];
  await assert.rejects(() => service.importWarehouses("user-a", { idempotencyKey: "dangling", warehouses: [dangling] }), { code: "VALIDATION_FAILED" });
});

test("import retries with the same key return the recorded result without duplicates", async () => {
  const { service } = setup();
  const request = { idempotencyKey: "same-key", warehouses: [snapshot("导入")] };
  const first = await service.importWarehouses("user-a", request);
  const retry = await service.importWarehouses("user-a", request);
  assert.deepEqual(retry, first);
  assert.equal((await service.listWarehouses("user-a")).warehouses.length, 1);
});

test("an import idempotency key cannot be reused for a different batch", async () => {
  const { service } = setup();
  await service.importWarehouses("user-a", { idempotencyKey: "same-key", warehouses: [snapshot("第一批")] });
  await assert.rejects(
    () => service.importWarehouses("user-a", { idempotencyKey: "same-key", warehouses: [snapshot("不同内容")] }),
    { code: "VALIDATION_FAILED" },
  );
});

test("list reads warehouses and order revision as one repository snapshot", async () => {
  const { repository, service } = setup();
  await service.createWarehouse("user-a", snapshot("一致"));
  repository.getOrderRevision = () => { throw new Error("split read must not be used"); };
  repository.list = () => { throw new Error("split read must not be used"); };
  const listed = await service.listWarehouses("user-a");
  assert.equal(listed.revision, 1);
  assert.equal(listed.warehouses.length, 1);
});

test("import stores a bounded canonical digest and caps idempotency keys", async () => {
  const { repository, service } = setup();
  await service.importWarehouses("user-a", { idempotencyKey: "k", warehouses: [snapshot("相同批次")] });
  const batch = await repository.getImportBatch("user-a", "k");
  assert.match(batch.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(batch.fingerprint.includes("相同批次"), false);

  const { service: otherService } = setup();
  await assert.rejects(() => otherService.importWarehouses("user-a", {
    idempotencyKey: "x".repeat(129), warehouses: [snapshot()],
  }), { code: "VALIDATION_FAILED" });
});
