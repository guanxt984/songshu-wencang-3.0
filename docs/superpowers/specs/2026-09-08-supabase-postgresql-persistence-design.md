# Supabase PostgreSQL 持久化设计

**日期：** 2026-09-08  
**状态：** 已确认，待实施  
**范围：** 公开测试版第一步——认证、会话与松鼠仓数据持久化

## 1. 目标

将当前仅用于本地开发的内存认证仓库和内存松鼠仓仓库替换为可生产使用的 PostgreSQL 实现，使用户、邮箱验证码、会话、仓库快照、排序修订号和本地数据导入结果在服务重启后仍然存在。

首选托管平台为 Supabase PostgreSQL，但应用只依赖标准 PostgreSQL 协议和 `DATABASE_URL`，不绑定 Supabase 专有客户端。未来迁移到 Neon、阿里云 RDS 或自建 PostgreSQL 时不需要改写领域服务。

## 2. 非目标

本阶段不包含：

- 真实邮件供应商接入；
- Supabase Auth；
- 浏览器直接访问 Supabase Data API；
- 真实 AI 整理、任务队列和 Worker；
- 账号注销异步任务；
- 文件和自定义头像对象存储；
- 完整生产部署和域名配置。

本阶段继续允许本地开发使用固定验证码和内存适配器，但生产模式不得回退到内存存储。

## 3. 总体架构

```text
浏览器
  → 同站 /api
  → 认证服务 / 松鼠仓服务
  → PostgreSQL repository
  → Supabase PostgreSQL
```

领域服务继续依赖现有 repository 接口。内存 repository 负责快速单元测试；PostgreSQL repository 负责生产持久化和真实事务。HTTP 层不感知数据库提供商。

数据库连接分为两类：

- 迁移与管理：使用 Supabase 直接连接地址；
- 应用运行：使用 Supabase transaction pooler 连接地址，适配短生命周期或 Serverless 运行环境。

## 4. 运行模式与配置

### 4.1 本地内存模式

当 `APP_ENV=development` 且 `LOCAL_DEVELOPMENT_AUTH=true` 时，维持当前内存 repository 和固定测试验证码，方便零配置启动 UI。

### 4.2 PostgreSQL 模式

当配置 `DATABASE_URL` 时，服务创建共享数据库连接池，并注入 PostgreSQL 认证与仓库 repository。数据库凭据只存在于服务端环境变量。

### 4.3 生产保护

当 `APP_ENV=production` 时：

- 必须存在 `DATABASE_URL`、`AUTH_HASH_SECRET`、`CSRF_TOKEN_SECRET` 和 `ALLOWED_ORIGINS`；
- Cookie 必须启用 `Secure`；
- 禁止启用固定验证码；
- 禁止使用内存 repository；
- 配置缺失时服务拒绝启动并返回不含密钥值的配置错误。

## 5. 数据库适配器

### 5.1 连接层

新增一个数据库模块，负责：

- 从 `DATABASE_URL` 创建有上限的连接池；
- 设置连接和查询超时；
- 为事务提供统一的 `withTransaction` 接口；
- 在进程退出时关闭连接池；
- 将数据库内部错误映射为稳定的 repository 结果或安全错误码；
- 不在日志中输出连接串、正文、验证码或会话令牌。

应用查询全部使用参数化 SQL。不得通过字符串拼接构造用户输入相关 SQL。

### 5.2 认证 repository

PostgreSQL 认证 repository 实现当前认证服务所需接口：

- 原子保留邮箱挑战并执行邮箱/IP 限流；
- 新挑战使旧挑战失效；
- 更新发送状态；
- 查询最新有效挑战；
- 原子记录失败次数；
- 原子核销验证码；
- 查找或创建用户；
- 创建、查询、续期和撤销会话；
- 根据 ID 读取用户。

挑战保留、失败次数和核销必须使用事务、行锁或带条件的更新，确保并发请求不能创建多个有效挑战，也不能重复消费同一验证码。

### 5.3 松鼠仓 repository

PostgreSQL 松鼠仓 repository 实现当前仓库服务所需接口：

- 同一快照读取仓库列表和排序修订号；
- 按 `user_id + warehouse_id` 读取仓库；
- 创建仓库并推进排序修订号；
- 按当前 `revision` 和 `ready` 状态条件保存；
- 按当前 `revision` 和 `ready` 状态条件删除；
- 原子重排全部仓库并推进排序修订号；
- 查询导入幂等记录；
- 在云端为空时原子导入整批仓库并保存幂等结果。

所有读写必须同时限定 `user_id`。仓库数量上限同时由服务逻辑和数据库触发器保护。

