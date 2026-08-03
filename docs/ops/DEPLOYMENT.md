# SpellPaw 自托管部署指南（M5）

SpellPaw 是单体 Next.js 应用（嵌入式 Hono API + BullMQ workers），自托管只需
一台服务器 + PostgreSQL（pgvector）+ Redis。

## 1. 依赖

| 组件 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 22（开发用 26） | `pnpm build` 产物用 `pnpm start` 运行 |
| PostgreSQL | 14+（建议 16） | 需要 `vector` 扩展（pgvector）；Phase 1 尚未使用向量列，无扩展也可运行 |
| Redis | 7+ | BullMQ 队列 + 短链缓存 + 限流 |

## 2. 环境变量（全部必填项）

```bash
# --- Database ---
DATABASE_URL="postgresql://spellpaw:spellpaw@localhost:5433/spellpaw"

# --- Queue ---
REDIS_URL="redis://localhost:6379"

# --- Auth.js (v5) ---
# Generate with: openssl rand -base64 32
AUTH_SECRET=""
AUTH_URL="https://your-domain.example"      # 生产必须是 HTTPS 域名
AUTH_EMAIL_DEV_MODE="false"                 # 生产关闭：改用 SMTP 配置（见 auth.ts）
# SMTP（AUTH_EMAIL_DEV_MODE=false 时必填；Auth.js Email provider 的 server 配置）
SMTP_URL="smtp://user:pass@smtp.example:587"
SMTP_FROM="SpellPaw <no-reply@your-domain.example>"

# --- Encryption（AES-256-GCM key，base64 32 字节）---
# Generate with: openssl rand -base64 32
# ⚠️ 生产一旦固定不可轮换——OAuth token 与 model key 用它加密，丢失即数据不可读。
ENCRYPTION_KEY=""

# --- Channel OAuth（Twitter/X）---
# 未配置时使用 MockAdapter（仅本地开发/演示）。
TWITTER_CLIENT_ID=""
TWITTER_CLIENT_SECRET=""
TWITTER_OAUTH_REDIRECT_URI="https://your-domain.example/api/channels/twitter/callback"

# --- 可选护栏（默认值）---
FREE_PLAN_MAX_CHANNELS="3"     # 0 = 不限
FREE_PLAN_MAX_POSTS="50"       # 0 = 不限
FREE_PLAN_MAX_CONTACTS="1000"  # 0 = 不限（短链点击超限自动降级为匿名 touch，不阻塞）
MCP_WRITE_DAILY_CAP="100"      # MCP 写操作每日上限
```

## 3. 数据库迁移

```bash
pnpm install
npx prisma migrate deploy    # 生产只应用已有迁移，永不生成
```

视图（`contact_timeline`）包含在迁移中；`prisma/views/contact_timeline.sql`
与测试 bootstrap 共用同一份 SQL。

## 4. 构建与启动

```bash
pnpm build
pnpm start        # 生产模式，监听 3000（NODE_ENV=production）
```

BullMQ workers 由 `instrumentation.ts` 在进程内启动（publish / click-touch /
schedule reconciler），无需单独部署 worker 进程——单进程即可跑全栈。
如需横向扩容，web 与 worker 可共用同一 Redis/DB（短链缓存与限流是分布式的）。

## 5. 反向代理与健康检查

- 终止 TLS 于反向代理（Caddy / nginx / Cloudflare Tunnel 均可）
- 健康探针：`GET /api/health` → `{"ok":true}`（DB 可达时；匿名可访问）
- `AUTH_URL` 必须与公网域名一致，否则 magic link 会指向错误主机
- 生产环境自动为访客 cookie（`sp_c`）与 OAuth state cookie 附加 `Secure`

## 6. 升级

```bash
git pull
pnpm install
npx prisma migrate deploy
pnpm build
# 重启 pnpm start
```

## 7. Twitter/X 真实接入（OAuth 2.0 + PKCE）

1. 在 developer.twitter.com 创建项目与应用（Free 档即可），为应用启用
   OAuth 2.0 并配置回调 URL 为 `https://你的域名/api/channels/twitter/callback`（与
   `TWITTER_OAUTH_REDIRECT_URI` 完全一致）。
2. 申请权限：`tweet.read` + `tweet.write` + `users.read` + `offline.access`
   （offline.access 是获取 refresh token 的前提——令牌 2 小时过期，发布时
   自动刷新并回写，无需用户重新授权）。
3. 将 Client ID / Secret 填入 `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET`。
4. 三件套齐全时 registry 自动使用真实 adapter；缺失则回退 MockAdapter
   （仅演示，点击渠道页 Connect 即一步完成）。
5. 连接成功后渠道列表显示平台账号（`@handle`，连接时从 `users/me` 拉取，
   失败不影响连接）；连接凭据 AES-256-GCM 静态加密存储。
6. 刷新令牌失效（用户撤销授权等）时发布标记为 FAILED（不重试，避免无意义
   重试循环），错误信息包含 "reconnect the channel in Settings" 提示。

## 8. 安全基线（M5 加固清单）

- 依赖审计：`pnpm audit --prod`（CI 中执行）
- API 响应带安全头（nosniff / X-Frame-Options DENY / Referrer-Policy / Permissions-Policy）
- 模型密钥 AES-256-GCM 静态加密；API token 仅存 SHA-256 哈希
- MCP contact 工具永不返回 PII（`profile_*` 字段）——单一事实源
  `src/server/contact-select.ts`
- MCP 发布类操作默认需审批（Workspace 信任开关，Settings 可关）
- 发布/排程写操作受 `MCP_WRITE_DAILY_CAP` 限流；AI 生成受
  `sp:rl:ai:{ws}` 10 次/分钟限流（Redis 固定窗口，fail-open）
- 错误响应不泄露内部信息（统一 `{"error": "internal server error"}`）
