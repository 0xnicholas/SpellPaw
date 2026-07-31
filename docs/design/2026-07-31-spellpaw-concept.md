# SpellPaw 产品概念设计

**日期**: 2026-07-31
**状态**: 概念验证 / 待评审
**来源**: [EveryFeed 调研](./research/everyfeed-ai-report.md) · [Sierra 调研](./sierra-ai-report.md)

---

## 1. 产品定位

**SpellPaw** 是一个面向 SMB 和 AI-native builders/teams 的外部沟通 AI 操作系统。它将内容营销、客户服务和客户生命周期管理统一到一个平台上，以 **Contact 为中心的 Customer Graph** 驱动跨场景的 AI 编排。

域术语定义见 [CONTEXT.md](../../CONTEXT.md)，关键术语表：

| 术语 | 含义 | Avoid |
|------|------|-------|
| Contact | 被追踪到的任何人 | Customer, user, lead |
| Audience | 仅有点击/互动，无对话的 Contact | Viewer, follower |
| Correspondent | 至少有一次 Inbox 对话的 Contact | Lead, customer |
| Post | 一对多内容的创建单元 | Content, tweet |
| Message | 一对一对话的通信单元 | Reply, chat |
| Channel | 外部沟通入口（Twitter、Discord 等） | Platform, network |
| Workspace | Account 下管理的主体 | Team, brand, project |

### 核心差异

| 维度 | 现有工具 | SpellPaw |
|------|---------|--------|
| 内容与对话 | 分离（如 Sprout + Intercom） | 统一时间轴，每条 Post 都是潜在对话入口 |
| Contact 模型 | 各自孤岛 | 一个 Customer Graph——Content Touch → Conversation → Event 全链路可见 |
| AI 能力 | 各自嵌入的 AI | 统一引擎跨 Surface 共享上下文，实现跨场景推理 |

### 价值主张

> 你的产品只需要一个对外界面。SpellPaw 管理从获客到留存的全部外部沟通——AI 创建内容、响应对话、跟踪客户旅程，你只需审阅和批准。

### 目标用户

- SMB（小型企业）
- AI-native 产品团队
- 用 AI 开发产品并有市场发展需求的独立开发者/专业个人
- 排除 Fortune 50 企业客户

---

## 2. 四层架构

```
┌──────────────────────────────────────────────────┐
│              三通道接入层 (Access)                  │
│    Web Dashboard  │  AI Chat (MCP)  │  Messaging  │
├──────────────┬──────────────┬────────────────────┤
│  Content     │  Inbox       │  Customer           │
│  Surface     │  Surface     │  Timeline Surface   │
│  (营销发布)   │  (对话/社区)  │  (客户全生命周期)     │
├──────────────┴──────────────┴────────────────────┤
│                共享 AI 引擎                        │
│   内容生成 │ 对话代理 │ 策划编排 │ 信号解读 │ 分析归因   │
├──────────────────────────────────────────────────┤
│           统一数据层 (Customer Graph)              │
│   内容互动 │ 对话历史 │ 生命周期阶段 │ 渠道连接       │
└──────────────────────────────────────────────────┘
```

三层 Surface 各自独立但共享同一个 Customer Graph 和 AI 引擎。Analytics 不单独成面——它穿透所有 Surface 内嵌展示。Discord/Slack 社区的群聊和频道管理纳入 Inbox Surface 而非独立 Surface。

### 三通道

| 通道 | 说明 | 用户是谁 |
|------|------|---------|
| **Web Dashboard** | 浏览器中的完整工作台 | 偏好可视化操作的用户 |
| **AI Chat (外部)** | 通过 MCP server 在 ChatGPT/Claude/Cursor 中操作 SpellPaw | 已在 AI 工作流中工作的 builder |
| **Messaging Agent** | 从任意地方发消息给 Agent，Agent 操作 SpellPaw 并返回结果 | 需要随时快速触达的用户 |

三通道在 MVP（阶段 1）全做。Dashboard 是完整能力底座，AI 对话是平等的操作入口。

---

## 3. Surface 设计

### 3.1 Content Surface（营销发布）

**核心交互**：多频道 Composer + 调度 Calendar + 内嵌轻量媒体生成。

