import assert from "node:assert/strict";
import test from "node:test";

import { createLocalDevelopmentApi } from "./local-development.js";

const origin = "http://127.0.0.1:5180";
const request = (path, { method = "GET", body, cookie, csrf } = {}) => new Request(`${origin}${path}`, {
  method,
  headers: { origin, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

test("local development API supports the complete login and authenticated warehouse flow", async () => {
  const api = createLocalDevelopmentApi({ allowedOrigins: [origin] });
  assert.equal((await api.handle(request("/api/auth/email-code", { method: "POST", body: { email: "a@example.com" } }))).status, 202);
  const verified = await api.handle(request("/api/auth/verify", { method: "POST", body: { email: "a@example.com", code: api.verificationCode } }));
  assert.equal(verified.status, 200);
  const payload = await verified.json();
  const cookies = verified.headers.get("set-cookie");
  const session = /nestnote_session=([^;,]+)/.exec(cookies)?.[1];
  assert.ok(session);

  const listed = await api.handle(request("/api/warehouses", { cookie: `nestnote_session=${session}` }));
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { revision: 0, warehouses: [] });
  assert.match(payload.csrfToken, /^[a-f0-9]{32}$/);
});

test("local development API rejects origins it was not configured to trust", async () => {
  const api = createLocalDevelopmentApi({ allowedOrigins: [origin] });
  const foreign = new Request("http://127.0.0.1:5180/api/auth/email-code", {
    method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ email: "a@example.com" }),
  });
  assert.equal((await api.handle(foreign)).status, 403);
});
