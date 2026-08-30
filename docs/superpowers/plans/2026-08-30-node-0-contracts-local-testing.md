# 节点 0：契约和本地测试基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为公开测试版固定可机读的仓库、AI、REST、错误码、状态与数据库契约，并让本地 `npm run check` 自动验证这些契约。

**Architecture:** 在 `contracts/` 中维护版本化 JSON 契约；`contracts/validators.js` 以无第三方依赖的可执行校验器实现关键业务不变量，供后续 API 与 Worker 复用。迁移文件只声明 PostgreSQL 数据模型和并发/所有权关键约束，不连接数据库；Node 内建测试分别验证可执行校验器、OpenAPI 表面和迁移文本中的可观察约束。

**Tech Stack:** Node.js ES modules、Node test runner、JSON、PostgreSQL SQL migration、OpenAPI 3.1 JSON。

**Spec:** `docs/松鼠文仓-产品实现链路与公开测试版方案.md`（第 7、10、11、12、15、16 节）与 `docs/superpowers/specs/2026-08-25-public-beta-cloud-ai-design.md`

## Global Constraints

- 只建立节点 0 契约与本地测试基础；不接入邮件、阿里云、数据库或真实 AI。
- 用户内容快照版本固定为 `schema_version: 1`，且只含 `name`、`document`、`shelves`、`pinecones`。
- 单用户最多 10 个仓库；每日最多 3 次 AI 整理；活动 AI 任务最多 1 个。
- AI 输入最多 500 条松果、单条正文最多 4,000 Unicode code point、总正文最多 20,000、HTTP 请求体最多 1 MiB。
- AI 输出必须至少一个章节，章节 ID 唯一，每章至少一条松果，且输入松果 ID 恰好出现一次。
- API 错误统一为 `{ "error": { "code": string, "message": string } }`；修订冲突返回 `409 REVISION_CONFLICT`。
- 仓库写入只允许 `ready`；任务状态只允许 `queued → running → succeeded|failed|expired` 或 `queued → failed|expired`。
- 不修改既有产品方案文档、现有页面功能或未跟踪日志。

---

## File Structure

- `contracts/warehouse-snapshot.schema.json`：客户端可读写的版本 1 仓库快照。
- `contracts/ai-organize-request.schema.json`：AI 任务创建请求。
- `contracts/ai-organize-result.schema.json`：模型输出的文档与松果唯一归属。
- `contracts/openapi.json`：认证、仓库、导入与 AI 路由的 OpenAPI 3.1 表面。
- `contracts/error-codes.json`：稳定错误码、HTTP 状态和前端安全提示。
- `contracts/state-machine.json`：仓库与 AI 任务有限状态机。
- `contracts/validators.js`：快照、任务输入、模型结果和状态转移的可执行验证。
- `contracts/contract.test.mjs`：端到端契约行为与可机读工件测试。
- `db/migrations/0001_public_beta_contracts.sql`：公开测试版首个 PostgreSQL 表、索引与关键约束。
- `.env.example`：开发、预发布、生产均需显式提供的非机密变量名与边界说明。
- `package.json`：把契约测试纳入 `npm run check`。

### Task 1: 建立仓库与 AI JSON 契约

**Files:**
- Create: `contracts/warehouse-snapshot.schema.json`
- Create: `contracts/ai-organize-request.schema.json`
- Create: `contracts/ai-organize-result.schema.json`
- Test: `contracts/contract.test.mjs`

**Interfaces:**
- Produces: `schema_version: 1` 快照，`warehouseId/revision/idempotencyKey` 整理请求，含 `document.sections[].pineconeIds` 的模型结果。

- [ ] **Step 1: 写失败的契约样例测试**

```js
assert.equal(validateWarehouseSnapshot({ schema_version: 1, name: "研究", document: {}, shelves: [], pinecones: [] }).ok, true);
assert.equal(validateWarehouseSnapshot({ schema_version: 2, name: "研究", document: {}, shelves: [], pinecones: [] }).ok, false);
```

- [ ] **Step 2: 运行测试确认因模块不存在而失败**

Run: `node --test contracts/contract.test.mjs`
Expected: FAIL with module-not-found for `contracts/validators.js`.

- [ ] **Step 3: 编写三份 JSON Schema**

```json
{ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "required": ["schema_version", "name", "document", "shelves", "pinecones"], "additionalProperties": false }
```

- [ ] **Step 4: 重新运行局部测试，确认仍只因校验器缺失而失败**

Run: `node --test contracts/contract.test.mjs`
Expected: FAIL with module-not-found for `contracts/validators.js`.

### Task 2: 实现可执行校验器与状态机

**Files:**
- Create: `contracts/validators.js`
- Create: `contracts/state-machine.json`
- Modify: `contracts/contract.test.mjs`

