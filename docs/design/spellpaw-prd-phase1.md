# SpellPaw PRD — Phase 1: Content Engine

**版本**: 1.0
**日期**: 2026-07-31
**状态**: 草稿
**关联文档**: [概念设计](./2026-07-31-spellpaw-concept.md) · [术语表](../../CONTEXT.md) · [ADR 索引](../../docs/adr/)

---

## 1. 问题陈述

### 当前现状

SMB 和 AI-native builders 需管理三个割裂的外联任务，各自使用独立工具：

| 任务 | 典型工具 | 痛点 |
|------|---------|------|
| 内容发布 | EveryFeed / Buffer | 只知道帖子数据，不知道"谁在看" |
| 客户对话 | Intercom / Zendesk | 只知道对话本身，不知道"这人之前看过什么帖子" |
| 客户管理 | CRM 手操 / 电子表格 | 手动打标签，无自动化生命周期追踪 |

每次发布 → 客户进线 → 服务 → 留存——数据在三个工具里断流。无任何工具能回答"这个刚从 LinkedIn 帖子点进来又问客服问题的人，什么时候第一次看到我们的产品？他是什么类型的人？"

### 我们的答案

SpellPaw 用一个 Contact-Centric 的 Customer Graph 统一内容、对话和客户数据。AI 引擎跨 Surface 共享完整上下文——每条帖子是潜在对话入口，每个对话背后有完整的观众行为轨迹。

### 阶段 1 切入

用户最先痛的是内容获客。阶段 1 用比 EveryFeed 更智能的内容管理工具吸引用户，同时悄悄积累 Customer Graph——为阶段 2（Inbox）和阶段 3（Timeline/编排）准备数据。

---

## 2. 目标用户

| Persona | 描述 | 场景 |
|---------|------|------|
| **Solo Builder** | 独立开发者，1-3 个产品，无营销团队 | 一个人在 AI 里写完帖子、审批后发出，看谁对自己的产品有兴趣 |
| **Indie Agency** | 小型代理/自由职业者，管 3-10 个客户 | 在同一 Dash 里切换多个 Workspace，在 AI 里批量调度所有客户的帖子 |
| **Small Team** | 2-5 人产品团队，有复用 AI 的习惯 | 内容创建者在 Composer 手工操作，产品经理在 Claude 里随时调度发布计划 |

排除：Fortune 500 企业客户（合规/多级审批/私有部署需求不在范围）。

---

## 3. 产品范围

### 阶段 1 范围内

| 模块 | 具体功能 |
|------|---------|
| **Account & Workspace** | 注册/登录（magic link），创建/切换 Workspace |
| **Channel Connect** | OAuth 连接 Twitter、LinkedIn、Instagram |
| **AI Provider** | 用户自配 OpenAI/Anthropic API key |
| **Composer** | 多 Channel 编辑器、AI 内容生成、Post Variant 管理、草稿自动保存 |
| **Calendar** | 按周/月展示已排程 Post、拖拽调整时间、一眼看所有 Channel |
| **Scheduler** | 发布队列（BullMQ），Channel Worker 隔离，发布状态实时展示 |
| **Media** | AI 图片生成、Unsplash 搜索嵌入、图片上传 — 全部在 Composer 内嵌操作 |
| **Approval Trust** | 按 Channel + 内容类型配置自动/审批开关 |
| **Short Links** | 自托管短域名 + 点击追踪 + Content Touch 写入 Graph |
| **Dashboard Analytics** | 基础表现（Post 发布数、Link Clicks、Top Posts），不作深度图表 |
| **Customer Graph (基础)** | Profile 创建、Content Touch 写入、Contact 计数，首次渐进亮相 Graph 数据 |
| **MCP Server** | 在 ChatGPT/Claude/Cursor 里操作 Composer、Calendar、发布查看 |
| **Messaging Agent** | 支持从任意地方发消息问询（状态、发帖），内容在 Inbox Template 前为预览 |
| **Settings** | 模型 key 管理、Channel 连接管理、Workspace 基本设置 |

