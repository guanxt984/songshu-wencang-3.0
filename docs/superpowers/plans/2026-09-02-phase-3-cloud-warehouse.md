# Phase 3 Cloud Warehouse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现公开测试版云端松鼠仓的服务端 CRUD、排序、乐观锁和旧本地数据整批幂等导入核心。

**Architecture:** 业务规则集中在可注入 repository 的 `warehouse-service` 中，内存 repository 用于确定性测试，HTTP 层通过已有会话和 CSRF 防护暴露契约路由。真实 PostgreSQL/Serverless 适配器留在部署阶段，当前实现不得把进程内状态宣传为云端持久化。

**Tech Stack:** Node.js ESM、Node test runner、Fetch API `Request`/`Response`、JSON Schema 契约、PostgreSQL 迁移。

**Spec:** `docs/松鼠文仓-产品实现链路与公开测试版方案.md` 第 7、9、12、15、16 节；`docs/superpowers/specs/2026-08-25-public-beta-cloud-ai-design.md` 第 4、7、8、10 节。

## Global Constraints

- 所有仓库查询和写入必须限定 `user_id`，不得跨用户读取或修改。
- 每名用户最多 10 个仓库，示例仓库计入上限。
- 只有 `ready` 状态且客户端 `revision` 匹配时才能保存或删除；成功写入后修订号加一。
- 导入仅允许云端仓库为空时执行，整批原子校验并使用用户范围内的幂等键。
- 导入由服务端重建仓库、分区和松果 ID，并同步修正文档内的松果引用。

---

### Task 1: Warehouse domain service and memory repository

**Files:**
- Create: `api/warehouse-service.js`
- Create: `api/memory-warehouse-repository.js`
- Test: `api/warehouse-service.test.mjs`

**Interfaces:**
- Consumes: `validateWarehouseSnapshot(snapshot)` from `contracts/validators.js`.
- Produces: `createWarehouseService({ repository, idGenerator, clock })` with `listWarehouses`, `getWarehouse`, `createWarehouse`, `saveWarehouse`, `deleteWarehouse`, `reorderWarehouses`, and `importWarehouses`.

- [x] **Step 1: Write failing service tests**

Cover ownership isolation, a ten-warehouse cap, immutable input snapshots, revision mismatch, organizing locks, exact-set reorder validation, atomic import, ID remapping, empty-cloud restriction, and idempotent retry.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-isolation=none api/warehouse-service.test.mjs`

Expected: FAIL because `warehouse-service.js` does not exist.

- [x] **Step 3: Implement the minimal domain service and repository**

Use structured clones at repository boundaries, throw stable `{ code }` errors, perform import prevalidation before any mutation, and persist successful import results by `(userId, idempotencyKey)`.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `node --test --test-isolation=none api/warehouse-service.test.mjs`

Expected: all phase 3 domain tests PASS.

### Task 2: Authenticated HTTP warehouse routes

**Files:**
- Modify: `api/http-handler.js`
- Create: `api/warehouse-http.test.mjs`

**Interfaces:**
- Consumes: phase 2 `authService.getSession(token)` and Task 1 `warehouseService` methods.
- Produces: `/api/warehouses`, `/api/warehouses/:id`, `/api/warehouses/order`, and `/api/import` handlers matching `contracts/openapi.json`.

- [x] **Step 1: Write failing route tests**

Assert authentication on every route, double-submit CSRF on mutations, path parameter routing, success status codes, stable conflict codes, and no response leakage across users.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-isolation=none api/warehouse-http.test.mjs`

Expected: FAIL with 404 for warehouse routes.

- [x] **Step 3: Add route dispatch and safe error mappings**

Resolve the session once per protected request, validate CSRF before parsing mutation bodies, and return only service DTOs.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `node --test --test-isolation=none api/warehouse-http.test.mjs`

Expected: all HTTP tests PASS.

### Task 3: Contract hardening and full verification

**Files:**
- Modify: `package.json`
- Modify: `contracts/openapi.json`
- Modify: `contracts/error-codes.json`
- Modify: `db/migrations/0001_public_beta_contracts.sql` only if a tested invariant is absent.

**Interfaces:**
- Consumes: Tasks 1–2 public behavior.
- Produces: full local verification command and documented stable error codes.

- [x] **Step 1: Add the phase 3 tests and syntax checks to `npm run check`**

Include both new implementation modules and both test files.

- [x] **Step 2: Align machine-readable contracts**

Declare request revision/idempotency requirements and the stable errors `WAREHOUSE_NOT_FOUND`, `WAREHOUSE_LIMIT_REACHED`, `WAREHOUSE_NOT_EMPTY`, `WAREHOUSE_ORGANIZING`, and `REVISION_CONFLICT`.

- [x] **Step 3: Run full verification**

Run: `npm run check`

Expected: all tests and UI content checks PASS with no warnings.

- [x] **Step 4: Run hygiene checks and independent review**

Run: `git diff --check` and scan changed files for secrets. Ask an independent reviewer to check authorization boundaries, transaction assumptions, revision handling, and idempotency; resolve all Critical and Important findings.

- [x] **Step 5: Commit the verified increment**

Commit message: `feat: add cloud warehouse service core`
