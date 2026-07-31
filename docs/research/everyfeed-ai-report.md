# EveryFeed.ai 竞品/市场研究报告

**日期**: 2026-07-31
**来源**: [https://everyfeed.ai/](https://everyfeed.ai/)

---

## 1. 概述

EveryFeed 是一个 AI 驱动的社交媒体管理与自动化平台，定位为 "面向开发者的 AI 社交媒体管理"（AI social media management for builders）。核心理念是让产品开发者用他们已有的 AI 助手（如 ChatGPT、Claude、Cursor 等）直接管理社交媒体，无需雇用代理商或专门的营销人员。

**标语**: "Run it yourself. No agency or marketing hire needed."（自己动手，无需代理商或营销人员。）

**公司**: VoltAgent Inc.，注册于特拉华州，办公地点在加州 San Ramon。

---

## 2. 目标用户

- 独立开发者（Solo builders）
- 正在发布产品的开发者
- 产品负责人（Product owners）
- 项目负责人（Project owners）
- 产品团队（Product teams）
- 没有营销团队的创始人
- 独立创客（Indie hackers）
- 小型企业
- 自由职业者和代理商
- 内容创作者和网红
- 正在增长社交媒体账号的人

---

## 3. 核心功能

### 3.1 创建（Create）
- 将产品更新转化为社交媒体帖子
- 一个编辑器适配所有频道
- 支持线程帖子（thread）
- AI 辅助写作

### 3.2 适配与调度（Adapt & Schedule）
- 按频道进行文案适配（各平台字数限制、格式规则）
- 实时预览各频道效果
- 周级日历规划
- 模板系统

### 3.3 设计与媒体生成（Design）
- 内置设计工作区（Design workspace）
- 制作帖子图形、短视频、AI 配音幻灯片（narrated slides）
- AI 图像生成
- AI 视频生成（短视频，9:16 / 16:9）
- 模板系统、Unsplash 集成

### 3.4 发布（Publish）
- 支持 35+ 频道
- 验证后发布
- 自动化发布

### 3.5 自动化（Automate）
- 连接 Changelog / RSS feed，自动将每次发布转化为草稿
- 自动转发（Auto Repost）：设定点赞阈值，当帖子热度达标时自动转发或追加回复
- 去重：同一内容不会重复发布

### 3.6 协作（Collaborate）
- 客户端连接邀请链接（无需共享密码）
- 项目与客户分组
- 角色与席位管理
- 草稿评论与讨论

### 3.7 分析（Analyze）
- 发布吞吐量（Publishing throughput）：已发布/已调度/失败按日统计
- 运营指标：最佳发布时段、活跃账号数、媒体附加率、短链接点击量
- 频道趋势对比（7天/30天/90天）：展示量、点赞、评论变化
- Top帖子排名（按参与度评分）

### 3.8 Social Agent（社交代理）
- AI 根据用户指令制定发布计划并生成各频道草稿
- 自动检查频道规则
- 自动找到日历空位
- 生成启动视觉素材
- 验证草稿无误后提交审批
- 用户审核后方可发布

---

## 4. AI 集成

EveryFeed 的核心卖点是与用户已在使用的 AI 助手深度集成：

- **支持的 AI 助手**: ChatGPT, Claude, Gemini, Cursor, Codex, OpenClaw, Hermes 等（"5+ more"）
- **使用方式**:
  - 在 ChatGPT / Claude / Gemini 聊天界面中直接创建、调度、发布帖子
  - OpenClaw / Hermes 支持从任意地方发消息给 Agent，Agent 通过 EveryFeed 准备并发布
- **MCP 服务器**: 为 AI 助手提供 MCP server，使其可以直接操作 EveryFeed
- **REST API**: 带 scoped tokens 的 REST API + TypeScript SDK + CLI + 签名 webhooks

---

## 5. 支持的平台（35+ 频道）

| 类别 | 平台 |
|------|------|
| 主流社交 | X (Twitter), LinkedIn, Instagram, Facebook, TikTok, YouTube, Threads |
| 新兴社交 | Bluesky, Mastodon, Farcaster |
| 社区/聊天 | Reddit, Discord, Slack, Telegram |
| 图片/设计 | Pinterest, Dribbble |
| 博客/发布 | WordPress, Dev.to, Medium, Hashnode, Tumblr |
| 视频/直播 | Twitch |
| 其他 | Google Business, VK, Lemmy, ListMonk |

---

## 6. 定价方案

| 方案 | 价格（月付） | 频道 | 帖子 | 成员 | AI 图片 | AI 视频 | RSS 自动化 | Webhooks | API Tokens |
|------|-------------|------|------|------|---------|---------|------------|----------|------------|
| **Standard** | $29/mo | 5 | 400 | 1 | 20 | 3 | 1 | 2 | 2 |
| **Team** (推荐) | $39/mo | 10 | 无限制 | 无限制 | 100 | 10 | 10 | 10 | 10 |
| **Pro** | $49/mo | 30 | 无限制 | 无限制 | 300 | 30 | 30 | 30 | 30 |
| **Ultimate** | $99/mo | 100 | 无限制 | 无限制 | 500 | 60 | 100 | 10,000 | 100 |

- 所有方案包含 7 天免费试用
- 所有方案包含 AI 自动补全、AI copilots、高级图片编辑器、媒体导入
- 无共享额度系统（AI 文本起草不消耗媒体配额）

---

## 7. 多语言支持

支持 16 种语言，包括阿拉伯语和希伯来语的 RTL 布局。AI 默认以用户使用的语言起草内容。

---

## 8. 市场定位分析

### 价值主张
- **节省时间**: 声称手动管理社交媒体每周需约 10 小时（一个产品、4-5 个频道）
- **节省成本**: 代理商月费约 $2,000 起步，EveryFeed 从 $29/月起
- **自主控制**: 强调用户保持控制权，无密码共享，所有发布需审批

### 差异化特点
1. **AI 助手原生集成** — 不只是一个独立工具，而是嵌入到开发者已有的 AI 工作流中
2. **面向开发者** — 文案风格针对技术产品创始人，并提供 API、SDK、CLI、MCP
3. **无需营销专业知识** — 用自然语言告诉 AI 你发布了什么，AI 处理格式和规则
4. **全流程覆盖** — 从创建、设计、调度、发布到分析的一站式平台

### 可能的局限性
- AI 媒体（图片/视频）有月度配额限制，高需求用户可能不够
- 依赖 AI 生成内容的质量，可能不适合需要高度品牌定制的企业
- 低端方案（Standard）仅有 400 帖/月和一个成员，小型团队可能很快受限

---

## 9. 技术栈推断

- 前端：现代 Web 应用（React/Next.js 或类似框架）
- API：REST API + MCP server
- SDK/CLI：TypeScript
- 基础设施：Webhook 支持、RSS/Atom feed 解析
- AI 集成：多模型支持（通过 MCP 协议兼容多种 AI 助手）

---

## 10. 对 SpellPaw 的参考意义

（待后续分析补充）
