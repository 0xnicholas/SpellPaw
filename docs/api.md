# SpellPaw API 文档（M7）

> M7 新增：Contact State 完整状态机 + Risk/Opportunity 评分（M7-A）、Persona AI 推导管道（M7-C，门控）。详见下文「Customer Graph 与分析」节的 **Contact State** 与 **Persona** 两小节。

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
| `/api/channels` | GET | 各渠道状态（connected / mock），已连接时含 `accountName`（平台 @handle） |
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
| `/api/contacts` | GET | `?stage=`（大小写不敏感，6 阶段：AWARE/ENGAGED/ACTIVATED/LOYAL/AT_RISK/CHURNED）`&limit=`；返回 State（stage + risk/opportunity 分 + lastInteractionAt）等非 PII 字段 |
| `/api/contacts/:id` | GET | Persona + State + `signals`（`daysSinceLastInteraction` / `touches30d` / `conversations30d` 原始信号）；永不含 `profile_*` |
| `/api/contacts/insights/repeat-viewers` | GET | 30 天内触达 ≥2 篇不同内容的联系人 |
| `/api/analytics/dashboard` | GET | 总触达 / 唯一联系人 / 重复观看者 / 14 天触达 / 阶段分布 / 热门内容 |
| `/api/analytics/posts/:id` | GET | 单 Post 触达明细 |
| `/api/analytics/top-posts` | GET | 按触达排序 |

### Contact State（M7-A，ADR-0015）

每个 Contact 实时携带完整 Lifecycle Stage 与两个评分（规则驱动：事件触发重算 + 每日衰减 cron）。

| 字段 | 说明 |
|------|------|
| `stateLifecycleStage` | `AWARE` → `ENGAGED` → `ACTIVATED` → `LOYAL` / `AT_RISK` / `CHURNED` |
| `stateRiskScore` / `stateOpportunityScore` | 0–100 整数（流失概率 / 升级可能） |
| `lastInteractionAt` | 最近一次互动时间 |

**评分是"未校准启发式便利层"，不是经验真理**（grilling Q3）：UI 展示为 Low/Med/High
band；API/MCP 同时返回 `signals` 原始信号，让消费方 agent 可自行推理、覆盖启发式分。
阈值（`AT_RISK_DAYS`/`CHURNED_DAYS`/`LOYAL_MONTHS`/`STATE_DECAY_CRON` 等）env 可调，见
`.env.example` 与 `docs/design/m7-persona-state-derivation.md`。

状态机要点：激活（手动/事件）单向棘轮——抗 engagement 降级，但受风险衰减（→ AT_RISK →
CHURNED）；CHURNED 重新活跃回 AWARE。

### Persona（M7-C，ADR-0015；门控、后台异步）

`personaContentDNA` / `personaSentimentArc` / `personaIntent` 由后台批处理从最近 365 天互动
推导（dirty-flag 扫描，默认每小时）。**推导会把客户消息正文发给 BYOK LLM**——比用户自有
内容更敏感，故受独立门禁 `personaDerivationEnabled` 控制（默认**关**，镜像 ADR-0014）：

- 门禁关 → 不推导、不外发内容（dirty 保留待开启）。
- 门禁开 + 无 key → 写规则降级值；AI 失败 → 保留旧值（下次重试）；读路径**永不阻塞**于 AI。
- `personaIntentVector`（pgvector）暂未启用（无相似检索消费者）。

Persona 输出仍只经非 PII 投影暴露（`src/server/contact-select.ts`）。

## Inbox（M6，ADR-0013/0014）

线程 = contact × channel 的查询聚合；`threadId` = `${contactId}:${channelSlug}`。
会话认证的 REST 层返回完整对话内容与对方身份（Inbox 是 PII 例外域——这是产品本身；
contact 端点仍永不返回 `profile_*`）。

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/inbox/conversations` | GET | 线程列表（联系人 + 渠道徽章 + 最后消息 + 未读数 + lastReadAt） |
| `/api/inbox/conversations/:threadId` | GET | 线程全文（消息升序，含 deliveryState） |
| `/api/inbox/conversations/:threadId/reply` | POST | `{content}` → 202 入队（PENDING→SENT/FAILED，瞬时错误重试 1 次） |
| `/api/inbox/conversations/:threadId/read` | POST | 写已读游标（InboxReadState） |
| `/api/contacts/:id/activate` | POST | 手动标记 Activated（写 Event + `activatedAt`；ratchet 抗 engagement 降级，但受风险衰减→可到 AT_RISK/CHURNED） |
| `/api/contacts/:id/timeline` | GET | 最近 20 条互动（contact_timeline 视图，payload 无 PII） |

## 设置

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/settings/workspace` | GET | 名称 + MCP 信任开关 ×2 + Persona 推导开关 + 计划用量（3/50/1000 护栏） |
| `/api/settings/workspace` | PATCH | `{name?, mcpPublishApproval?, mcpInboxAccess?, personaDerivationEnabled?}` |
| `/api/settings/api-tokens` | GET/POST | 列出 / mint（明文仅此一次返回） |
| `/api/settings/api-tokens/:id` | DELETE | 吊销 |

## 运维

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 匿名健康探针（DB ping → `{"ok":true}`，否则 503） |

## MCP Server（17 tools，6 模块）

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
| Inbox | `inbox.list` `inbox.read` `inbox.reply` |

安全约束（spec §3 + ADR-0014）：

- **Publish 审批**：workspace 信任开关开启时（默认），`schedule.*` 返回
  `requires approval` 错误——网页端是唯一发布路径；Settings 关闭开关进入
  信任模式。
- **PII 契约（按模块声明）**：Contacts 模块永不返回 `profile_*`（姓名/邮箱/
  社交账号）。**Inbox 模块是明确例外域（ADR-0014）**：`inbox.*` 返回完整对
  话内容与对方身份，受独立开关 `mcpInboxAccess` 门控（默认**关**——未开启时
  整个模块拒绝）。单一事实源：`src/server/contact-select.ts` + 本表。
- 限流：写工具 `sp:mcp-write:{ws}` 每日上限（含 `inbox.reply`）；AI 生成
  10 次/分钟。
