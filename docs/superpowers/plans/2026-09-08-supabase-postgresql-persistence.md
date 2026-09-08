# Supabase PostgreSQL Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace process-memory authentication and warehouse storage with standard PostgreSQL repositories suitable for Supabase while preserving the existing service contracts and local demo mode.

**Architecture:** The domain services continue to depend on injected repository interfaces. A small `pg` connection module owns pooling and transactions; focused PostgreSQL repositories map rows to existing domain objects. A production composition root validates configuration and injects the persistent repositories, while explicit localhost development continues to use memory repositories.

**Tech Stack:** Node.js ES modules, `pg`, PostgreSQL 15+, Node test runner, existing Fetch-based HTTP API

**Spec:** `docs/superpowers/specs/2026-09-08-supabase-postgresql-persistence-design.md`

## Global Constraints

- Use only standard PostgreSQL protocol and `DATABASE_URL`; do not add Supabase client SDKs or expose database credentials to the browser.
- All SQL containing request values must be parameterized.
- Every warehouse read and write must include both `user_id` and the relevant resource ID.
- Production must fail closed when database or security configuration is missing and must never select memory repositories.
- Existing memory repositories remain available only for unit tests and explicit localhost development.
- Never log database URLs, email verification codes, session tokens, pinecone content, or snapshots.
- Do not modify migrations `0001` or `0002`; add forward-only migrations.
- A task is complete only after its focused tests and all previously completed tests pass.

## File Structure

- `api/postgres-database.js`: create and close the `pg` pool; provide transaction execution.
- `api/postgres-auth-repository.js`: persistent implementation of the existing authentication repository contract.
- `api/postgres-warehouse-repository.js`: persistent implementation of the existing warehouse repository contract.
- `api/production-api.js`: validate production configuration and compose services with PostgreSQL repositories.
- `api/postgres-test-support.js`: integration-test schema setup, migration application, cleanup and availability guard.
- `db/migrations/0003_postgresql_repository_support.sql`: forward-only indexes and reorder-safe position constraint.
- `scripts/migrate.js`: ordered migration runner backed by a `schema_migrations` table.
- `server.mjs`: select explicit local or PostgreSQL composition and close resources on shutdown.
- `.env.example`: document persistent runtime and test database variables.
- `package.json` / `package-lock.json`: add `pg`, migration and PostgreSQL test commands.

---

### Task 1: PostgreSQL Connection and Migration Boundary

**Files:**
- Create: `api/postgres-database.test.mjs`
- Create: `api/postgres-database.js`
- Create: `scripts/migrate.test.mjs`
- Create: `scripts/migrate.js`
- Create: `db/migrations/0003_postgresql_repository_support.sql`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `createPostgresDatabase({ connectionString, poolOptions?, PoolClass? })` returning `{ query(text, values), withTransaction(work), close() }`.
- Produces: `runMigrations({ database, migrationsDirectory })` returning `{ applied: string[] }`.
- Consumes: `DATABASE_URL` only in the CLI entrypoint, never at module import time.

- [ ] **Step 1: Add the PostgreSQL driver**

Run: `npm install pg@^8.16.3`

Expected: `package.json` declares `pg` and the lockfile records the exact resolved dependency tree.

- [ ] **Step 2: Write failing database boundary tests**

Create tests using an injected fake `PoolClass` that assert:

```js
const database = createPostgresDatabase({
  connectionString: "postgresql://example.invalid/test",
  PoolClass: FakePool,
  poolOptions: { max: 4 },
});
assert.deepEqual(FakePool.options, {
  connectionString: "postgresql://example.invalid/test",
  max: 4,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 10_000,
});
assert.equal(await database.withTransaction(async (client) => {
  await client.query("SELECT $1::int AS value", [7]);
  return "committed";
}), "committed");
assert.deepEqual(FakePool.transactionCommands, ["BEGIN", "COMMIT"]);
```

