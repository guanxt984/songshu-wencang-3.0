# PostgreSQL Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final production integration gaps in client-IP handling, public database-unavailable errors, static-file isolation, and PostgreSQL pool error lifecycle behavior.

**Architecture:** Preserve the existing Fetch-based API and repository boundaries. Carry trusted socket metadata from the Node adapter to the handler, normalize it at the production composition boundary, expose only the existing stable service-unavailable contract, constrain static delivery to an explicit frontend allowlist, and attach a secret-safe listener to idle pool errors.

**Tech Stack:** Node.js ES modules, Node HTTP/Fetch APIs, `node:net`, `pg`, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-08-supabase-postgresql-persistence-design.md`

## Global Constraints

- Write and run a failing regression test before each production change.
- Do not trust `X-Forwarded-For` without explicit trusted-proxy configuration; this change will not enable proxy headers.
- Every value sent to PostgreSQL `inet` must be a valid IPv4 or IPv6 literal; use the schema-compatible unspecified IPv4 address when socket metadata is unavailable.
- Public errors must contain only stable codes and safe localized messages.
- Static delivery must never expose dotfiles, server/API/docs/dependency/package files, traversal targets, or encoded traversal variants.
- Pool background errors may be logged only as a stable event name; in-flight query rejections must continue to propagate.

---

### Task 1: Trusted Client IP Across Node, Handler, and PostgreSQL Repository

**Files:**
- Modify: `server-response.test.mjs`
- Modify: `server.mjs`
- Modify: `api/production-api.test.mjs`
- Modify: `api/production-api.js`
- Modify: `api/http-handler.test.mjs`

**Interfaces:**
- Produces: `resolveSocketClientIp(request)` returning a PostgreSQL-`inet`-safe IPv4/IPv6 literal.
- Preserves: `createApiHandler({ resolveClientIp })` and `createProductionApi(...)` public composition APIs.

- [x] Add a server adapter test proving the Fetch request passed to `apiHandler` retains only the Node socket/connection metadata needed by the resolver.
- [x] Run `node --test server-response.test.mjs` and confirm the metadata assertion fails.
- [x] Attach socket metadata to the internal Fetch request without converting proxy headers into trusted state.
- [x] Add production composition tests for IPv4, IPv6, malformed/missing socket addresses, and spoofed `X-Forwarded-For`; assert the repository insert receives literal expected IP values and mail is reached for valid input.
- [x] Run `node --test api/production-api.test.mjs` and confirm the SQL value remains `unknown` before the fix.
- [x] Implement `resolveSocketClientIp` with `node:net.isIP`, socket-first/connection-second selection, and `0.0.0.0` fallback; inject it into `createApiHandler`.
- [x] Run the server, production composition, handler, and repository-focused tests and confirm they pass.

### Task 2: Public Service-Unavailable Contract

**Files:**
- Modify: `api/http-handler.test.mjs`
- Modify: `api/http-handler.js`
- Modify: `api/auth-contract.test.mjs`
- Modify: `contracts/error-codes.json`

**Interfaces:**
- Produces: public `SERVICE_UNAVAILABLE` response with HTTP 503 and a safe generic retry message.

- [x] Add an HTTP handler test whose real service boundary throws `{ code: "SERVICE_UNAVAILABLE" }`; assert status 503, stable code, safe message, and absence of database details.
- [x] Run the focused test and confirm it currently returns `INTERNAL_ERROR`/500.
- [x] Add `SERVICE_UNAVAILABLE` to both runtime and JSON error contracts.
- [x] Run the focused handler and contract tests and confirm they pass while arbitrary driver codes still map to safe 500.

### Task 3: Explicit Frontend Static Surface

**Files:**
- Modify: `server-response.test.mjs`
- Modify: `server.mjs`

**Interfaces:**
- Produces: static delivery for `index.html`, the runtime frontend modules/styles, and files below `assets/`; extensionless SPA routes return `index.html`.

- [x] Add real HTTP regression tests that start `createApplicationServer` on an ephemeral loopback port and verify `/`, frontend files, assets, and an extensionless SPA route remain available.
- [x] In the same fixture, assert 404 for `/.env`, `/.env.example`, `/package.json`, `/api/production-api.js`, `/server.mjs`, `/docs/...`, `/node_modules/...`, literal traversal, and percent-encoded traversal/separator variants.
- [x] Run `node --test server-response.test.mjs` and confirm current workspace files are exposed.
- [x] Replace workspace-wide path resolution with a decoded-path validator plus explicit root-file and `assets/` allowlists; reject malformed encoding, dot segments/files, backslashes, NULs, and disallowed extensions/roots before filesystem access.
- [x] Run focused HTTP tests and confirm public assets and SPA fallback remain working.

### Task 4: PostgreSQL Pool Background Error Lifecycle

**Files:**
- Modify: `api/postgres-database.test.mjs`
- Modify: `api/postgres-database.js`

**Interfaces:**
- Extends: `createPostgresDatabase({ ..., logger? })`, where `logger.error("POSTGRES_POOL_ERROR")` receives only a stable marker.

- [x] Add an EventEmitter-backed fake pool test proving an emitted idle `error` does not throw, logs no underlying message, in-flight `query()` rejections still propagate, and idempotent `close()` still calls `end()` once.
- [x] Run `node --test api/postgres-database.test.mjs` and confirm emitting `error` currently throws as unhandled.
- [x] Register one pool `error` listener at construction and make the logging callback exception-safe without catching query promises.
- [x] Run database tests and confirm the lifecycle behavior passes.

### Task 5: Cross-Task Audit, Documentation, and Commit

**Files:**
- Create: `.superpowers/sdd/2026-09-08-supabase-postgresql-persistence/final-fixes-report.md`
- Modify: `.superpowers/sdd/2026-09-08-supabase-postgresql-persistence/progress.md`

**Interfaces:**
- Produces: an evidence ledger that distinguishes unit/static verification from unavailable real-PostgreSQL verification.

- [x] Inspect analogous input, error, static path, and event-emitter boundaries for the same defect classes; add tests before any additional fix.
- [x] Run focused tests, then `npm run check`, `npm audit --omit=dev`, `git diff --check`, and secret/query scans.
- [x] Run the strict PostgreSQL command only if `TEST_DATABASE_URL` exists; otherwise record that no real database result was produced and run the explicit optional harness only as a skip/safety check.
- [x] Write the final fixes report and update the SDD progress ledger with exact commands, counts, and limitations.
- [ ] Review the complete diff and append commit `fix: harden PostgreSQL production integration` without amending prior commits.
