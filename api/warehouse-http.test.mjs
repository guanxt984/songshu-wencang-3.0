import assert from "node:assert/strict";
import test from "node:test";

import { createApiHandler } from "./http-handler.js";
import { createMemoryWarehouseRepository } from "./memory-warehouse-repository.js";
import { createWarehouseService } from "./warehouse-service.js";

const validSnapshot = (name = "测试仓") => ({ schema_version: 1, name, document: {}, shelves: [], pinecones: [] });

function setup() {
  let id = 0;
  const warehouseService = createWarehouseService({
    repository: createMemoryWarehouseRepository(),
    idGenerator: (kind) => `${kind}-${++id}`,
    clock: () => new Date("2026-09-02T00:00:00.000Z"),
  });
  const authService = {
    getSession: async (token) => token === "token-a" ? { userId: "user-a", email: "a@example.com" } : token === "token-b" ? { userId: "user-b", email: "b@example.com" } : null,
  };
  return createApiHandler({ authService, warehouseService, allowedOrigins: ["https://app.example.com"], secureCookies: true });
}

function request(path, { method = "GET", body, authenticated = true, csrf = true } = {}) {
  const headers = { origin: "https://app.example.com" };
  if (authenticated) headers.cookie = `nestnote_session=token-a${csrf ? "; nestnote_csrf=csrf" : ""}`;
  if (csrf) headers["x-csrf-token"] = "csrf";
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://api.example.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

test("warehouse routes require authentication and mutations require CSRF", async () => {
  const handle = setup();
  const anonymous = await handle(request("/api/warehouses", { authenticated: false, csrf: false }));
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, "AUTH_REQUIRED");

  const missingCsrf = await handle(request("/api/warehouses", { method: "POST", body: { snapshot: validSnapshot() }, csrf: false }));
  assert.equal(missingCsrf.status, 403);
  assert.equal((await missingCsrf.json()).error.code, "CSRF_INVALID");
});

test("create, list, get, update, reorder and delete follow the HTTP contract", async () => {
  const handle = setup();
  const createdResponse = await handle(request("/api/warehouses", { method: "POST", body: { snapshot: validSnapshot("初始") } }));
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const listResponse = await handle(request("/api/warehouses"));
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).warehouses[0].id, created.id);

  assert.equal((await handle(request(`/api/warehouses/${created.id}`))).status, 200);
  const savedResponse = await handle(request(`/api/warehouses/${created.id}`, { method: "PUT", body: { revision: 0, snapshot: validSnapshot("更新") } }));
  assert.equal(savedResponse.status, 200);
  assert.equal((await savedResponse.json()).revision, 1);

  const conflict = await handle(request(`/api/warehouses/${created.id}`, { method: "PUT", body: { revision: 0, snapshot: validSnapshot("过期") } }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "REVISION_CONFLICT");

  const reordered = await handle(request("/api/warehouses/order", { method: "PUT", body: { revision: 1, warehouseIds: [created.id] } }));
  assert.equal(reordered.status, 200);
  assert.equal((await reordered.json()).revision, 2);

  assert.equal((await handle(request(`/api/warehouses/${created.id}`, { method: "DELETE", body: { revision: 1 } }))).status, 204);
});

test("a warehouse owned by another user is indistinguishable from a missing warehouse", async () => {
  const handle = setup();
  const created = await (await handle(request("/api/warehouses", { method: "POST", body: { snapshot: validSnapshot() } }))).json();
  const otherUserRequest = new Request(`https://api.example.com/api/warehouses/${created.id}`, {
    headers: { origin: "https://app.example.com", cookie: "nestnote_session=token-b" },
  });
  const response = await handle(otherUserRequest);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "WAREHOUSE_NOT_FOUND");
});

test("import endpoint returns an idempotent result", async () => {
  const handle = setup();
  const body = { idempotencyKey: "batch", warehouses: [validSnapshot("导入仓")] };
  const first = await handle(request("/api/import", { method: "POST", body }));
  const retry = await handle(request("/api/import", { method: "POST", body }));
  assert.equal(first.status, 200);
  assert.deepEqual(await retry.json(), await first.json());
});