### 阶段 1 范围外（记录以备后续）

| 项目 | 归属 |
|------|------|
| Inbox Surface（统一收件箱） | 阶段 2 |
| 社区 Discord/Slack 监控 | 阶段 2 |
| Customer Timeline Surface | 阶段 3 |
| 编排引擎（Campaign Goal/Plan/Execute） | 阶段 3 |
| 团队协作/角色权限 | 阶段 3 |
| Stripe 支付/订阅 | 阶段 2 |
| 外部系统集成（CRM/支付） | 阶段 2（只读） |
| Email 营销 | 永久不做 |
| 付费广告投放 | 永久不做 |
| 非中英文 UI | 暂无计划 |

---

## 4. 功能需求

### 4.1 Account 与登录

**FR-001**: 用户使用 Email address 注册账户，系统发送 magic link 到邮箱，点击登录成功。无密码。

**FR-002**: 登录后创建第一个 Workspace（默认名为 Workspace），可重命名。

**FR-003**: 一个 Account 有 ≥1 个 Workspace。Workspace 之间完全隔离（Channel / Posts / Graph 各自独立）。

---

### 4.2 Channel 连接

**FR-004**: 用户在一个 Workspace 内通过 OAuth 连接 Channel。阶段 1 支持 Twitter、LinkedIn、Instagram。

**FR-005**: 用户可在 Composer 发帖前一次性连渠道（延迟授权：先写作后连渠道），也可以在 Settings 单独连接。

**FR-006**: 连接后，系统管理每个 Channel 对应的 adapter（含 API 配额、rate limit 检查、错误处理）。

**FR-007**: Channel 可以随时断开（断开后已发布内容不受影响，发布队列任务自动取消）。

---

### 4.3 AI Provider

**FR-008**: 用户须在 Settings 页面配置至少一个模型 API key（OpenAI 或 Anthropic），方可使用 AI 内容生成等功能。

**FR-009**: Key 状态实时检查（有效/失效/余额不足/配额耗尽）。Key 失效时 AI 功能降级为可用（也可手动编辑/发帖），恢复后自动补齐。

---

### 4.4 Composer

**FR-010**: Composer 有一个全局编辑区（写入"刚才发布了 v1.2"）。用户可选择"AI 生成"——AI 根据全局文案生成每 Channel 的 Variant（X: Thread style / LinkedIn: Professional / Instagram: Casual + Image）。

**FR-011**: 每个 Channel 展示独立 Tab（含字符计数、媒体要求、格式预览）。Channel Preview 实时显示渠道渲染效果。

**FR-012**: 用户可对任何 Variant 手动修改内容。AI 生成后 Variant 为"草稿"状态（待批准），直到用户操作。

**FR-013**: 用户可将 Variant 保存为草稿（Draft）、立即发布（Publish）或排入 Calendar（Schedule）。

**FR-014**: 媒体生成嵌入 Composer：
  - **AI Image**: 输入 prompt + 风格选择（Realistic/Minimalist 等），生成图片并附加到指定 Channel Variant
  - **Upload**: 上传本地图片
  - **Unsplash**: 搜索免费图片并附加

**FR-015**: Composer 实时自动保存（≥20s 一次），刷新或切换页面不丢失。

**FR-016**: Post 状态机：Draft → Scheduled → Queued → Posting → Published / Failed。

---

### 4.5 Calendar

**FR-017**: Calendar 按周/月展示所有 Channel 的已排程 Post。不同 Channel 使用不同颜色标记。

**FR-018**: 用户可在 Calendar 上拖拽调整 Post 时间（Drag-to-reschedule）或删除草稿。

**FR-019**: Calendar 点击一个 Post 显示概要卡片（Post 内容摘要 + 各 Channel 发布状态 + 若已发布则展示基础指标）。

**FR-020**: Calendar 时间跨度默认为用户本地时区，Storage 为 UTC。

---

