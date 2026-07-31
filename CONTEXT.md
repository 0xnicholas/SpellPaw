# SpellPaw

SpellPaw 是面向 SMB 和 AI-native builders 的外部沟通 AI 操作系统，将内容营销、客户服务和客户生命周期管理统一到一个平台上。

## Language

### Account

**Account**:
用户的登录身份，包含邮箱、密码和账单信息。一个 Account 可拥有多个 Workspace。
*Avoid*: User, profile, member

**Workspace**:
Account 下被管理的主体——拥有一套独立的 Channels、Customer Graph、Posts、Inbox 和 Campaign。不同 Workspace 数据完全隔离。面向用户时可称为"空间"或直接显示其名称。
*Avoid*: Team, project, brand, product, sub-account

### Channels

**Channel**:
用户连接的外部沟通入口（Twitter、Discord、LinkedIn、Email 等）。所有 Channel 在 Connect 流程中平等对待。
*Avoid*: Platform, network, account, social

**Room**:
Discord/Slack Channel 内部子频道（如 #general、#support）。仅在 Inbox Surface 使用，不暴露给 Content Surface 或 Calendar。
*Avoid*: Sub-channel, group

### People

**Contact**:
在 SpellPaw 系统里被追踪到的任何人——有至少一次 Interaction 记录。
*Avoid*: Customer, user, lead, prospect

**Audience**:
仅有 Content Touch 互动、从未进过 Inbox 的 Contact。是 Contact 的一种状态，随时间可转化为 Correspondent。
*Avoid*: Viewer, follower, lurker

**Correspondent**:
至少有一次 Inbox 对话记录的 Contact。是 Contact 的一种状态。
*Avoid*: Lead, customer, chatter

### Content

**Post**:
Content Surface 中创建的内容单元——一对多向外发布。生命周期：Draft → Scheduled → Published。每个 Channel 有独立的 Post Variant（适应各平台格式）。
*Avoid*: Content, tweet, update, announcement

**Message**:
Inbox Surface 中收发的通信单元——一对一对话。来自 Correspondent（入向）或用户/Agent（出向）。Post 的公开评论自动创建入向 Message。
*Avoid*: Reply, response, chat, DM

### Data

**Interaction**:
Contact 时间轴上的一次事件记录。三种子类型：
- **Content Touch**：Contact 与 Post 的互动（点击、点赞、分享）。来源：SpellPaw 自身追踪。
- **Conversation**：Inbox 中的 Message 交换。来源：Inbox Surface。
- **Event**：Contact 在用户产品内部的行为（注册、订阅、升级、登录、功能使用）。来源：外部系统只读连接或手动标记。

所有 Interaction 数据永久保留；AI 推导（Persona/State）仅使用最近 365 天的数据。
*Avoid*: Activity, log entry, signal

**Profile**:
Contact 的基础身份信息——名称、邮箱、社媒句柄、首次来源 Channel、用户自定义标签。与 Persona 区分：Profile 是事实数据（可读可编辑），Persona 是 AI 推导的统计抽象。
*Avoid*: Identity, contact info

**Links**:
Contact 在外部系统中的关联标识（CRM ID、支付系统 Customer ID）。只读引用，不产生新 Interaction。仅用于 Timeline 中展示上下文和跨系统去重。
*Avoid*: Integration, connector, sync

**Customer Graph**:
以 Contact 为中心的统一数据层，包含 Profile、Interaction 历史、AI 推导画像（Persona）、当前状态机（State）和外部系统关联（Links）。
*Avoid*: User database, CRM, data warehouse

**Lifecycle Stage**:
Contact 在客户旅程中的阶段——由规则触发自动流转，部分阶段可手动标记。完整状态机：Aware → Engaged → Activated → Loyal → At Risk → Churned。从 Churned 重新活跃则回到 Aware。
- **Aware**：首次 Content Touch——进入系统的起点。
- **Engaged**：累计 3 次 Content Touch 或 1 次 Conversation。
- **Activated**：首次有产品使用证据（Conversation 中表达使用/购买意图、Event 注册/订阅，或用户手动标记）。最关键的一步。
- **Loyal**：Activated 后连续 3 月有正面 Interaction。
- **At Risk**：30 天无 Interaction，或 Conversation 中出现负面 Sentiment 信号。
- **Churned**：At Risk 持续 90 天未恢复。
*Avoid*: Segment, tier, status

**Persona**:
AI 从 Interaction 历史中推导出的 Contact 画像。由三个部分组成：
- **Content DNA**：Contact 对什么内容类型、渠道、语调最敏感（从 Content Touch 模式聚合推导）。
- **Sentiment Arc**：Contact 的情感变化曲线——按时间压缩的 Sentiment 趋势（从 Conversation 文本分析推导）。
- **Intent Vector**：Contact 当前的意图方向（探索、购买、投诉、流失等——从近期所有 Interaction 综合推导）。

Persona 数据仅基于最近 365 天的 Interaction。它是对 Contact 的统计抽象，不包含原始 PII。
*Avoid*: Profile, segmentation, attributes

**State**:
Contact 的当前状态机快照：
- **Lifecycle Stage**：Aware/Engaged/Activated/Loyal/At Risk/Churned。
- **Risk Score**：流失概率（0-100）。
- **Opportunity Score**：增购/升级可能性（0-100）。

State 数据实时更新——基于最新的 Interaction 事件触发重算。
*Avoid*: Status, segment, tier

### Architecture

**Surface**:
一个独立的交互模块，拥有自己的 UI 范式和交互模式，共享底层 AI 引擎和 Customer Graph。不暴露在用户界面中——面向用户的标签使用更直白的名称（"发布"/"收件箱"/"客户"）。
*Avoid*: View, workspace, panel, module

**Campaign**:
编排引擎执行的一个目标驱动的跨 Surface 行为封装。包含 Goal（用户业务目标）、Plan（AI 生成的行动序列）和 State（执行状态）。定价分层中的"活跃 Campaign"指 State=Active 的 Campaign 数量。
*Avoid*: Workflow, automation, sequence

### Processes

**Connect**:
用户将外部 Channel 连入 SpellPaw 的流程。通过 OAuth 授权，SpellPaw 获得调用平台 API 的权限。