## 6. 数据模型与迁移

继续使用现有迁移中的表：

- `users`
- `sessions`
- `email_challenges`
- `warehouses`
- `import_batches`

实施前新增向前迁移，用于修正适配器需要的约束与索引：

- 为活跃会话查询补充必要索引；
- 明确会话删除或用户删除的外键行为；
- 确保邮箱挑战并发约束可由事务可靠执行；
- 确保仓库位置重排不会因临时唯一键冲突失败；
- 为更新时间增加一致的数据库行为；
- 不修改或删除已发布迁移文件。

迁移必须可重复检测已应用状态。自动化部署只执行尚未应用的迁移，失败时停止启动，不允许部分迁移后继续提供服务。

## 7. 数据映射

数据库使用 snake_case，领域对象继续使用 camelCase。映射仅存在于 PostgreSQL repository 内部：

- `email_normalized` ↔ `emailNormalized`
- `user_id` ↔ `userId`
- `schema_version` ↔ `schemaVersion`
- `active_ai_job_id` ↔ `activeAiJobId`
- `created_at` / `updated_at` ↔ `createdAt` / `updatedAt`
- `snapshot` 保持 JSONB，并在 repository 边界执行结构化克隆或重新解析。

时间从 PostgreSQL 读取为 `Date`，写入使用明确的 `timestamptz` 参数。

## 8. 事务与并发

以下操作必须在单个数据库事务中完成：

- 请求验证码时的限流检查、旧挑战失效和新挑战创建；
- 验证码错误计数与第五次失效；
- 验证码核销、用户创建和会话创建；
- 仓库创建与排序修订号推进；
- 仓库删除、剩余仓库位置压缩和排序修订号推进；
- 仓库重排；
- 本地仓库整批导入及幂等记录写入。

乐观锁行为保持现有契约：修订号不匹配返回 `REVISION_CONFLICT`，整理状态返回 `WAREHOUSE_ORGANIZING`，资源不存在或不属于当前用户统一返回 `WAREHOUSE_NOT_FOUND`。

## 9. 服务组装

新增生产应用工厂，根据环境配置创建：

- PostgreSQL 连接池；
- PostgreSQL 认证 repository；
- PostgreSQL 松鼠仓 repository；
- 认证服务和仓库服务；
- HTTP handler。

`server.mjs` 只负责读取配置、选择本地或生产组装、启动 HTTP 服务和优雅关闭。生产服务不得引用内存 repository。

真实邮件尚未接入时，PostgreSQL 模式只用于持久化集成测试和预发布基础验证；生产发布仍需邮件适配器完成后才能开放邮箱登录。

## 10. 错误处理与可观测性

- 数据库不可用时启动失败，而不是静默退回内存。
- 请求期间数据库超时统一映射为安全的 `SERVICE_UNAVAILABLE`。
- 已知唯一约束、外键、检查约束映射为现有稳定业务错误。
- 未知驱动错误返回安全的 500，不把 SQL、表结构、主机名或连接信息暴露给前端。
- 日志只记录请求 ID、路由、耗时和稳定错误码。

## 11. 测试策略

### 11.1 单元测试

保留现有内存 repository 测试，确保领域服务行为不变。

### 11.2 PostgreSQL 集成测试

集成测试使用独立测试数据库，实际运行迁移并覆盖：

- 服务或连接池重建后用户、会话和仓库仍存在；
- 邮箱挑战并发保留、错误计数和一次核销；
- 多用户读取、保存、删除完全隔离；
- 仓库创建、保存、删除和排序修订号；
- `REVISION_CONFLICT` 与 `WAREHOUSE_ORGANIZING`；
- 十仓上限；
- 批量导入原子性、幂等性和 ID 重建；
- 事务中途失败时无部分写入；
- 数据库错误不会泄漏敏感信息。

未提供测试数据库连接串时，日常单元测试保持可运行；CI 和发布门禁必须提供 PostgreSQL 并执行集成测试。

### 11.3 完成标准

- 原有测试全部通过；
- PostgreSQL 集成测试全部通过；
- 服务重启后的真实持久化测试通过；
- 生产配置缺失时 fail closed；
- `git diff --check` 通过；
- 依赖审计无已知高危漏洞；
- 日志与代码扫描未发现数据库连接串或其他密钥。

## 12. 实施边界与后续工作

本设计完成后，松鼠文仓具备可靠的服务端数据持久化基础，但前端仍需要后续阶段将登录用户的数据源从 `localStorage` 切换到仓库 API。随后依次接入真实邮件、云端自动保存与导入、真实 AI 整理及生产部署。