### 4.6 Scheduler

**FR-021**: 发布时的流程：Post 进入发布队列（BullMQ）→ 按 Channel 路由到对应 Worker → 调用平台 API。

**FR-022**: 单个 Worker 支持 3 次退避重试（30s / 2m / 8m），3 次失败后标记 Post 状态为 Failed。

**FR-023**: 一个 Channel 的失败不阻塞其他 Channel 发布（Twitter 因限流延迟不影响 LinkedIn 定时发）。

**FR-024**: 用户界面实时展示发布状态：`Queued → Posting (X: 1/2) → Published`。

**FR-025**: 失败时向用户展示具体原因（平台 API 错误、令牌过期、内容违规等）。

---

### 4.7 审批信任开关

**FR-026**: 每个 Channel 和/或内容类型可单独配置为 "Auto"（自动发布）或 "Review"（需用户审批）。

**FR-027**: 默认状态：全部 Channel + 全部内容类型 = 审批模式。用户自己开启信任。

**FR-028**: 当 AI 通过 MCP/Messaging 通道请求发布时，检查当前信任配置——若为审批模式，仅创建草稿并通知用户审批。若为 Auto，自动排程。

---

### 4.8 短链接

**FR-029**: 每条发布的 Post 中包含的链接自动替换为短域名 Short Link（`<domain>/<code>`），在用户文本中可视为 `url` 类型 entity。

**FR-030**: 短链接被点击时：追踪点击事件（时间、来源 IP/UA、Referrer），写入 Customer Graph 该 Contact 的 Content Touch。

**FR-031**: 追踪数据用于 Dashboard 统计和 Customer Graph 的 Content DNA 推导（阶段 1 中 Graph 基础层就包含 Click Tracking）。

---

### 4.9 Dashboard 分析与 Graph 首现

**FR-032**: Dashboard 首页展示基础指标：Posts Published（last 30d）、Scheduled、Failed、Total Link Clicks。

**FR-033**: Top Post 表（按链接点击数排序），可点击进入 Post 详情。

**FR-034**: 在 Post 详情页和 Calendar 概要卡中**渐进展示 Graph 数据**——"这条 Post 有 14 人点击，其中 3 人在你的其他 Post 里也出现过"、"有 2 人看了你 3 条 Post 但未曾联系你"。这些不是另一个"Surface"——是散布在 Content 体验中的旁路信息。

---

### 4.10 MCP Server

**FR-035**: MCP server 暴露为 `/api/mcp` 路由，与 REST API 共享同一个 auth 和数据库会话。

**FR-036**: MCP Tools 阶段 1：
  - `create_draft` — 创建 Post 草稿
  - `get_posts` — 查询草稿/已发布列表
  - `schedule_post` — 更改 Post 排程时间
  - `get_calendar` — 查看本周/月 Calendar
  - `get_post_performance` — 查看 Post 表现
  - `list_contacts` — 查看已追踪 Contact 列表
  - `get_contact` — 查看某个 Contact 的 Profile（不包含 PII 详情）

**FR-037**: MCP Token 可按能力划分（content:read / content:create / content:publish 等），发布操作需在 AI 对话内确认。

---

### 4.11 Messaging Agent

**FR-038**: 用户可从 Dashboard 内部或外部向 Agent 发消息，问询：
  - "今天有多少人点击了我的帖子？"
  - "还有没有帖子安排在今天？"
  - "帮我把那条 LinkedIn 帖子的时间改到明天上午"

**FR-039**: Messaging Agent 读取 Customer Graph 和 Calendar 数据回答（只读），不执行发布操作。内容创建走"创建草稿 → 用户审批"路径。

---

### 4.12 Settings

**FR-040**: Settings 页面管理：模型 API keys、Channel 连接/断开、Workspace 名称、语言选择（中/英）、账单（阶段 1 展示为 Free Plan 限额指示）。

---

## 5. 非功能需求