Add a rejection test that verifies `ROLLBACK` and client release when `work` throws, plus tests for missing connection string and idempotent `close()`.

- [ ] **Step 3: Run the database test to verify RED**

Run: `node --test api/postgres-database.test.mjs`

Expected: FAIL because `api/postgres-database.js` does not exist.

- [ ] **Step 4: Implement the connection boundary**

Implement `createPostgresDatabase` with `pg.Pool` as the default `PoolClass`, bounded defaults shown in Step 2, `BEGIN`/`COMMIT`/`ROLLBACK`, `finally { client.release(); }`, and an idempotent `close()` that calls `pool.end()` once.

- [ ] **Step 5: Run the database test to verify GREEN**

Run: `node --test api/postgres-database.test.mjs`

Expected: PASS.

- [ ] **Step 6: Write failing migration-runner tests**

Use a temporary migration directory and a fake transactional database. Assert that `runMigrations`:

```js
await writeFixture("0001_first.sql", "CREATE TABLE first_table(id int);");
await writeFixture("0002_second.sql", "CREATE TABLE second_table(id int);");
const first = await runMigrations({ database, migrationsDirectory });
assert.deepEqual(first.applied, ["0001_first.sql", "0002_second.sql"]);
const second = await runMigrations({ database, migrationsDirectory });
assert.deepEqual(second.applied, []);
```

Also assert lexicographic ordering, one transaction per file, rollback on SQL failure, and rejection of filenames outside `NNNN_name.sql`.

- [ ] **Step 7: Run the migration test to verify RED**

Run: `node --test scripts/migrate.test.mjs`

Expected: FAIL because `scripts/migrate.js` does not exist.

- [ ] **Step 8: Implement the migration runner and support migration**

`runMigrations` must create `schema_migrations(filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`, lock the table during each migration transaction, run unapplied files in order, and insert the filename only after its SQL succeeds.

Create `0003_postgresql_repository_support.sql` with:

```sql
CREATE INDEX IF NOT EXISTS sessions_active_token_idx
  ON sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_user_id_position_key;
ALTER TABLE warehouses
  ADD CONSTRAINT warehouses_user_id_position_key
  UNIQUE (user_id, position) DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS import_batches_user_key_idx
  ON import_batches (user_id, idempotency_key);
```

Add scripts `db:migrate` and `test:postgres` without placing credentials in command text.

- [ ] **Step 9: Run focused and existing tests**

Run: `node --test api/postgres-database.test.mjs scripts/migrate.test.mjs && npm run check`

Expected: all tests PASS.

- [ ] **Step 10: Commit Task 1**

```bash
git add package.json package-lock.json api/postgres-database.js api/postgres-database.test.mjs scripts/migrate.js scripts/migrate.test.mjs db/migrations/0003_postgresql_repository_support.sql
git commit -m "feat: add PostgreSQL connection and migrations"
```

---

### Task 2: Persistent Authentication Repository

**Files:**
- Create: `api/postgres-auth-repository.test.mjs`
- Create: `api/postgres-auth-repository.js`

**Interfaces:**
- Consumes: `{ query, withTransaction }` from `createPostgresDatabase`.
- Produces: `createPostgresAuthRepository({ database })` implementing `reserveChallenge`, `findLatestChallenge`, `updateChallenge`, `consumeChallengeIfActive`, `recordFailedAttempt`, `findOrCreateUser`, `createSession`, `touchSession`, `findSessionByHash`, `revokeSession`, and `findUserById`.
- Produces repository objects matching the current camelCase shapes consumed by `createAuthService`.

- [ ] **Step 1: Write failing query-contract tests**

Use a recording fake database and assert parameterized SQL plus row mapping. Cover at minimum:

```js
await repository.findSessionByHash("hash-value");
assert.match(database.last.text, /WHERE token_hash = \$1/);
assert.deepEqual(database.last.values, ["hash-value"]);
assert.deepEqual(result, {
  id: "session-id",
  userId: "user-id",
  tokenHash: "hash-value",
  expiresAt: new Date("2026-09-09T00:00:00Z"),
  absoluteExpiresAt: new Date("2026-10-08T00:00:00Z"),
  revokedAt: null,
});
```

Assert that `reserveChallenge` runs in a serializable transaction, takes a per-email and per-IP transactional advisory lock, counts only non-failed challenges within the supplied day, invalidates old active challenges, inserts one challenge, and maps unique/check violations to existing stable error codes.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node --test api/postgres-auth-repository.test.mjs`

Expected: FAIL because `api/postgres-auth-repository.js` does not exist.

- [ ] **Step 3: Implement row mapping and simple session/user methods**

Use a private `mapChallenge`, `mapSession`, and `mapUser`. Every lookup uses placeholders. `findOrCreateUser` uses `INSERT ... ON CONFLICT (email_normalized) DO UPDATE SET email_normalized = EXCLUDED.email_normalized RETURNING ...` and rejects users whose status is not `active`.

- [ ] **Step 4: Implement atomic challenge operations**

Within `reserveChallenge`, execute:

```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT pg_advisory_xact_lock(hashtextextended($1, 0));
SELECT pg_advisory_xact_lock(hashtextextended($2, 1));
```

Use distinct lock keys prefixed with `email:` and `ip:`. Check cooldown and daily limits, consume existing active challenges, then insert the new challenge. `recordFailedAttempt` and `consumeChallengeIfActive` must be single conditional `UPDATE ... RETURNING` statements.

- [ ] **Step 5: Run focused authentication tests**

Run: `node --test api/postgres-auth-repository.test.mjs api/auth-service.test.mjs api/http-handler.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add api/postgres-auth-repository.js api/postgres-auth-repository.test.mjs
git commit -m "feat: persist authentication in PostgreSQL"
```

---

### Task 3: Persistent Warehouse Repository

**Files:**
- Create: `api/postgres-warehouse-repository.test.mjs`
- Create: `api/postgres-warehouse-repository.js`

**Interfaces:**
- Consumes: `{ query, withTransaction }` from `createPostgresDatabase`.
- Produces: `createPostgresWarehouseRepository({ database })` implementing `listWithOrderRevision`, `list`, `get`, `create`, `updateIfRevision`, `deleteReadyIfRevision`, `getOrderRevision`, `reorderIfRevision`, `getImportBatch`, and `importEmptyBatch`.
- Returns the exact outcome strings and shapes expected by `createWarehouseService`.

- [ ] **Step 1: Write failing query-contract and mapping tests**

Use a recording transactional database. Assert that `get`, `updateIfRevision`, and `deleteReadyIfRevision` contain both `user_id = $1` and `id = $2`. Assert JSONB rows map to:

```js
{
  id: "warehouse-id",
  userId: "user-id",
  name: "产品资料",
  position: 0,
  schemaVersion: 1,
  revision: 2,
  status: "ready",
  activeAiJobId: null,
  snapshot: { version: 1, warehouse: {} },
  createdAt: new Date("2026-09-08T00:00:00Z"),
  updatedAt: new Date("2026-09-08T00:00:00Z"),
}
```

Cover `not_found`, `organizing`, `conflict`, and `updated` outcomes without relying on driver error messages.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node --test api/postgres-warehouse-repository.test.mjs`

Expected: FAIL because `api/postgres-warehouse-repository.js` does not exist.

- [ ] **Step 3: Implement reads, create, save and delete**

Use `SELECT ... FOR UPDATE` inside mutations. Lock the owning `users` row before create/delete/reorder, defer the position constraint while changing multiple positions, and increment `warehouse_order_revision` in the same transaction.

- [ ] **Step 4: Implement atomic reorder**

