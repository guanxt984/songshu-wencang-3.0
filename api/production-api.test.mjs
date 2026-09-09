import assert from "node:assert/strict";
import test from "node:test";

import { createProductionApi, readProductionConfig } from "./production-api.js";

const productionEnv = {
  APP_ENV: "production",
  DATABASE_URL: "postgresql://app-user:database-password@db.example.test:5432/nestnote",
  AUTH_HASH_SECRET: "auth-secret-value",
  CSRF_TOKEN_SECRET: "csrf-secret-value",
  ALLOWED_ORIGINS: "https://app.example.test, https://admin.example.test",
};

test("production configuration rejects missing required values without exposing them", () => {
  for (const key of ["DATABASE_URL", "AUTH_HASH_SECRET", "CSRF_TOKEN_SECRET", "ALLOWED_ORIGINS"]) {
    const env = { ...productionEnv, [key]: "" };
    assert.throws(() => readProductionConfig(env), (error) => {
      assert.equal(error.message, "PRODUCTION_CONFIG_INVALID");
      for (const value of Object.values(env).filter(Boolean)) assert.doesNotMatch(error.message, new RegExp(escapeRegExp(value)));
      return true;
    });
  }
});

test("production configuration rejects local development auth without exposing environment values", () => {
  const env = { ...productionEnv, LOCAL_DEVELOPMENT_AUTH: "true" };
  assert.throws(() => readProductionConfig(env), (error) => {
    assert.equal(error.message, "PRODUCTION_CONFIG_INVALID");
    assert.doesNotMatch(error.message, /database-password|auth-secret-value|csrf-secret-value/);
    return true;
  });
});

test("production configuration normalizes comma-separated exact HTTPS origins", () => {
  assert.deepEqual(readProductionConfig(productionEnv), {
    appEnvironment: "production",
    allowedOrigins: ["https://app.example.test", "https://admin.example.test"],
  });
});

test("production configuration rejects unsafe allowed origins", () => {
  for (const origins of [
    "*",
    "http://app.example.test",
    "https://user:password@app.example.test",
    "https://app.example.test/path",
    "https://app.example.test?query=value",
    "https://app.example.test#fragment",
  ]) {
    assert.throws(
      () => readProductionConfig({ ...productionEnv, ALLOWED_ORIGINS: origins }),
      { message: "PRODUCTION_CONFIG_INVALID" },
    );
  }
});

test("production composition requires an injected mailer before creating a database pool", () => {
  let constructed = false;
  class PoolClass {
    constructor() { constructed = true; }
  }
  assert.throws(
    () => createProductionApi({ env: productionEnv, PoolClass }),
    { message: "PRODUCTION_MAILER_REQUIRED" },
  );
  assert.equal(constructed, false);
});

test("development PostgreSQL verification alone may use the fixed local code and no-op mailer", async () => {
  const pool = new FakePool();
  const api = createProductionApi({
    env: {
      ...productionEnv,
      APP_ENV: "development",
      ALLOWED_ORIGINS: "http://127.0.0.1:5180",
    },
    PoolClass: class { constructor() { return pool; } },
  });
  assert.equal((await api.handle(request("/api/auth/email-code", {
    body: { email: "person@example.test" },
  }))).status, 403);

  const localRequest = new Request("http://127.0.0.1:5180/api/auth/email-code", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:5180", "content-type": "application/json" },
    body: JSON.stringify({ email: "person@example.test" }),
  });
  assert.equal((await api.handle(localRequest)).status, 202);
  const verified = await api.handle(new Request("http://127.0.0.1:5180/api/auth/verify", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:5180", "content-type": "application/json" },
    body: JSON.stringify({ email: "person@example.test", code: "123456" }),
  }));
  assert.equal(verified.status, 200);
  assert.doesNotMatch(verified.headers.get("set-cookie"), /Secure/);
  await api.close();
});

test("production composition injects persistent services, sends mail, issues secure cookies, and closes its pool", async () => {
  const pool = new FakePool();
  const api = createProductionApi({
    env: productionEnv,
    PoolClass: class { constructor() { return pool; } },
    mailer: { sendCode: async ({ email, code }) => { pool.sent = { email, code }; } },
  });
  const requestCode = await api.handle(request("/api/auth/email-code", {
    body: { email: "person@example.test" },
  }));
  assert.equal(requestCode.status, 202);
  assert.equal(pool.sent.email, "person@example.test");
  assert.match(pool.sent.code, /^\d{6}$/);

  const verified = await api.handle(request("/api/auth/verify", {
    body: { email: "person@example.test", code: pool.sent.code },
  }));
  assert.equal(verified.status, 200);
  assert.match(verified.headers.get("set-cookie"), /Secure/);

  await api.close();
  assert.equal(pool.ended, 1);
});

function request(path, { body }) {
  return new Request(`https://app.example.test${path}`, {
    method: "POST",
    headers: { origin: "https://app.example.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

class FakePool {
  constructor() {
    this.challenge = null;
    this.sent = null;
    this.ended = 0;
    this.client = { query: (text, values) => this.query(text, values), release() {} };
  }

  async connect() { return this.client; }
  async end() { this.ended += 1; }

  async query(text, values = []) {
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK" || text.startsWith("SET ") || text.startsWith("SELECT pg_advisory")) return { rows: [] };
    if (text.startsWith("SELECT created_at FROM email_challenges")) return { rows: [] };
    if (text.startsWith("SELECT count(*)::integer AS count FROM email_challenges")) return { rows: [{ count: 0 }] };
    if (text.startsWith("UPDATE email_challenges SET consumed_at") && text.includes("WHERE email_normalized")) return { rows: [] };
    if (text.startsWith("INSERT INTO email_challenges")) {
      this.challenge = {
        id: values[0], email_normalized: values[1], request_ip: values[2], code_hash: values[3], expires_at: values[4],
        failed_attempts: values[5], consumed_at: values[6], delivery_status: values[7], created_at: values[8],
      };
      return { rows: [this.challenge] };
    }
    if (text.startsWith("UPDATE email_challenges SET delivery_status")) {
      this.challenge.delivery_status = values[1];
      return { rows: [this.challenge] };
    }
    if (text.startsWith("SELECT id, email_normalized, request_ip, code_hash")) return { rows: this.challenge ? [this.challenge] : [] };
    if (text.startsWith("UPDATE email_challenges SET consumed_at") && text.includes("RETURNING id")) return { rows: this.challenge ? [{ id: this.challenge.id }] : [] };
    if (text.startsWith("INSERT INTO users")) return { rows: [{ id: "user-id", email_normalized: values[1], status: "active", created_at: values[2] }] };
    if (text.startsWith("INSERT INTO sessions")) return { rows: [{ id: values[0], user_id: values[1], token_hash: values[2], expires_at: values[3], absolute_expires_at: values[4], revoked_at: values[5] }] };
    throw new Error(`Unexpected query: ${text}`);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