```
┌─ Profile Nav ─── [My Product] [Client B] ──────────────┐
│                                                         │
│  ┌─ Composer ────────────────────────────────────────┐   │
│  │ Global  X ✓  LinkedIn ✓  Instagram ✓   3/3 ready │   │
│  │                                                    │   │
│  │ v1.2 发布了。写一个多频道发布计划……                   │   │
│  │                                                    │   │
│  │ ↕ Draft / Schedule / Publish                        │   │
│  │                                                    │   │
│  │ X: 212/280 | LinkedIn: ready | Instagram: +1 image │   │
│  │                                                    │   │
│  │ [+ Generate Image] [+ Upload] [+ Unsplash]          │   │
│  │                                                    │   │
│  │ [Save Draft] [Schedule] [Publish]                  │   │
│  └────────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ Calendar ────────────────────────────────────────┐   │
│  │ Mon ░  Tue ░  Wed ■■  Thu ■  Fri ░░░               │   │
│  └────────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ Post Performance ────────────────────────────────┐   │
│  │ "v1.2 released" → 320 views · 14 new contacts      │   │
│  │   ↗ 3 repeat viewers from your last post           │   │
│  └────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**关键设计决策**：
- 帖子 = 潜在对话入口：每条发出的内容自带可配置的响应规则（评论 → Inbox 自动处理 or 通知用户）
- AI 辅助但不替代：用户可完全手工写，也可让 AI 起草后审核
- 媒体生成内嵌在 Composer 中（AI 图片生成 + Unsplash），不做独立的 Design workspace 或模板编辑器
- 从 Calendar 可看到 Graph 洞察（"这条带来了 14 个新联系人"）

### 3.2 Inbox Surface（对话与社区）

**核心交互**：统一收件箱 + Agent 自动化 + 社区频道监控。

```
┌─ Inbox ─── [All] [1v1] [Community] [Auto] ─────────┐
│                                                         │
│  ┌─ Conversations ───────────────────────────────────┐  │
│  │ ● Alice        "退货怎么操作"      2m  ↕X    [AI]  │  │
│  │ ● Bob          "可以试用吗"       10m  ↕LinkedIn   │  │
│  │ ○ Carol        "我的订单丢了"      1h  ↕Email [您]  │  │
│  │ ✓ Dave (Closed) "谢谢解决了"       3h               │  │
│  └────────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ #general (Discord) ──────────────────────────────┐  │
│  │ 12 条新消息 · 3 个活跃线程                         │  │
│  │ ├ ● "这个功能怎么用" — 2 replies — 15m              │  │
│  │ ├ ○ "刚发布了 v1.3"    — 5 replies — 1h   [公告帖] │  │
│  │ └ ● "有没有人遇到 "    — 1 reply  — 3h              │  │
│  └────────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Active Conversation ──────────────────────────────┐ │
│  │ Carol · 2y customer · sNPS 4 · stage: At Risk      │ │
│  │ --------                                           │ │
│  │ C: 我的#1024订单到现在还没到                         │ │
│  │ AI: 让我查一下您的订单状态… [查询中]                  │ │
│  │     [✓ 已查到]  您的订单在配送中，预计今天到达        │ │
│  │     [建议回复]  [直接发送] [修改后发送]               │ │
│  │                                                    │ │
│  │ ── Customer Context ───────────────────────────────│ │
│  │ 来源: X · 看过 3 条技术帖 · 历史 4 次对话           │ │
│  │ 当前情感: 焦虑 · 上次对话: 7 天前                    │ │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**关键设计决策**：
- 区分 1v1 对话和社区频道——3 种视图切换，交互范式不同
- [AI] 标记表示 AI 正自动处理，用户可随时接管
- 右侧面板显示来自 Customer Graph 的完整上下文
- **社区 Agent 角色为"标记需要我注意的事"，不直接代发言**——公共频道 AI 自动回复风险过高
- Agent 可在对话中看到客户完整画像：来源渠道、看过哪些内容、历史对话摘要

### 3.3 Customer Timeline Surface（客户全生命周期视图）

**核心交互**：以单个客户为中心的时间轴视图，融合内容互动和对话数据。

