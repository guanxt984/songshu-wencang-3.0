# Render 首版发布操作

方案：新加坡单实例 Render Web Service，Starter 参考 7 美元/月；沿用新加坡 Supabase；GitHub 登录；平台 HTTPS 子域名；现有规则整理。账号尚未注册，未创建收费服务，未公开部署。

## 已准备

- `render.yaml`：新加坡单实例、Node.js 24.13.0、构建检查、数据库健康检查、手动发布。
- `scripts/render-start.mjs`：使用 Render 分配的网址作为同源入口；生产仅开放 GitHub；修正本地数据库证书路径；执行未应用迁移后启动；失败时不提供服务。
- GitHub OAuth state/PKCE、一次性数据库状态、不可变 GitHub ID 识别、HttpOnly 会话。
- 数据库迁移 `0004_github_login.sql` 已应用至现有数据库及独立测试数据库；已有用户和仓库未删除或自动合并。
- 默认连接池最多 5 条连接，避免单实例及测试进程挤占 Supabase 会话池。

## 平台配置步骤

1. 用户在 https://dashboard.render.com/register 注册，并完成平台要求的验证、条款和付款信息。选择个人免费工作区，只为 Web Service 的计算实例付费；以实际账单页为准。
2. 将准备好的应用源文件发布到用户 GitHub 仓库的部署分支。必须包含所有新模块、迁移、`render.yaml`、`scripts/render-start.mjs` 和公开 CA 文件 `supabase-ca.crt`。不得上传 `.env`、日志、数据库密码。当前本地包含前序云端保存的未提交改动，发布时必须一并包含其运行依赖。
3. 在 Render 创建 Node Web Service，选已发布的分支、新加坡、Starter、1 个实例；Build `npm ci && npm run check`，Start `npm run start:render`，Health `/api/health`。也可导入 Blueprint，但必须选择包含本次代码的分支。
4. 复制 Render 实际分配的 HTTPS 地址。缺少 OAuth 凭据时首次启动会失败，不会启用开发登录；补齐配置后重新部署即可。
5. 用户在 https://github.com/settings/developers 创建 OAuth App。名称“松鼠文仓”；Homepage URL 为实际 Render HTTPS 地址；Authorization callback URL 为该地址加 `/api/auth/github/callback`。此应用用于访客登录，和 Render 访问代码仓库的授权是两件事。
6. 在 Render 服务端环境变量配置 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`DATABASE_URL`、随机生成的 `AUTH_HASH_SECRET` 和 `CSRF_TOKEN_SECRET`；`NODE_VERSION=24.13.0`。Blueprint 可自动生成后两个随机值。不要把 GitHub Client Secret 或数据库连接串贴入聊天或前端代码。
7. `npm run start:render` 会自动读取 `RENDER_EXTERNAL_URL`。使用自定义域名时才额外设 `APP_ORIGIN` 并更新 GitHub 回调；首版无需购买域名。手动部署并等待健康检查通过。

## 发布前检查

```powershell
npm run check
node --env-file=.env --test --test-isolation=none api/github-postgres.integration.test.mjs api/postgres-auth.integration.test.mjs api/postgres-warehouse.integration.test.mjs api/cloud-http.integration.test.mjs
```

第二条仅使用 `TEST_DATABASE_URL` 指向 `_test` 结尾数据库，会清理该测试库应用表，不能改为正式库。

发布后必须通过真实 HTTPS 页面验证：GitHub 登录、刷新保持账号、创建及编辑仓库、换浏览器重新登录恢复、退出后失去访问权限。不同账号读写隔离已在测试库验证，但尚未在 Render 进行真实 OAuth 验收。只有完成公开地址及登录回跳验证才能称为已上线。

## 回退与费用

第一版不接入真实 AI，所以没有模型调用费用。Supabase 沿用当前套餐，不自动升级。若用 Free，数据库空间为 500 MB，长期不活跃可能暂停；使用情况变化后再升级。保留导出功能，正式数据不能放在 Render 临时文件系统。

本次数据库迁移是增量字段和新表；应用发布失败时可回退 Render 上一次可用版本，不逆向删除身份列、会话或仓库。旧邮箱开发账号不按邮箱与 GitHub 账号自动合并。
