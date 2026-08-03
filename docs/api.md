# SpellPaw API 文档（M5）

所有 JSON API 走 `/api/*`（Hono 嵌入 Next.js 同一进程）。认证：浏览器会话
（Auth.js cookie）或 MCP Bearer token（仅 `/api/mcp`）。Workspace 作用域：
`x-workspace-id` 头指定，缺省用账号默认 workspace。

## 认证

- **Web UI**：Auth.js 会话 cookie（邮箱 magic link）。
- **MCP / 外部客户端**：`Authorization: Bearer sp_xxx`（Settings → API tokens
  一次性生成；存储仅为 SHA-256 哈希，丢失需重新 mint）。Bearer 优先：无效
  bearer 即使有合法会话 cookie 也返回 401。
- 错误格式：`{"error": "<message>"}`；错误码语义见各端点（400 参数、401
  未授权、404 不存在、429 限流/限额、502 上游渠道失败、503 依赖不可用）。

## 内容

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/posts` | GET | 列出 Posts（含 variants 与渠道） |
| `/api/posts` | POST | 建 Post（≥1 variant；超 `FREE_PLAN_MAX_POSTS` 返回 429） |
| `/api/posts/:id` | GET | 单 Post |
| `/api/posts/:id/publish` | POST | 发布：202 Accepted 异步入队（3 次指数退避重试） |
| `/api/variants/:id` | PATCH | 编辑 variant 内容（DRAFT 态） |
| `/api/schedule/:postId` | POST | 排程（≤7 天 delayed job；>7 天 reconciler 兜底） |
| `/api/schedule/:postId` | PATCH | 改期（先删旧 job 再建） |
| `/api/schedule/:postId` | DELETE | 取消排程 |
| `/api/calendar` | GET | 周视图事件 |

## 渠道

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/channels` | GET | 各渠道状态（connected / mock） |
| `/api/channels/:slug/connect` | POST | 启动 OAuth（返回授权 URL；state/verifier 入 cookie） |
| `/api/channels/:slug/callback` | GET | OAuth 回调（连接数超 `FREE_PLAN_MAX_CHANNELS` 时回调 302 回 channels 页并带 `?error=connect_failed`） |
| `/api/channels/:slug` | DELETE | 断开 |

## AI（BYOK，ADR-0005）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/ai/generate` | POST | `{provider, text, channelSlug?}` → 改写。10 次/分钟/workspace 限流 |
| `/api/settings/model-keys` | GET/POST | 列出/添加模型密钥（AES-256-GCM 静态加密，只返回预览） |
| `/api/settings/model-keys/:id` | DELETE | 删除；`MODEL_KEY_INVALID` 时自动停用 |

错误码：`MODEL_KEY_MISSING`(400) / `MODEL_KEY_INVALID`(400，自动停用该 key) /
`MODEL_KEY_QUOTA`(429) / `AI_PROVIDER_ERROR`(502)。

## Customer Graph 与分析

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/shorten` | POST | `{targetUrl, postId, variantId}` → 短链（6 字符 code，按 variant 幂等） |
| `/s/:code` | GET | 301 重定向（Redis 24h 缓存）；`sp_c` cookie 归因访客；点击入 `click-touch` 队列 |
| `/api/contacts` | GET | `?stage=`（大小写不敏感）`&limit=`；只返回非 PII 字段 |
| `/api/contacts/:id` | GET | Persona + State + 最近触达（永不含 `profile_*`） |
| `/api/contacts/insights/repeat-viewers` | GET | 30 天内触达 ≥2 篇不同内容的联系人 |
| `/api/analytics/dashboard` | GET | 总触达 / 唯一联系人 / 重复观看者 / 14 天触达 / 阶段分布 / 热门内容 |
| `/api/analytics/posts/:id` | GET | 单 Post 触达明细 |
| `/api/analytics/top-posts` | GET | 按触达排序 |

## 设置

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/settings/workspace` | GET | 名称 + MCP 信任开关 + 计划用量（3/50/1000 护栏） |
| `/api/settings/workspace` | PATCH | `{name?, mcpPublishApproval?}` |
| `/api/settings/api-tokens` | GET/POST | 列出 / mint（明文仅此一次返回） |
| `/api/settings/api-tokens/:id` | DELETE | 吊销 |

## 运维

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 匿名健康探针（DB ping → `{"ok":true}`，否则 503） |

## MCP Server（14 tools，5 模块）

端点：`POST /api/mcp`（Streamable HTTP，`mcp-session-id` 会话头，1 小时空闲
TTL）。认证：workspace Bearer token。写操作受 `MCP_WRITE_DAILY_CAP`（默认
100/天）限流。

| 模块 | Tools |
|------|-------|
| Post | `post.create_draft` `post.list` `post.get` `post.update_variant` |
| Schedule | `schedule.set` `schedule.reschedule` `schedule.cancel` |
| Calendar | `calendar.view` `calendar.find_slot` |
| Performance | `post.performance` `dashboard.summary` |
| Contacts | `contact.list` `contact.get` `contact.repeat_viewers` |

安全约束（spec §3）：

- **Publish 审批**：workspace 信任开关开启时（默认），`schedule.*` 返回
  `requires approval` 错误——网页端是唯一发布路径；Settings 关闭开关进入
  信任模式。
- **PII 契约**：Contacts 模块永不返回 `profile_*`（姓名/邮箱/社交账号）。
  单一事实源：`src/server/contact-select.ts`。
- 限流：写工具 `sp:mcp-write:{ws}` 每日上限；AI 生成 10 次/分钟。
