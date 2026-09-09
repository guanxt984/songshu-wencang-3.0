import assert from "node:assert/strict";
import test from "node:test";

import { createAuthService } from "./auth-service.js";
import { createApiHandler } from "./http-handler.js";
import { createMemoryAuthRepository } from "./memory-auth-repository.js";

function setup() {
  const service = createAuthService({
    repository: createMemoryAuthRepository(),
    mailer: { sendCode: async () => {} },
    clock: () => new Date("2026-09-01T00:00:00.000Z"),
    randomInt: () => 123456,
    secret: "test-secret",
  });
  return createApiHandler({ authService: service, allowedOrigins: ["https://app.example.com"], secureCookies: true });
}

function request(path, { method = "GET", body, headers = {} } = {}) {
  return new Request(`https://api.example.com${path}`, {
    method,
    headers: { origin: "https://app.example.com", ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("email code request and verification return safe responses and secure cookies", async () => {
  const handle = setup();
  const sent = await handle(request("/api/auth/email-code", { method: "POST", body: { email: "a@example.com" }, headers: { "x-forwarded-for": "203.0.113.10" } }));
  assert.equal(sent.status, 202);
  assert.deepEqual(await sent.json(), { retryAfterSeconds: 60 });

  const verified = await handle(request("/api/auth/verify", { method: "POST", body: { email: "a@example.com", code: "123456" } }));
  const payload = await verified.json();
  assert.equal(verified.status, 200);
  assert.equal(payload.user.email, "a@example.com");
  assert.match(verified.headers.get("set-cookie"), /nestnote_session=.*HttpOnly.*Secure.*SameSite=Lax/i);
  assert.equal("sessionToken" in payload, false);
  assert.match(payload.csrfToken, /^[a-f0-9]{32}$/);
});

test("email code requests use the configured client-IP resolver", async () => {
  let receivedIp;
  const handle = createApiHandler({
    authService: {
      requestEmailCode: async ({ ip }) => {
        receivedIp = ip;
        return { retryAfterSeconds: 60 };
      },
    },
    allowedOrigins: ["https://app.example.com"],
    resolveClientIp: (incoming) => incoming.socket.remoteAddress,
  });
  const incoming = request("/api/auth/email-code", {
    method: "POST",
    body: { email: "a@example.com" },
    headers: { "x-forwarded-for": "192.0.2.250" },
  });
  Object.defineProperty(incoming, "socket", { value: { remoteAddress: "203.0.113.40" } });

  assert.equal((await handle(incoming)).status, 202);
  assert.equal(receivedIp, "203.0.113.40");
});

test("session endpoint authenticates from the session cookie", async () => {
  const handle = setup();
  await handle(request("/api/auth/email-code", { method: "POST", body: { email: "a@example.com" } }));
  const verified = await handle(request("/api/auth/verify", { method: "POST", body: { email: "a@example.com", code: "123456" } }));
  const cookie = verified.headers.get("set-cookie").split(";")[0];
  const response = await handle(request("/api/auth/session", { headers: { cookie } }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user.email, "a@example.com");
  assert.match(payload.csrfToken, /^[a-f0-9]{32}$/);
});

test("logout requires matching Origin and double-submit CSRF token", async () => {
  const handle = setup();
  const foreign = await handle(request("/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } }));
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error.code, "ORIGIN_INVALID");

  const missing = await handle(request("/api/auth/logout", { method: "POST" }));
  assert.equal(missing.status, 403);
  assert.equal((await missing.json()).error.code, "CSRF_INVALID");
});

test("logout clears both session and CSRF cookies", async () => {
  const handle = setup();
  const response = await handle(request("/api/auth/logout", {
    method: "POST",
    headers: { cookie: "nestnote_session=abc; nestnote_csrf=csrf", "x-csrf-token": "csrf" },
  }));
  assert.equal(response.status, 204);
  assert.match(response.headers.get("set-cookie"), /nestnote_session=.*Max-Age=0/i);
  assert.match(response.headers.get("set-cookie"), /nestnote_csrf=.*Max-Age=0/i);
});

test("unknown service failures return a safe 500 instead of a validation error", async () => {
  const handle = createApiHandler({
    authService: { requestEmailCode: async () => { throw new Error("database details"); } },
    allowedOrigins: ["https://app.example.com"],
  });
  const response = await handle(request("/api/auth/email-code", { method: "POST", body: { email: "a@example.com" } }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" } });
});

test("repository service-unavailable failures return a safe public 503", async () => {
  const handle = createApiHandler({
    authService: {
      requestEmailCode: async () => {
        throw Object.assign(new Error("postgresql://secret@db.internal/app"), { code: "SERVICE_UNAVAILABLE" });
      },
    },
    allowedOrigins: ["https://app.example.com"],
  });

  const response = await handle(request("/api/auth/email-code", {
    method: "POST",
    body: { email: "a@example.com" },
  }));

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.deepEqual(body, { error: { code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用，请稍后重试" } });
  assert.doesNotMatch(JSON.stringify(body), /postgresql|secret|db\.internal/i);
});

test("driver error codes and malformed path encodings are never exposed", async () => {
  const driverFailure = createApiHandler({
    authService: { getSession: async () => ({ userId: "user-a", email: "a@example.com" }) },
    warehouseService: { listWarehouses: async () => { throw Object.assign(new Error("duplicate"), { code: "23505" }); } },
    allowedOrigins: ["https://app.example.com"],
  });
  const response = await driverFailure(new Request("https://app.example.com/api/warehouses", { headers: { cookie: "nestnote_session=x" } }));
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, "INTERNAL_ERROR");

  const malformed = await driverFailure(new Request("https://app.example.com/api/warehouses/%", { headers: { cookie: "nestnote_session=x" } }));
  assert.equal(malformed.status, 422);
});

test("handler rejects malformed JSON, oversized bodies, and unknown routes", async () => {
  const handle = setup();
  const malformed = await handle(new Request("https://api.example.com/api/auth/email-code", {
    method: "POST",
    headers: { origin: "https://app.example.com", "content-type": "application/json" },
    body: "{",
  }));
  assert.equal(malformed.status, 422);

  const oversized = await handle(request("/api/auth/email-code", { method: "POST", body: { email: `${"a".repeat(1_048_577)}@example.com` } }));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "REQUEST_TOO_LARGE");

  assert.equal((await handle(request("/api/unknown"))).status, 404);
});
