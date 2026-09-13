# 首版快速上线方案

用户已确认：尽快上线，最多 10 人同时在线，约 500 人/月访问；接受海外网络、偶发不可用及付费；无域名；接受 GitHub 登录；真实 AI 后续接入。

采用单个 Render Node.js Web Service，同时提供静态页面和同源 API。建议最小付费常驻实例，参考价格 7 美元/月，实际购买以前台账单为准。使用 Render 提供的 HTTPS 子域名。保留现有 Supabase PostgreSQL 和现有规则整理。Supabase 暂不升级，免费项目可能因一周不活跃暂停。登录不需要发信域名。

GitHub OAuth 授权码流程使用 state 和 PKCE。服务端交换令牌后从 GitHub 获取稳定用户 ID，创建独立身份与现有应用会话；不按邮箱自动合并旧开发账户。GitHub 令牌不保存到浏览器或数据库。登录事务和会话存入 PostgreSQL，以支持实例重启、一次性消费和账户隔离。生产仅开放 GitHub 登录，禁用开发验证码路径。

前端保留现有登录卡片与游客入口，由后端公开配置选择登录方式。OAuth 失败回到卡片给出可重试提示；正常会话仍使用现有云端仓库流程。游客主动选择 GitHub 登录后清除游客模式标记。

服务器生产监听 0.0.0.0 和平台 PORT，提供数据库就绪健康检查。数据库连接保持证书验证；发布配置中使用容器/运行目录可用的 CA 路径。生产凭据只保存在 Render 环境变量中。迁移、测试失败时停止发布。

验收：OAuth 防伪造、过期和重放；身份更名稳定、不同用户隔离、禁用用户拒绝登录；GitHub 失败不泄露令牌；登录退出及云端写入恢复；生产开发验证码入口关闭；10 个独立会话的轻量并发读写；公开 URL 的真实浏览器 GitHub 登录。

外部步骤：用户注册 Render 并完成必要条款与付款；创建 GitHub OAuth 应用，回调 URL 使用已分配的网站地址加 /api/auth/github/callback；配置服务端密钥后部署。账号/密钥准备期间可完成代码与本地验收，不将代码完成等同于已上线。

参考（2026-09-13 核实）：
- https://render.com/pricing
- https://render.com/docs/web-services
- https://supabase.com/pricing
- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