```
┌─ Customer: Alice ──────────────────────────────────────┐
│                                                         │
│  Lifecycle: Aware → Engaged → Activated → At Risk → ...│
│  Current: Monthly · LTV $340 · 4 conversations          │
│                                                         │
│  ┌─ Timeline ──────────────────────────────────────────┐│
│  │ Jul 20 │ 看到 LinkedIn 帖子 "v1.2 发布了"            ││
│  │ Jul 22 │ 注册免费试用                                  ││
│  │ Jul 23 │ Inbox: "API 文档在哪？"  [AI 自动回复 ✓]      ││
│  │ Jul 25 │ 升级 Pro 计划                                 ││
│  │ Jul 28 │ 再次看到 X 帖子——没有动作                     ││
│  │ Jul 30 │ Inbox: "续费失败了"  [在处理中]               ││
│  └──────────────────────────────────────────────────────┘│
│                                                         │
│  Content DNA: 对技术类帖子反应最强 (3/5 点击来自 dev.to)   │
│  Sentiment: Neutral → Positive → Anxious (当前)          │
│  Predicted Action: 30% churn risk within 14 days          │
│                                                         │
│  ┌─ Possible duplicate? ──────────────────────────────┐ │
│  │ 这个用户可能和 "Alice (Twitter)" 是同一人  [合并]    │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**关键设计决策**：
- 这是两个数据源融合的物理体现——Content 和 Inbox 的数据首次在同一视图汇合
- Content DNA：自动学习客户对什么类型/渠道/内容最敏感
- 身份合并提示：低置信度匹配在 Timeline 顶部显示 "可能是同一人" 确认卡片
- Predicted Action 驱动手动干预或自动触发规则

---

## 4. 共享 AI 引擎

AI 引擎是所有 Surface 和三通道共享的同一套能力，不是各自独立的 AI 模块。

### 能力矩阵

| 能力 | 输入 | 输出 | 消费者 |
|------|------|------|--------|
| **内容生成** | 产品 changelog / 用户需求描述 | 多频道帖子草稿、媒体素材 | Content Surface、所有三通道 |
| **对话代理** | 用户进线消息 + Graph 上下文 | 回复建议 / 自动回复 / 升级标记 | Inbox Surface |
| **策划编排** | 业务目标（"本周获客 50 试用"） | 跨 Surface 行动序列 | Content + Inbox + Timeline |
| **信号解读** | 用户行为/内容互动/情感数据 | Graph 更新（Persona, Risk, Opportunity） | 所有 Surface |
| **分析归因** | 内容表现 + 对话结果 + 转化数据 | 洞察报告、优化建议 | 所有 Surface |

### 编排引擎（核心差异化）

编排引擎不是"如果 A 则 B"的自动化序列——它是**目标驱动的跨 Surface 引擎**。

```
用户: "本周让更多人试用我们的新功能"
     │
     ▼
编排引擎 ──→ 1. Content: 起草 3 条帖子 (技术向/案例向/对比向)
     │     2. Calendar: 找到最佳时间段
     │     3. Content: 发布 + 每条帖子绑定 Inbox 响应规则
     │     4. Inbox: 监控进线，识别试用意图 → 自动发送试用引导
     │     5. Customer: 跟踪进来的用户，7天后未激活 → 触发提醒
     │
     ▼