| 类别 | 需求 |
|------|------|
| **性能** | Composer 内切换 Channel Tab ≤ 50ms；Calendar 加载 50 条 Post 事件 ≤ 300ms；短链接重定向 ≤ 100ms |
| **可靠性** | 发布不低于 98% 成功率（排除平台故障）；BullMQ retry 保障 failure 记录和恢复 |
| **安全** | 所有 API key 加密存储（AES-256）；OAuth Token 加密存储；MCP token 按能力分级；不做明文 PII 暴露 |
| **可用性** | 中英文 UI；中文 AI 提示词生成内容质量不低于英文；错误信息双语 |
| **扩展性** | 单体架构下支持 1000 Workspace + 5000 Contact/workplace（硬件最低配置 2vCPU / 2GB RAM 即可）；队列配置 ready-to-grow：Worker 节点可增减不影响 |
| **可观测性** | Bull Queue Monitoring；Next.js request / error / response 时序指标；平台 API 调用 failure rate 监控 |

---

## 6. 成功指标（阶段 1 目标）

| 指标 | 目标 | 测量方式 |
|------|------|---------|
| **7 日留存** | ≥ 60% | 注册后 7 天内至少一次登录 |
| **首周发帖率** | ≥ 70% | 注册后 7 天内完成 ≥1 条 Post 发布 |
| **首个 Content Touch 生成** | 首条 Post 发布后 24h 内 ≥50% 用户看到 Graph 数据出现 | Customer Graph 成功写入 Touch 事件 |
| **AI 使用率** | ≥ 60% | 注册用户中配置 model key 的比例 |
| **NPS (willingness to recommend)** | ≥ 10 | 发送后的季度 NPS 产品问卷 |
| **MCP 启用率** | ≥ 20% | 活跃用户中通过 MCP 操作 SpellPaw 的比例 |
| **Free → Paid 预注册** | ≥ 5% | 阶段 2 前已填入 payment method 等待升级 |

---

## 7. 发布计划

| 里程碑 | 内容 | 预计 |
|--------|------|------|
| **M1: "Hello Graph"** | 最小可用：注册、单个 Channel 连接、Composer 创建/发布单一 Channel Post、基础 Calendar | — |
| **M2: "Multi-Channel"** | 多 Channel Composer + Variant 管理、完全体 Calendar、Scheduler + Queue 完整链路 | — |
| **M3: "AI Sees You"** | AI Provider 接入、AI 内容生成、MCP Server Phase 1 工具集、Massaging Agent 只读版 | — |
| **M4: "Graph Emerges"** | Short Links + Content Touch 全程写入、Dashboard 分析 + Graph 渐进亮相、中英文 UI 完整 | — |
| **M5: "Trust & Polish"** | 审批信任开关、OAuth Flow 完成、错误处理/降级全线覆盖、最终性能优化与 QA | — |
| **M6: Launch** | 公开发布、Free Plan 开放注册、文档/Onboarding 完成 | — |

---

## 8. 假设与依赖

| 类型 | 项目 | 风险 |
|------|------|------|
| 关键依赖 | Twitter/X API 访问维持 Free Tier 基础配额 | 若 API 权限取消或大幅涨价，影响 1/3 Channel 覆盖 |
| 关键依赖 | LinkedIn API 允许第三方发布 | 若 LinkedIn 关闭或限制 API 访问，阻断 Professional 场景 |
| 关键依赖 | OpenAI/Anthropic API 持续可用 | 若使用自配 key 无服务，用户需换 Key；若服务全局中断，降级处理 |
| 产品假设 | SMB builder 愿意在 SpellPaw 里自己配置 Model Key | 若配置率低，可能需额外 Onboarding 优化或临时提供免费 Key |
| 产品假设 | 用户愿意从已有工具（EveryFeed/Buffer）迁移数据 | 无历史数据导入是风险点：设置最低可用时间 < 2 周 |
| 市场假设 | 中英双语足以覆盖早期 80% 用户 | 若非中英市场反馈强烈，需重新评估 i18n 范围 |
