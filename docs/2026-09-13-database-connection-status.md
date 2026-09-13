# Supabase 数据库接入记录

2026-09-13 已将 squirrel-warehouse 项目接入本地 PostgreSQL 后端。

- 正式数据库 postgres：已执行 3 个迁移。
- 独立测试数据库 squirrel_warehouse_test：真实集成测试 17 项通过，0 失败，0 跳过。
- 覆盖：认证原子操作、重连持久化、用户隔离、版本冲突、整理状态保护、排序、导入回滚与幂等。
- 连接使用会话连接池与 verify-full，使用 Supabase 控制台提供的官方 CA 文件 supabase-ca.crt。
- 本地配置保存在 Git 忽略的 .env 文件；不在文档记录密码或连接串。
- npm start 自动加载本地 .env，当前地址 http://127.0.0.1:5180/。
- 重新运行真实数据库验收：node --env-file=.env --test --test-isolation=none api/postgres-auth.integration.test.mjs api/postgres-warehouse.integration.test.mjs。

## 前端云端保存接入

- 登录账户已接入云端仓库读写；游客仍使用本机存储。空云端账户可明确选择导入本机资料，不自动混入游客数据。
- 保存包含头像、文档人工修改、松果及分区；使用版本校验避免覆盖其他标签页的修改。
- 失败任务按账户独立持久保存，支持重试和导出；重新载入前保留恢复副本。同任务跨标签重试使用 Web Locks，避免重复新增。
- 浏览器验收（独立测试数据库）：创建仓库、添加松果、整理、人工编辑并刷新恢复、删除松果后保留文档文字均已验证。
- npm run check：云模块 17 项、核心 184 项、数据库安全 4 项及 UI 文案检查通过。
- npm run test:cloud:http：真实 HTTP 与 PostgreSQL 验收 1 项通过，验证头像、文档、松果、会话在 API 重建后持久保存及版本冲突保护。

## 尚未完成

原邮箱生产方案已取消，首版改用 GitHub 登录和 Render，真实 AI 后续接入。GitHub 登录代码、数据库迁移和部署配置已准备；真实 OAuth 应用凭据、Render 账号及线上回跳验收尚未完成。本机 .env 仍为 development，固定验证码只用于本机验证；云端数据持久化完成不等于已经公开上线。

新增 `0004_github_login.sql` 已应用到现有数据库和独立测试库。GitHub 身份按稳定 ID 建立，旧邮箱账号不会自动合并。详见 `2026-09-13-render-launch-runbook.md`。
