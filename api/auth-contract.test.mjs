import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../db/migrations/0002_auth_hardening.sql", import.meta.url);
const envPath = new URL("../.env.example", import.meta.url);
const serverPath = new URL("../server.mjs", import.meta.url);
const errorsPath = new URL("../contracts/error-codes.json", import.meta.url);

test("auth hardening migration supports IP limits, delivery state, and absolute session expiry", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /ADD COLUMN request_ip inet NOT NULL/);
  assert.match(sql, /ADD COLUMN delivery_status text NOT NULL/);
  assert.match(sql, /ADD COLUMN absolute_expires_at timestamptz/);
  assert.match(sql, /ALTER COLUMN absolute_expires_at SET NOT NULL/);
  assert.match(sql, /created_at \+ interval '30 days'/);
  assert.match(sql, /email_challenges_ip_created_idx/);
  assert.match(sql, /email_challenges_one_active_per_email/);
  assert.match(sql, /CHECK \(failed_attempts BETWEEN 0 AND 5\)/);
});

test("environment template declares empty production secrets and explicit auth origins", async () => {
  const env = await readFile(envPath, "utf8");
  for (const key of ["AUTH_HASH_SECRET", "ALLOWED_ORIGINS", "EMAIL_PROVIDER_ENDPOINT", "EMAIL_PROVIDER_API_KEY"]) {
    assert.match(env, new RegExp(`^${key}=$`, "m"));
  }
  assert.doesNotMatch(env, /AUTH_HASH_SECRET=\S+/);
  assert.doesNotMatch(env, /EMAIL_PROVIDER_API_KEY=\S+/);
});

test("server delegates API paths, selects explicit composition, and keeps configuration secrets out of source", async () => {
  const server = await readFile(serverPath, "utf8");
  assert.match(server, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(server, /API_CONFIGURATION_INVALID/);
  assert.match(server, /createProductionApi/);
  assert.match(server, /LOCAL_DEVELOPMENT_AUTH === "true"/);
  assert.match(server, /requestTimeout = 15_000/);
  assert.doesNotMatch(server, /createMemoryAuthRepository/);
  assert.doesNotMatch(server, /console\.log\([^\n]*(code|token|cookie)/i);
});

test("authentication failures have stable safe error mappings", async () => {
  const errors = JSON.parse(await readFile(errorsPath, "utf8"));
  assert.equal(errors.EMAIL_CODE_COOLDOWN.httpStatus, 429);
  assert.equal(errors.EMAIL_CODE_INVALID.httpStatus, 422);
  assert.equal(errors.EMAIL_DELIVERY_UNAVAILABLE.httpStatus, 503);
  assert.equal(errors.ORIGIN_INVALID.httpStatus, 403);
  assert.equal(errors.INTERNAL_ERROR.httpStatus, 500);
  assert.equal(errors.SERVICE_NOT_CONFIGURED.httpStatus, 503);
  assert.deepEqual(errors.SERVICE_UNAVAILABLE, { httpStatus: 503, message: "服务暂时不可用，请稍后重试" });
});
