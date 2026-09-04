import assert from "node:assert/strict";
import test from "node:test";

import { createAuthFlow } from "./auth-flow.js";

function response(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("restore distinguishes an active session from an unauthenticated visitor", async () => {
  const active = createAuthFlow({ fetchImpl: async () => response(200, { user: { id: "u1", email: "a@example.com" }, csrfToken: "fresh-csrf" }) });
  assert.equal((await active.restore()).status, "authenticated");
  assert.equal(active.getState().user.email, "a@example.com");
  assert.equal(active.getState().csrfToken, "fresh-csrf");

  const visitor = createAuthFlow({ fetchImpl: async () => response(401, { error: { code: "AUTH_REQUIRED", message: "请登录" } }) });
  assert.equal((await visitor.restore()).status, "email");
});

test("resend remains unavailable until the server cooldown expires", async () => {
  let now = 1_000;
  let sends = 0;
  const flow = createAuthFlow({ clock: () => now, fetchImpl: async () => { sends += 1; return response(202, { retryAfterSeconds: 60 }); } });
  await flow.requestCode("a@example.com");
  assert.equal(flow.getState().retryAfterSeconds, 60);
  await assert.rejects(() => flow.resendCode(), { code: "EMAIL_CODE_COOLDOWN" });
  now += 61_000;
  assert.equal(flow.getState().retryAfterSeconds, 0);
  await flow.resendCode();
  assert.equal(sends, 2);
});

test("email and code submissions advance the flow and retain csrf", async () => {
  const calls = [];
  const flow = createAuthFlow({ fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("email-code")) return response(202, { retryAfterSeconds: 60 });
    return response(200, { user: { id: "u1", email: "a@example.com" }, csrfToken: "csrf" });
  } });

  assert.equal((await flow.requestCode(" A@Example.com ")).status, "code");
  assert.equal(flow.getState().email, "a@example.com");
  assert.equal((await flow.verifyCode("123456")).status, "authenticated");
  assert.equal(flow.getState().csrfToken, "csrf");
  assert.equal(JSON.parse(calls[0].options.body).email, "a@example.com");
});

test("api errors are shown safely and logout returns to the email step", async () => {
  let logoutHeaders;
  const flow = createAuthFlow({ fetchImpl: async (url, options = {}) => {
    if (url.endsWith("email-code")) return response(422, { error: { code: "EMAIL_INVALID", message: "请输入有效的邮箱地址" } });
    logoutHeaders = options.headers;
    return response(204);
  } });
  await assert.rejects(() => flow.requestCode("bad"), { code: "EMAIL_INVALID" });
  assert.equal(flow.getState().error, "请输入有效的邮箱地址");

  flow.hydrate({ user: { id: "u1", email: "a@example.com" }, csrfToken: "csrf" });
  assert.equal((await flow.logout()).status, "email");
  assert.equal(logoutHeaders["x-csrf-token"], "csrf");
});

test("guest access persists locally and restores without calling the auth API", async () => {
  const storage = new Map();
  let apiCalls = 0;
  const options = {
    guestStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetchImpl: async () => { apiCalls += 1; return response(500); },
  };
  const first = createAuthFlow(options);
  assert.equal(first.enterGuest().user.isGuest, true);

  const restored = createAuthFlow(options);
  assert.equal((await restored.restore()).user.id, "guest");
  assert.equal(apiCalls, 0);
});

test("leaving guest mode clears only the local guest marker", async () => {
  const storage = new Map();
  let apiCalls = 0;
  const flow = createAuthFlow({
    guestStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetchImpl: async () => { apiCalls += 1; return response(500); },
  });
  flow.enterGuest();
  assert.equal((await flow.logout()).status, "email");
  assert.equal(storage.size, 0);
  assert.equal(apiCalls, 0);
});