`reorderIfRevision(userId, revision, ids)` must lock the user and owned warehouses, verify the order revision, verify the exact ID set and `ready` statuses, execute `SET CONSTRAINTS warehouses_user_id_position_key DEFERRED`, update positions using `unnest($2::uuid[]) WITH ORDINALITY`, then increment the order revision.

- [ ] **Step 5: Implement atomic idempotent import**

Lock the user row, read an existing `(user_id, idempotency_key)` batch, compare its fingerprint, verify the account is empty and the batch has at most ten records, insert all warehouses, increment order revision, write the successful `import_batches` result, and return the recorded result. Any failure must roll back every insert.

- [ ] **Step 6: Run focused warehouse tests**

Run: `node --test api/postgres-warehouse-repository.test.mjs api/warehouse-service.test.mjs api/warehouse-http.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add api/postgres-warehouse-repository.js api/postgres-warehouse-repository.test.mjs
git commit -m "feat: persist warehouses in PostgreSQL"
```

---

### Task 4: Production Composition and Fail-Closed Startup

**Files:**
- Create: `api/production-api.test.mjs`
- Create: `api/production-api.js`
- Modify: `server.mjs`
- Modify: `server-response.test.mjs`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `createPostgresDatabase`, both PostgreSQL repository factories, existing services, and `createApiHandler`.
- Produces: `readProductionConfig(env)` returning normalized non-secret configuration.
- Produces: `createProductionApi({ env, PoolClass?, mailer })` returning `{ handle, close }`.
- Preserves: `createLocalDevelopmentApi` only when the explicit local development flag is enabled outside production.

- [ ] **Step 1: Write failing production configuration tests**

Assert that production rejects each missing required value and unsafe combinations:

```js
assert.throws(
  () => readProductionConfig({ APP_ENV: "production", LOCAL_DEVELOPMENT_AUTH: "true" }),
  { message: "PRODUCTION_CONFIG_INVALID" },
);
```

Verify errors never contain environment values. Verify comma-separated `ALLOWED_ORIGINS` becomes exact URL origins and rejects wildcard, non-HTTPS production origins, embedded credentials, paths, queries and fragments.

- [ ] **Step 2: Run the production test to verify RED**

Run: `node --test api/production-api.test.mjs`

Expected: FAIL because `api/production-api.js` does not exist.

- [ ] **Step 3: Implement production composition**

Create the database and repositories, inject `AUTH_HASH_SECRET` into `createAuthService`, require an injected mailer, set `secureCookies: true`, and return a `close` function. Do not import either memory repository in this module.

- [ ] **Step 4: Update server selection and shutdown**

Extract composition selection into a testable function. Selection rules:

```text
APP_ENV=production              -> production composition only
DATABASE_URL present            -> PostgreSQL composition
development + explicit local flag -> local memory composition
otherwise                       -> fail closed
```

Handle `SIGINT` and `SIGTERM` by stopping the HTTP server, awaiting composition `close()`, and then exiting. Keep secrets out of startup logging.

- [ ] **Step 5: Document environment variables**

Add `TEST_DATABASE_URL`, connection-pool guidance, production-only security requirements, and comments identifying Supabase direct versus transaction-pooler URLs. Keep every value blank.

- [ ] **Step 6: Run production and server tests**

Run: `node --test api/production-api.test.mjs server-response.test.mjs api/local-development.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add api/production-api.js api/production-api.test.mjs server.mjs server-response.test.mjs .env.example
git commit -m "feat: compose persistent production API"
```

---

### Task 5: Real PostgreSQL Integration Verification

**Files:**
- Create: `api/postgres-test-support.js`
- Create: `api/postgres-auth.integration.test.mjs`
- Create: `api/postgres-warehouse.integration.test.mjs`
- Modify: `package.json`
- Modify: `docs/松鼠文仓-产品实现链路与公开测试版方案.md`