一条指令 = 一个跨 Surface 的 Campaign，自动运行，人工审核节点可配置
```

关键设计：
- 用**自然语言目标 → AI 生成 Plan (JSON) → 确定性状态机执行**——避免 AI 幻觉导致执行错误
- 用户始终可干预：编排引擎在每个节点设有审批门，可配置信任等级
- 引擎基于结果数据学习优化策略

### 审批粒度（信任开关）

不分全手动或全自动。用户按渠道和内容类型分别配置：

```
审批配置：
┌─────────────────────────────────┐
│ Channel  │ [X] Auto  [ ] Review │
│ LinkedIn │ [ ] Auto  [X] Review │
│ Discord  │ [ ] Auto  [X] Review │
│          │                      │
│ Content type:                    │
│ Changelog   [X] Auto  [ ] Review│
│ Promotion   [ ] Auto  [X] Review│
│ Technical   [X] Auto  [ ] Review│
│ Community   [ ] Auto  [X] Review│
└─────────────────────────────────┘
```

**默认值：全部走审批。用户自行放松。**

---

## 5. Customer Graph（统一数据层）

### 核心实体

```
Customer Graph
    │
    ├── Profile          — 基础身份（名称、邮箱、社媒句柄、来源 Channel、标签）
    ├── Interactions     — Contact 时间轴事件
    │   ├── Content Touch    看到/点击/分享了哪条 Post（来源：SpellPaw 追踪）
    │   ├── Conversation     Inbox 中的 Message 交换（来源：Inbox Surface）
    │   └── Event            Contact 在用户产品内的行为：注册、订阅、登录、
    │                        功能使用等（来源：外部系统只读 or 手动标记）
    ├── Persona          — AI 推导的画像（仅基于最近 365 天数据）
    │   ├── Content DNA      Contact 对什么内容类型/渠道/语调最敏感
    │   ├── Sentiment Arc    情感变化曲线（时序压缩）
    │   └── Intent Vector    当前意图方向（探索/购买/投诉/流失）
    ├── State            — 当前状态机快照（实时更新）
    │   ├── Lifecycle Stage   见下方状态机
    │   ├── Risk Score        流失概率 0-100
    │   └── Opportunity Score 增购/升级可能性 0-100
    └── Links            — 关联外部系统 ID（CRM、支付——只读引用）
