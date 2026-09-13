import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createPostgresTestContext } from "./postgres-test-support.js";
import { createProductionApi } from "./production-api.js";
import { createApplicationServer } from "../server.mjs";

test("cloud HTTP persists avatar, document, pinecones and sessions across API recreation", async () => {
  const context = await createPostgresTestContext();
  let api;
  let server;
  try {
    await context.reset();
    server = createApplicationServer({ apiHandler: (request) => api.handle(request) });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const env = { APP_ENV: "development", DATABASE_URL: process.env.TEST_DATABASE_URL,
      ALLOWED_ORIGINS: origin, AUTH_HASH_SECRET: randomBytes(32).toString("hex"), CSRF_TOKEN_SECRET: randomBytes(32).toString("hex") };
    api = createProductionApi({ env });
    await api.ready();
    let cookies = new Map();
    let csrf = "";
    const call = async (path, method = "GET", body) => {
      const response = await fetch(origin + path, { method, headers: { origin, "content-type": "application/json",
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "), "x-csrf-token": csrf },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";", 1)[0]; const index = pair.indexOf("="); cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      const data = response.status === 204 ? null : await response.json();
      if (data?.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    };
    assert.equal((await call("/api/auth/email-code", "POST", { email: "cloud-acceptance@example.test" })).status, 202);
    assert.equal((await call("/api/auth/verify", "POST", { email: "cloud-acceptance@example.test", code: "123456" })).status, 200);
    const snapshot = { schema_version: 1, name: "云端验收", avatar: "data:image/webp;base64," + "A".repeat(24000),
      shelves: [{ id: "s1", name: "分区" }], pinecones: [{ id: "p1", content: "保留内容", shelfId: "s1", status: "shelved" }],
      document: { title: "云端验收", sections: [{ shelfId: "s1", heading: "用户修改", summary: "批注", bullets: [{ text: "手动编辑", pineconeIds: ["p1"] }] }] } };
    const created = await call("/api/warehouses", "POST", { snapshot });
    assert.equal(created.status, 201);
    const id = created.data.id;
    const edited = structuredClone(snapshot); edited.pinecones[0].content = "云端已编辑";
    assert.equal((await call(`/api/warehouses/${id}`, "PUT", { revision: 0, snapshot: edited })).status, 200);
    assert.equal((await call(`/api/warehouses/${id}`, "PUT", { revision: 0, snapshot })).data.error.code, "REVISION_CONFLICT");
    await api.close(); api = createProductionApi({ env }); await api.ready();
    assert.equal((await call("/api/auth/session")).status, 200);
    const restored = await call(`/api/warehouses/${id}`);
    assert.equal(restored.status, 200); assert.deepEqual(restored.data.snapshot, edited);
    assert.equal((await call(`/api/warehouses/${id}`, "DELETE", { revision: restored.data.revision })).status, 204);
    assert.equal((await call("/api/warehouses")).data.warehouses.length, 0);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (api) await api.close();
    await context.reset(); await context.close();
  }
});