**Interfaces:**
- Consumes: `TEST_DATABASE_URL`, `runMigrations`, and the production PostgreSQL repositories.
- Produces: `createPostgresTestContext()` returning `{ database, reset(), close() }` and refusing any database whose name does not end in `_test`.
- Produces: `npm run test:postgres`, which is mandatory in CI/release but separate from zero-config `npm run check`.

- [ ] **Step 1: Write the test-support safety tests**

Assert that missing `TEST_DATABASE_URL` reports a clear skip reason and that destructive cleanup refuses database names without `_test`. Cleanup must truncate only the explicitly enumerated application tables inside the test database.

- [ ] **Step 2: Implement test support**

Connect, read `current_database()`, enforce the `_test` suffix, run all migrations, and implement ordered `TRUNCATE ... RESTART IDENTITY CASCADE` for application tables. Never derive a cleanup target from a wildcard or user-controlled table name.

- [ ] **Step 3: Write authentication integration tests**

Using two separately created repository/database objects against the same test database, verify:

- a created user and session can be read after the first pool closes;
- concurrent code requests leave exactly one active challenge;
- concurrent verification consumes a code once;
- five concurrent wrong attempts invalidate the challenge;
- session renewal never exceeds `absolute_expires_at`.

- [ ] **Step 4: Write warehouse integration tests**

Verify:

- persisted warehouses survive pool recreation;
- user B cannot read, update or delete user A's warehouse;
- stale revision writes return `conflict`;
- organizing warehouses reject writes;
- create and delete advance `warehouse_order_revision`;
- multi-row reorder succeeds without temporary unique-position conflicts;
- an injected mid-import SQL failure rolls back warehouses and `import_batches`;
- retrying the same import key returns the stored result without duplicates.

- [ ] **Step 5: Run integration tests against a disposable Supabase or local test database**

Set `TEST_DATABASE_URL` in the process environment without printing it.

Run: `npm run test:postgres`

Expected: all PostgreSQL integration tests PASS and the process exits 0.

- [ ] **Step 6: Add all new checks to project verification**

Update `npm run check` to include syntax and non-database unit tests for every new module. Keep `npm run test:postgres` separate so local UI development remains zero-config. Document that both commands are required for release.

- [ ] **Step 7: Update the public-beta progress document**

Mark the PostgreSQL repositories and production composition as implemented. Explicitly retain “front-end cloud data source”, “real mail delivery”, and “real AI worker” as unfinished; do not describe persistence as publicly deployed until a real environment passes Task 5.

- [ ] **Step 8: Run final verification**

Run:

```bash
npm run check
npm run test:postgres
npm audit --omit=dev
git diff --check
git status --short
```

Expected: both test commands exit 0, audit reports no high or critical vulnerabilities, diff check has no output, and status contains only the intended Task 5 files before commit.

- [ ] **Step 9: Scan for secrets and unsafe repository queries**

Run:

```bash
rg -n "postgres(ql)?://|SUPABASE|DATABASE_URL=.*[^=]" --glob '!package-lock.json' --glob '!.env.example'
rg -n "WHERE id = \\$[0-9]+" api/postgres-warehouse-repository.js
```

Expected: no committed connection string or secret values; every warehouse-by-ID statement inspected from the second command also contains a `user_id` predicate.

- [ ] **Step 10: Commit Task 5**

```bash
git add api/postgres-test-support.js api/postgres-auth.integration.test.mjs api/postgres-warehouse.integration.test.mjs package.json docs/松鼠文仓-产品实现链路与公开测试版方案.md
git commit -m "test: verify PostgreSQL persistence end to end"
```

## Execution Checkpoints

- After Task 1: review connection lifecycle, migration idempotency and migration safety.
- After Task 2: review concurrency, token secrecy and challenge atomicity.
- After Task 3: review ownership predicates, revision behavior, transaction boundaries and import idempotency.
- After Task 4: review production fail-closed behavior and secret handling.
- After Task 5: review real-database evidence before claiming persistence complete.