**Interfaces:**
- Consumes: 三份 JSON Schema 的字段定义。
- Produces: `validateWarehouseSnapshot(snapshot)`, `validateOrganizeRequest(request)`, `validateOrganizeResult(result, inputPineconeIds)`, `canTransitionJob(from, to)`；均返回 `{ ok: boolean, code?: string }`。

- [ ] **Step 1: 为输入限制、唯一归属与非法迁移写失败测试**

```js
assert.equal(validateOrganizeRequest({ warehouseId: "w1", revision: 1, idempotencyKey: "k", pinecones: [{ id: "p1", content: "x".repeat(4001) }] }).code, "AI_INPUT_ITEM_TOO_LARGE");
assert.equal(validateOrganizeResult(resultWithDuplicatePinecone, ["p1"]).code, "AI_OUTPUT_PINECONE_ASSIGNMENT_INVALID");
assert.equal(canTransitionJob("succeeded", "running"), false);
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test contracts/contract.test.mjs`
Expected: FAIL because the exported validation functions do not exist.

- [ ] **Step 3: 以最小实现验证所有节点 0 业务不变量**

```js
export function canTransitionJob(from, to) {
  return new Set(["queued:running", "queued:failed", "queued:expired", "running:succeeded", "running:failed", "running:expired"]).has(`${from}:${to}`);
}
```

- [ ] **Step 4: 运行局部测试确认通过**

Run: `node --test contracts/contract.test.mjs`
Expected: PASS.

### Task 3: 固定 REST、错误码和数据库约束

**Files:**
- Create: `contracts/openapi.json`
- Create: `contracts/error-codes.json`
- Create: `db/migrations/0001_public_beta_contracts.sql`
- Modify: `contracts/contract.test.mjs`

**Interfaces:**
- Produces: OpenAPI 3.1 的所有第 12 节路由；错误码的状态映射；数据库表 `users`、`sessions`、`warehouses`、`ai_jobs`、`usage_daily`、`import_batches` 与约束。

- [ ] **Step 1: 为 API 路由、409 错误和 SQL 关键约束写失败测试**

```js
assert.ok(openapi.paths["/api/warehouses/{id}/organize"].post);
assert.equal(errors.REVISION_CONFLICT.httpStatus, 409);
assert.match(migration, /UNIQUE \(user_id, idempotency_key\)/);
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test contracts/contract.test.mjs`
Expected: FAIL because the OpenAPI, error-code, and migration files do not exist.

- [ ] **Step 3: 新增契约工件**

```sql
CHECK (status IN ('ready', 'organizing'));
CREATE UNIQUE INDEX ai_jobs_one_active_per_user ON ai_jobs (user_id) WHERE status IN ('queued', 'running');
```

- [ ] **Step 4: 运行局部测试确认通过**

Run: `node --test contracts/contract.test.mjs`
Expected: PASS.

### Task 4: 接入统一检查与环境边界

**Files:**
- Create: `.env.example`
- Modify: `package.json`
- Modify: `contracts/contract.test.mjs`

**Interfaces:**
- Produces: `npm run check` 在语法、既有测试、契约测试与 UI 内容检查后以零失败退出。

- [ ] **Step 1: 为环境模板和 check 脚本写失败测试**

```js
assert.match(envExample, /^APP_ENV=development$/m);
assert.match(envExample, /^DATABASE_URL=$/m);
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test contracts/contract.test.mjs`
Expected: FAIL because `.env.example` does not exist.

- [ ] **Step 3: 新增模板并扩展统一检查**

```json
{ "scripts": { "check": "node --check app.js && node --test warehouse-management.test.mjs organizer.test.mjs contracts/contract.test.mjs && node test-ui-content.cjs" } }
```

- [ ] **Step 4: 运行完整检查**

Run: `npm run check`
Expected: exit code 0 with all existing and contract tests passing.

### Task 5: 审核与提交

**Files:**
- Modify: `docs/superpowers/plans/2026-08-30-node-0-contracts-local-testing.md`

- [ ] **Step 1: 对照产品文档第 15 阶段 0 与第 16 节逐项复核**

Expected: Schema、API、错误码、状态机、修订/锁定规则、迁移约束、环境边界和自动化验证均有对应工件。

- [ ] **Step 2: 搜索计划占位符并修正**

Run: `powershell -NoProfile -Command "$patterns = @('TB' + 'D', 'TO' + 'DO', 'implement' + ' later', 'fill in' + ' details'); Select-String -Path 'docs/superpowers/plans/2026-08-30-node-0-contracts-local-testing.md' -Pattern $patterns"`
Expected: no matches.

- [ ] **Step 3: 重新运行完整检查并查看差异**

Run: `npm run check; git diff --check; git status --short`
Expected: zero test failures, no whitespace errors, and only node-0 files plus pre-existing user changes/logs.

- [ ] **Step 4: 提交节点 0 工件**

```bash
git add contracts db/migrations .env.example package.json docs/superpowers/plans/2026-08-30-node-0-contracts-local-testing.md
git commit -m "feat: add public beta contracts and local checks"
```
