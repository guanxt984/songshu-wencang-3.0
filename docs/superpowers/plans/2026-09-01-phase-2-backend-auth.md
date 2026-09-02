# 阶段 2：后端基础与邮箱认证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可部署到函数计算的 Node.js API 核心、认证服务和 PostgreSQL 认证迁移，并在不连接真实邮件与云资源时完成自动化验证。

**Architecture:** 业务服务只依赖可注入的 repository、mailer、clock 和随机数接口；本地测试使用内存适配器，生产环境后续接 PostgreSQL 与阿里云邮件推送。HTTP 层只负责 JSON、Cookie、Origin/CSRF 和稳定错误映射，不把验证码、令牌或用户正文写入日志。

**Tech Stack:** Node.js ES modules、Node 内建 HTTP/crypto/test runner、PostgreSQL SQL migration。

**Spec:** `docs/superpowers/specs/2026-08-25-public-beta-cloud-ai-design.md` 第 3.2、4.1、7、9、10.1、12 节；`docs/松鼠文仓-产品实现链路与公开测试版方案.md` 第 8、9、12、16.2 节。

## Global Constraints

- 邮箱规范化后唯一；验证码 6 位、10 分钟过期、60 秒发送冷却。
- 每邮箱每天最多 10 次、每 IP 每天最多 30 次；错误 5 次后验证码失效。
- 数据库只存验证码哈希和会话令牌哈希。
- 会话默认 7 天，最长 30 天；Cookie 使用 `HttpOnly; Secure; SameSite=Lax`。
- 写接口校验受信 Origin 与 CSRF；错误统一使用稳定错误码。
- 本阶段不连接真实邮件、RDS、阿里云或付费资源。
- 日志和 API 响应不得包含验证码、Cookie、令牌哈希或内部异常。

---

### Task 1: 认证领域服务

**Files:**
- Create: `api/auth-service.test.mjs`
- Create: `api/auth-service.js`
- Create: `api/memory-auth-repository.js`

**Interfaces:**
- Produces: `normalizeEmail(email)`。
- Produces: `createAuthService({ repository, mailer, clock, randomInt, secret })`，包含 `requestEmailCode`、`verifyEmailCode`、`getSession`、`logout`。
- Produces: `createMemoryAuthRepository()`，实现挑战、用户和会话的原子内存操作。

- [x] **Step 1: 写邮箱规范化、验证码哈希、冷却、次数限制、过期、五次失败、一次消费和会话测试**
- [x] **Step 2: 运行 `node --test api/auth-service.test.mjs`，确认因模块不存在而失败**
- [x] **Step 3: 实现最小认证服务与内存 repository**
- [x] **Step 4: 重跑认证测试并确认通过**

### Task 2: HTTP API 边界

**Files:**
- Create: `api/http-handler.test.mjs`
- Create: `api/http-handler.js`
- Modify: `server.mjs`

**Interfaces:**
- Produces: `createApiHandler({ authService, allowedOrigins, secureCookies })`，处理认证 OpenAPI 路由。
- Consumes: Task 1 认证服务。
- Produces: 统一 `{ error: { code, message } }` 响应和 `nestnote_session` Cookie。

- [x] **Step 1: 写请求、验证、会话、退出、JSON 限制、Origin 与 CSRF 的失败测试**
- [x] **Step 2: 运行 `node --test api/http-handler.test.mjs`，确认因模块不存在而失败**
- [x] **Step 3: 实现可测试的 Request/Response handler，并在 `server.mjs` 将 `/api/*` 委托给它**
- [x] **Step 4: 重跑 HTTP 和认证测试并确认通过**

### Task 3: PostgreSQL 认证迁移与生产适配边界

**Files:**
- Create: `db/migrations/0002_auth_hardening.sql`
- Create: `api/auth-contract.test.mjs`
- Modify: `.env.example`

**Interfaces:**
- Produces: challenge IP、发送状态、发送日期索引、会话绝对过期时间和审计约束。
- Produces: 生产 adapter 所需环境变量契约，不包含任何密钥值。

- [x] **Step 1: 写迁移和环境变量文本约束的失败测试**
- [x] **Step 2: 运行 `node --test api/auth-contract.test.mjs` 并确认失败**
- [x] **Step 3: 新增向前迁移与空值环境模板**
- [x] **Step 4: 重跑契约测试并确认通过**

### Task 4: 统一验证与提交

**Files:**
- Modify: `package.json`
- Modify: `docs/superpowers/plans/2026-09-01-phase-2-backend-auth.md`

**Interfaces:**
- Produces: `npm run check` 覆盖全部认证和 HTTP 测试。

- [x] **Step 1: 把 `api/*.test.mjs` 加入统一检查**
- [x] **Step 2: 运行 `npm run check`、`git diff --check` 和敏感信息扫描**
- [x] **Step 3: 独立审查认证安全与需求覆盖，修复 Important/Critical 问题**
- [x] **Step 4: 提交阶段 2 工件**