```

### Lifecycle Stage 状态机

| Stage | 进入条件 | 退出条件 |
|-------|---------|---------|
| **Aware** | 首次 Content Touch——进入系统 | 累计 3 次 Touch or 1 次 Conversation → Engaged |
| **Engaged** | 达到 Aware 退出条件 | 有产品使用证据 → Activated |
| **Activated** | 首次产品使用证据（Conversation 中表达意图 / Event 注册 / 手动标记） | 连续 3 月有正面 Interaction → Loyal |
| **Loyal** | 连续 3 月正面 Interaction | 30 天无 Interaction or 负面 Sentiment → At Risk |
| **At Risk** | 静默超时 or 负面信号 | ① 重新活跃→回上一阶段 ② 90 天无恢复→Churned |
| **Churned** | At Risk 持续 90 天 | 重新活跃 → Aware |

### 预计算层

AI 引擎从不直接读取 raw Interaction 记录。数据通过**双路径预计算层**压缩为结构化摘要：

- **增量路径**（< 3 秒）：事件触发——追加 Top-K 交互、更新 Sentiment 快照、标记 dirty flag
- **批处理路径**（每小时）：重算 Content DNA（需跨 Contact 对比）、压缩 Sentiment Arc、清理过期条目

详见 [ADR-0003](../../docs/adr/0003-graph-precomputation-dual-path.md)。

### 数据保留与分析窗口

- **所有 Interaction 数据永久保留**，确保 Timeline 完整性
- **Persona/State/Sentiment 推导仅使用最近 365 天的数据**——超过 1 年的行为不参与 AI 分析
- 同一客户跨产品不去重——每个产品的 Graph 独立

### 身份合并策略

| 置信度 | 条件 | 动作 |
|--------|------|------|
| **高** | 相同邮箱 / 相同已验证域名 / 社媒句柄精确匹配 | 静默自动合并 |
| **中** | 相同用户名 + 行为模式重叠 | Timeline 显示 "可能是同一人？" 一键确认 |
| **低** | 仅行为相似 | 不合并，Timeline 底部显示关联链接 |

### 读写分离

- **写**走 PostgreSQL 事务路径——Interaction 记录追加写入
- **读**走物化视图（数秒延迟）——包含 Persona 推导结果和 State 压缩数据
- AI 引擎不跨表 JOIN——读到的是就绪的摘要

### 外部系统集成

- 先只读：Timeline 中展示 CRM 标签和购买记录
- 不做双向操作（不从 Inbox 发起退款）
- 外部数据不参与计费统计

---

## 6. 技术架构

### 技术栈

| 层 | 选择 | 理由 |
|-----|------|------|
| **前端框架** | Next.js (App Router) + TypeScript | 统一 Dashboard 和多端渲染 |
| **样式** | Tailwind CSS + shadcn/ui | 组件可剪裁，不引入重量级设计系统 |
| **后端 API** | Hono (嵌入 Next.js) | 与前端共享 TypeScript 类型，对边缘部署友好 |
| **ORM** | Prisma | 类型安全的 schema-first 工作流，pgvector 原生支持，成熟迁移系统 |
| **数据库** | PostgreSQL + pgvector | 关系模型 + 向量检索同库；Persona embedding 不引入外部向量数据库 |
| **缓存/队列** | Redis + BullMQ | 发布队列、Campaign 步骤编排、速率限制 |
| **认证** | Auth.js (NextAuth v5) + email magic link | 免费、嵌入 App Router、无密码安全风险 |
| **AI 推理** | 用户自配 API key（OpenAI / Anthropic） | SpellPaw 不做模型代理，成本归用户 |
| **AI 框架** | Vercel AI SDK | 流式输出、工具调用、MCP 集成 |
| **MCP Server** | 嵌入 API 路由 `/api/mcp` | 非独立进程——复用连接池、auth session 和 Customer Graph 读取 |
| **文件存储** | S3 / Cloudflare R2 | 媒体文件 |
| **短链接** | 自托管短域 + 重定向端点 + Redis 计数 | 不依赖第三方服务，点击数据自有 |
| **i18n** | next-intl | App Router 原生支持、TypeScript 类型推断 |
| **部署** | 单体（Railway / Fly.io） | Surface 模块化加载，阶段 1-2 无微服务 |
| **测试** | Vitest（单元/集成）+ Playwright（E2E），不做组件测试 | |
| **CI/CD** | GitHub Actions CI（TypeCheck + Lint + Test），部署手动作业 | 阶段 1 无用户基数，自动 CD 成本不值得 |

### 平台 API 接入

- 集成方 key 模式：用户 OAuth 授权，SpellPaw 统一调用 Twitter/LinkedIn/Instagram 等平台 API

### 关键架构决策（详见 docs/adr/）

| ADR | 决策 |
|-----|------|
| [0001](../../docs/adr/0001-customer-graph-central-model.md) | Customer Graph 为唯一数据模型 |
| [0002](../../docs/adr/0002-monolithic-deployment-phase1-2.md) | 阶段 1-2 单体部署 |
| [0003](../../docs/adr/0003-graph-precomputation-dual-path.md) | Graph 预计算：增量 + 批处理双路径 |
| [0004](../../docs/adr/0004-oauth-integrated-party-key.md) | 平台 API 用集成方 key（OAuth） |
| [0005](../../docs/adr/0005-user-provided-model-keys.md) | AI 推理成本由用户密钥承担 |
| [0006](../../docs/adr/0006-prisma-orm.md) | ORM 选 Prisma |
| [0007](../../docs/adr/0007-authjs-magic-link.md) | 认证用 Auth.js + magic link |
| [0008](../../docs/adr/0008-bullmq-job-queue.md) | 异步任务队列用 BullMQ |
| [0009](../../docs/adr/0009-self-hosted-short-links.md) | 短链接和点击追踪自建 |
| [0010](../../docs/adr/0010-mcp-embedded.md) | MCP server 嵌入 API 进程 |
| [0011](../../docs/adr/0011-orchestration-engine-nl-state-machine.md) | 编排引擎：NL 目标 + 状态机执行 |

---

## 7. 定价策略

### 模型成本

用户自配模型 API key——SpellPaw 只接 key，不做代理调用。定价不再覆盖 AI 推理成本。

### 定价分层（按月度活跃 Contact 总数）

| 方案 | 月费 | 活跃 Contact/月 | 活跃 Campaign | AI 编排规则 |
|------|------|-----------|-------------|------------|
| **Free** | $0 | 100 | 1 个 | 3 条 |
| **Growth** | $79/mo | 1,000 | 10 个 | 20 条 |
| **Scale** | $149/mo | 5,000 | 30 个 | 无限制 |
| **Business** | $299/mo | 20,000 | 无限制 | 无限制 |

**所有方案共享**：全部 Surface、全部 AI 引擎能力、Customer Graph、三通道、所有 Channel 不设限。

**计费 Contact 定义**：月内有标志性互动的唯一个体——点击链接 ✓、评论/回复 ✓、点赞/收藏 ✓、主动进线 ✓；纯展示量不计入。每月 1 日重置。多 Workspace 合计。

### 阶段 1 支付策略

阶段 1 不做 Stripe 集成——Free 方案唯一可用，硬编码限额（3 Channels / 50 Posts / 100 Contacts）。超过时提示"升级"但不实施收费。Stripe 支付 + 订阅状态机推迟到阶段 2（Inbox 上线时）。

---

## 8. MVP 阶段规划

### 阶段 1：Content Engine（核心立足点）

**范围**：
- Content Surface（Composer + Calendar + 内嵌媒体生成）
- Customer Graph 基础层（Profile + Content Touch 记录 + Persona 占位框架）
- AI 引擎：内容生成能力
- 三通道（Dashboard + MCP + Messaging）全部就绪
- **不含** Inbox、Timeline、编排引擎

**交付物**：一个 AI 内容管理工具——生成多频道 Post、调度发布、追踪 Audience 行为。Customer Graph 从第一天的 Content Touch 开始积累。

**阶段 1 技术实现要点**：
- 认证：Auth.js magic link。注册 → Composer 立即可用，发布前要求配模型 key + OAuth Channel
- Composer 状态：Zustand（编辑器状态）+ TanStack Query（服务端持久化）
- 发布队列：BullMQ，单队列按 Channel 路由到独立 Worker
- 短链接：自托管 → 按 Contact 追踪点击 → 写入 Content Touch
- 支付：不做——仅硬编码 Free 限额
- 部署：Railway/Fly.io 单体 + GitHub Actions CI 保底

**阶段 1 关键策略**：
- 注册后第一个体验是 Composer，不是空白 Timeline
- **延迟授权**：注册 → 直接进入 Composer → AI 立即生成草稿预览 → 点 [发布] 才问：① 连渠道 ② 配模型 key
- Graph 不作为主菜单出现——作为帖子详情页和 Calendar 的旁路信息渐进展示
- "来为 Composer，留为 Graph"——用户最初因为内容工具进来，几周后 Graph 数据积累，自动展现差异化价值

### 阶段 2：Conversation Layer

**范围**：
- Inbox Surface（统一收件箱 + 1v1 对话 Agent + 社区频道监控）
- Customer Graph 扩充（Conversation、Sentiment Arc、Intent Vector）
- AI 引擎：对话代理能力
- Content Touch 与 Conversation 数据首次在 Graph 层汇合
- **不含** Timeline、编排引擎

**交付物**：内容管理 + 智能客服。两个 Surface 独立可用但共享 Graph。

### 阶段 3：Unification

**范围**：
- Customer Timeline Surface（全生命周期视图）
- 编排引擎（跨 Surface 目标驱动）
- AI 引擎：信号解读 + 分析归因
- Persona、State、Lifecycle Stage 全部上线
- 团队协作功能
- Customer Graph 完整形态

**交付物**：完整 SpellPaw。

---

## 9. 获客策略

| 层 | 做什么 | 为什么 |
|-----|---------|-------|
| **获客钩子** | 以"不限渠道的 AI 内容工具"推广 | 阶段 1 的 Content Surface 价值立即可见，不需要 Graph 积累 |
| **留存钩子** | 发了 2-3 周帖子后，Graph 在 Calendar/帖子详情页渐进展示洞察 | 不强行推销，"顺便看到" |
| **转化节点** | 用户看到"这 3 个人看了你 5 条帖子但从未联系你"的时刻 | 用户自己说出需求，不需要推销 |
| **口碑增长** | 用户自发截图分享 Graph 洞察 | 天然社交传播力 |

---

## 10. 竞争护城河

| 护城河 | 类型 | 生效阶段 |
|--------|------|---------|
| **客户中心架构** | 架构优势——EveryFeed 以帖子为中心，改造成本等于重建 | 从 Day 1 起 |
| **编排引擎** | 能力优势——跨 Surface AI 推理，需要统一数据层才成立 | 阶段 3 |
| **数据飞轮** | 时间优势——Graph 数据越多迁移成本越高 | 随使用时间自动增强 |
| **MCP 开放标准** | 生态优势——不是独立平台，而是 AI 助手的基础设施 | 从 Day 1 起 |

---

## 11. 风险与未解决事项

### 结构性风险

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| 社交媒体 API 依赖（平台收紧/涨价） | 高 | 多渠道覆盖降低单点依赖 |
| Graph 冷启动期价值展示不足 | 中 | 渐进亮相而非主推 |
| 单体架构未来扩展瓶颈 | 低 | 在 20K Contact/mo 前不构成问题 |
| 模型 key 停摆导致 AI 功能降级 | 中 | 优雅降级：手动编辑 + 无 AI 摘要 + 恢复后追赶 |
| 编排引擎 Plan 执行中途失败 | 中 | 分类失败（retry/skip/pause）不等同全停 |

### 产品边界（待后续决策）

| 问题 | 当前决策 |
|------|---------|
| 是否做付费广告投放 | 不做 |
| 是否做 Email 营销 | 不做 |
| 社区 Agent 是否可自动发言 | 否——仅监控标记 |
| 设计工作区深度 | Composer 内嵌轻量——不做独立工具 |
| 多语言范围 | UI 仅中英文，不做 RTL |
| 阶段 1 支付 | 不做 Stripe，硬编码 Free 限额 |
| 阶段 1 团队功能 | 不做——单人使用 |

---

## 12. 决策速查

| # | 决策 | 结论 | ADR |
|----|------|------|-----|
| 1 | 为什么不用 EveryFeed+Sierra 拼装 | Cross-Surface 上下文推理是拼装做不到的能力差异 | — |
| 2 | 冷启动留存 | 阶段 1 展示 Graph 生长，渐进亮相 | — |
| 3 | 定价差异理由 | 不限渠道 + Graph 可视 + 编排预览 | — |
| 4 | 团队功能 | 推迟到阶段 3 | — |
| 5 | 身份合并 | 概率自动 + 低置信度人工确认 | — |
| 6 | Discord/Slack 社区 | 纳入 Inbox，不建独立 Surface | — |
| 7 | 社区 Agent 角色 | 监控标记，不代发言 | — |
| 8 | 数据分析窗口 | 1 年 | — |
| 9 | 外部系统集成 | 先只读 | — |
| 10 | 三通道 MVP | 全做 | — |
| 11 | AI 模型成本 | 用户自配 model key | 0005 |
| 12 | Freemium | 3 Channel / 50 Posts / 100 Contacts，阶段 1 不接入 Stripe | — |
| 13 | 竞争护城河 | Contact 中心架构 + 编排引擎 + 数据飞轮 | 0001 |
| 14 | 平台 API | 集成方 key（OAuth） | 0004 |
| 15 | 获客策略 | 来为 Composer，留为 Graph | — |
| 16 | 首次体验 | 延迟授权，立即创作 | — |
| 17 | 语言/国际 | UI 中英文、不做 RTL | — |
| 18 | 多 Workspace | 按总 Contact 数计费，跨 Workspace 不去重 | — |
| 19 | 媒体生成 | Composer 内嵌轻量，不做独立工具 | — |
| 20 | 审批粒度 | 信任开关——按 Channel/内容类型配置 | — |
| 21 | ORM | Prisma | 0006 |
| 22 | 认证 | Auth.js + email magic link | 0007 |
| 23 | MCP server | 嵌入 API 路由，非独立进程 | 0010 |
| 24 | Channel API 抽象 | Adapter 模式——每个平台独立 adapter | — |
| 25 | 短链接追踪 | 自托管，不依赖第三方 | 0009 |
| 26 | Composer 状态管理 | Zustand + TanStack Query | — |
| 27 | 阶段 1 支付 | 不做 Stripe，硬编码 Free 限额 | — |
| 28 | i18n 方案 | next-intl | — |
| 29 | 任务队列 | BullMQ，单队列 Channel Worker 隔离 | 0008 |
| 30 | 测试策略 | Vitest + Playwright，不做组件测试 | — |
| 31 | CI/CD | GitHub Actions CI only，手动部署 | — |
| 32 | 部署架构 | 阶段 1-2 单体，Surface 模块内加载 | 0002 |
| 33 | Graph 预计算 | 增量（< 3s）+ 批处理（每小时）双路径 | 0003 |
| 34 | 编排引擎 | 自然语言目标 + 确定状态机执行，不在阶段 1 实现 | 0011 |
