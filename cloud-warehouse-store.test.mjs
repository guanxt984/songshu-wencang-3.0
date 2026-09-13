import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudWarehouseStore, warehouseSnapshot, removePineconeReferences, formatWarehouseUpdatedAt } from './cloud-warehouse-store.js';
function memoryStorage(data = new Map()) {
  return { get length() { return data.size; }, key: (index) => [...data.keys()][index] ?? null, getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}
function memoryLocks() {
  const tails = new Map();
  return { request(name, callback) { const task = (tails.get(name) || Promise.resolve()).then(callback); tails.set(name, task.catch(() => {})); return task; } };
}
function fixture() {
  const data = new Map();
  const storage = memoryStorage(data);
  const records = [{ id: 'a', name: '仓库', shelves: [], pinecones: [], reviewDocument: { title: '文档', sections: [] }, avatar: 'achang-doc.png' }];
  let details = records.map((record) => ({ id: record.id, revision: 2, snapshot: warehouseSnapshot(record) }));
  let orderRevision = 1, failPut = false, failAfterPut = false, calls = [];
  const fetchImpl = async (path, options) => {
    calls.push([path, options]);
    const body = options.body ? JSON.parse(options.body) : {};
    if (path === '/api/warehouses') return Response.json({ revision: orderRevision, warehouses: details });
    if (path === '/api/warehouses/order') {
      assert.equal(body.revision, orderRevision); orderRevision++; details.sort((a, b) => body.warehouseIds.indexOf(a.id) - body.warehouseIds.indexOf(b.id));
      return Response.json({ revision: orderRevision, warehouses: details });
    }
    const detail = details.find((item) => path.endsWith('/' + item.id));
    if (options.method === 'GET') return Response.json(detail);
    if (options.method === 'PUT') {
      if (failPut) throw new Error('offline');
      if (body.revision !== detail.revision) return Response.json({ error: { code: 'REVISION_CONFLICT' } }, { status: 409 });
      detail.snapshot = body.snapshot; detail.revision++;
      if (failAfterPut) { failAfterPut = false; throw new Error('lost response'); }
      return Response.json(detail);
    }
    throw new Error('unexpected');
  };
  const make = (userId = 'u') => createCloudWarehouseStore({ userId, csrfToken: 'csrf', fetchImpl, storage });
  return { make, records, calls, storage, details, setFail: (value) => { failPut = value; }, lostResponse: () => { failAfterPut = true; }, reorderExternally: () => { orderRevision++; } };
}
test('cloud snapshot round trips avatar and manual document, ignores object-key ordering', async () => {
  const f = fixture(), store = f.make();
  const records = await store.load();
  f.details[0].snapshot = Object.fromEntries(Object.entries(f.details[0].snapshot).reverse());
  await store.save(records);
  assert.equal(f.calls.filter(([, options]) => options.method !== 'GET').length, 0);
  records[0].reviewDocument.sections.push({ heading: '手写', annotation: '批注' });
  await store.save(records);
  assert.equal(f.details[0].snapshot.avatar, 'achang-doc.png');
  assert.equal(f.details[0].snapshot.document.sections[0].annotation, '批注');
  assert.equal(f.calls.find(([, options]) => options.method === 'PUT')[1].headers['x-csrf-token'], 'csrf');
});
test('failed save survives reload and is isolated by account; retry preserves original revision', async () => {
  const f = fixture(), store = f.make(); const records = await store.load(); records[0].name = '修改'; f.setFail(true);
  await assert.rejects(store.save(records));
  assert.equal(store.blocked, true);
  const restored = f.make(); assert.equal((await restored.load())[0].name, '修改');
  assert.equal((await f.make('other').load())[0].name, '仓库');
  f.setFail(false); f.details[0].revision++;
  await assert.rejects(restored.retry(), { code: 'REVISION_CONFLICT' });
  assert.equal(f.details[0].snapshot.name, '仓库');
});
test('lost save response is reconciled without overwriting or incrementing twice', async () => {
  const f = fixture(), store = f.make(); const records = await store.load(); records[0].name = '新名'; f.lostResponse();
  await assert.rejects(store.save(records)); await store.retry(); assert.equal(f.details[0].revision, 3);
});
test('external order change is not overwritten by fresh revision', async () => {
  const f = fixture(); f.details.push({ ...structuredClone(f.details[0]), id: 'b' }); const store = f.make();
  const records = await store.load(); f.reorderExternally();
  await assert.rejects(store.save(records.reverse()), /云端排序已变化/);
  assert.equal(f.calls.filter(([path]) => path === '/api/warehouses/order').length, 0);
});
test('stopped account cannot issue further writes', async () => {
  const f = fixture(), store = f.make(); const records = await store.load(); store.stop(); records[0].name = '改';
  await assert.rejects(store.save(records), /账号已退出/);
  assert.equal(f.calls.filter(([, options]) => options.method !== 'GET').length, 0);
});
test('deleting pinecone references keeps manually written document text', () => {
  const original = { sections: [{ bullets: [{ text: '保留文字', pineconeIds: ['a', 'b'] }] }] };
  const cleaned = removePineconeReferences(original, 'a');
  assert.deepEqual(cleaned.sections[0].bullets[0], { text: '保留文字', pineconeIds: ['b'] });
  assert.equal(original.sections[0].bullets[0].pineconeIds.length, 2);
});

test('create and delete persist IDs across retry; import retries reuse the same key', async () => {
  const saved = new Map(), calls = [];
  const storage = memoryStorage(saved);
  let details = [], revision = 0, importFail = true;
  const fetchImpl = async (path, options) => {
    const body = options.body && JSON.parse(options.body); calls.push([path, options.method, body]);
    if (path === '/api/import') {
      if (importFail) { importFail = false; throw new Error('offline'); }
      details = [{ id: 'imported', revision: 0, snapshot: body.warehouses[0] }]; return Response.json({ warehouses: details });
    }
    if (path === '/api/warehouses' && options.method === 'POST') { const detail = { id: 'server-id', revision: 0, snapshot: body.snapshot }; details.push(detail); revision++; return Response.json(detail); }
    if (path === '/api/warehouses') return Response.json({ warehouses: details, revision });
    if (options.method === 'DELETE') { details = []; revision++; return new Response(null, { status: 204 }); }
    return Response.json(details[0]);
  };
  const make = () => createCloudWarehouseStore({ userId: 'u', csrfToken: 'c', fetchImpl, storage, locks: memoryLocks() });
  const store = make(); await store.load();
  const record = { id: 'local-id', name: '新仓', shelves: [], pinecones: [], reviewDocument: { sections: [] } };
  assert.equal((await store.save([record]))[0].id, 'server-id');
  assert.deepEqual(await store.save([]), []);
  await assert.rejects(store.importRecords([record]));
  const restored = make(); await restored.load(); await restored.retry();
  const imports = calls.filter(([path]) => path === '/api/import');
  assert.equal(imports.length, 2); assert.equal(imports[0][2].idempotencyKey, imports[1][2].idempotencyKey);
});

test('ambiguous create response never sends a duplicate POST on retry', async () => {
  let posts = 0;
  const storage = memoryStorage();
  const store = createCloudWarehouseStore({ userId: 'u', csrfToken: 'c', storage, locks: memoryLocks(), fetchImpl: async (_path, options) => {
    if (options.method === 'POST') { posts++; throw new Error('lost response'); }
    return Response.json({ warehouses: [], revision: 0 });
  } });
  await store.load(); await assert.rejects(store.save([{ id: 'new', name: '新' }]));
  await assert.rejects(store.retry(), /结果不确定/); assert.equal(posts, 1);
});

test('updated time has compact Chinese date using the requested timezone', () => {
  const options = { now: new Date('2026-09-13T08:00:00Z'), timeZone: 'Asia/Shanghai' };
  assert.equal(formatWarehouseUpdatedAt('2026-09-13T05:25:17.556Z', options), '今天 13:25 更新');
  assert.equal(formatWarehouseUpdatedAt('2026-09-12T05:25:17.556Z', options), '2026/09/12 13:25 更新');
  assert.equal(formatWarehouseUpdatedAt('invalid', options), '');
});

test('reload saves account-scoped recovery before clearing pending and retains earlier backups', async () => {
  const f = fixture(), store = f.make(); const records = await store.load(); records[0].name = '未保存副本'; f.setFail(true);
  await assert.rejects(store.save(records));
  assert.equal((await store.discardAndReload())[0].name, '仓库');
  assert.equal(store.getRecovery().entries[0].records[0].name, '未保存副本');
  assert.equal(f.make('other').getRecovery(), null);
  assert.equal(f.storage.getItem('squirrel-cloud-pending:u'), null);
  const next = await store.load(); next[0].name = '第二次副本'; await assert.rejects(store.save(next)); await store.discardAndReload();
  assert.equal(store.getRecovery().entries.length, 2);
});

test('backup storage failure leaves the only pending copy intact', async () => {
  const f = fixture(), store = f.make(); const records = await store.load(); records[0].name = '珍贵草稿'; f.setFail(true);
  await assert.rejects(store.save(records));
  const set = f.storage.setItem;
  f.storage.setItem = (key, value) => { if (key.includes('backup')) throw new Error('空间不足'); set(key, value); };
  await assert.rejects(store.discardAndReload(), /空间不足/);
  assert.equal(store.blocked, true);
  assert.equal(store.getPendingBackups()[0].records[0].name, '珍贵草稿');
});

test('another open tab succeeding cannot erase an earlier failed task', async () => {
  const f = fixture(), a = f.make(), b = f.make();
  const aRecords = await a.load(), bRecords = await b.load();
  aRecords[0].name = 'A未保存'; bRecords[0].name = 'B已保存';
  f.setFail(true); await assert.rejects(a.save(aRecords));
  f.setFail(false); await b.save(bRecords);
  const restored = f.make(); assert.equal((await restored.load())[0].name, 'A未保存');
  assert.equal(restored.getPendingBackups().length, 1);
  assert.equal(f.details[0].snapshot.name, 'B已保存');
});

test('two open tabs failing keep separate tasks and export both', async () => {
  const f = fixture(), a = f.make(), b = f.make();
  const aRecords = await a.load(), bRecords = await b.load();
  aRecords[0].name = 'A草稿'; bRecords[0].name = 'B草稿'; f.setFail(true);
  await Promise.all([assert.rejects(a.save(aRecords)), assert.rejects(b.save(bRecords))]);
  assert.deepEqual(a.getPendingBackups().map((task) => task.records[0].name).sort(), ['A草稿', 'B草稿']);
  assert.notEqual(a.getPendingBackups()[0].taskId, a.getPendingBackups()[1].taskId);
});

test('offline reload exposes pending records and keeps writes blocked', async () => {
  const f = fixture(), a = f.make(); const records = await a.load(); records[0].name = '离线草稿'; f.setFail(true); await assert.rejects(a.save(records));
  const statuses = [];
  const offline = createCloudWarehouseStore({ userId: 'u', csrfToken: 'c', storage: f.storage, onStatus: (status) => statuses.push(status), fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await offline.load())[0].name, '离线草稿');
  assert.equal(offline.getPendingBackups()[0].records[0].name, '离线草稿');
  assert.equal(offline.blocked, true); assert.equal(statuses.at(-1).status, 'error');
});

test('legacy pending is imported without deleting original bytes or other tasks', async () => {
  const f = fixture(), a = f.make(); const records = await a.load(); records[0].name = '旧草稿'; f.setFail(true); await assert.rejects(a.save(records));
  const legacy = a.getPendingBackups()[0]; delete legacy.taskId;
  f.storage.setItem('squirrel-cloud-pending:u', JSON.stringify(legacy));
  const restored = f.make(); await restored.load();
  assert.equal(restored.getPendingBackups().length, 2);
  assert.equal(f.storage.getItem('squirrel-cloud-pending:u'), JSON.stringify(legacy));
  await restored.discardAndReload();
  assert.equal(restored.getPendingBackups().length, 1);
  assert.equal(f.storage.getItem('squirrel-cloud-pending:u'), JSON.stringify(legacy));
});

test('two tabs recovering one create task acquire a shared lock and POST only once', async () => {
  const storage = memoryStorage(), locks = memoryLocks();
  const pending = { taskId: 'shared-task', savedAt: '2026-09-13', records: [{ id: 'local', name: '新仓' }], base: [], createIds: {}, deletedIds: [], orderRevision: 0 };
  storage.setItem('squirrel-cloud-task:u:shared-task', JSON.stringify(pending));
  let posts = 0, details = [];
  const fetchImpl = async (path, options) => {
    if (options.method === 'POST') {
      posts++; await Promise.resolve();
      details = [{ id: 'server', revision: 0, snapshot: JSON.parse(options.body).snapshot }]; return Response.json(details[0]);
    }
    if (path === '/api/warehouses') return Response.json({ revision: details.length, warehouses: details });
    return Response.json(details[0]);
  };
  const make = () => createCloudWarehouseStore({ userId: 'u', csrfToken: 'c', storage, locks, fetchImpl });
  const a = make(), b = make(); await Promise.all([a.load(), b.load()]);
  const [first, second] = await Promise.all([a.retry(), b.retry()]);
  assert.equal(posts, 1); assert.equal(first[0].id, 'server'); assert.equal(second[0].id, 'server');
  assert.equal(storage.getItem('squirrel-cloud-task:u:shared-task'), null);
});

test('browsers without shared locks fail safely before a create request', async () => {
  const storage = memoryStorage(); let posts = 0;
  const store = createCloudWarehouseStore({ userId: 'u', csrfToken: 'c', storage, locks: null, fetchImpl: async (_path, options) => {
    if (options.method === 'POST') posts++;
    return Response.json({ warehouses: [], revision: 0 });
  } });
  await store.load(); await assert.rejects(store.save([{ id: 'new', name: '新' }]), /无法安全协调/);
  assert.equal(posts, 0); assert.equal(store.getPendingBackups().length, 1);
});
