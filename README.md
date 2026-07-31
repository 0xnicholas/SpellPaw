# SpellPaw

AI-native 外部沟通操作系统——一个人、一个 AI、管理获客到留存的所有外部沟通。

## 是什么

SpellPaw 面向 SMB 和 AI-native builders，将内容营销、客户服务和客户生命周期管理统一到一个平台上。它用 **Contact-Centric Customer Graph** 取代三套割裂的工具，让你从任何 AI 助手（ChatGPT、Claude、Cursor）或在 Web Dash 里创建内容、响应对话、跟踪客户旅程。

> 你只需要一个对外界面。SpellPaw 管理其余的一切。

## 当前阶段

**Phase 1: Content Engine** — AI 驱动的多渠道内容管理工具。Composer + Calendar + 发布调度 + Customer Graph 基础层。

- [产品概念设计](docs/design/2026-07-31-spellpaw-concept.md)
- [Phase 1 PRD](docs/design/spellpaw-prd-phase1.md)
- [域术语表](CONTEXT.md)

## 文档结构

```
SpellPaw/
├── CONTEXT.md              ← 域术语表（Contact、Post、Channel 等标准语言）
├── docs/
│   ├── adr/                ← 架构决策记录（11 ADR）
│   ├── design/             ← 概念设计和 PRD
│   ├── agents/             ← Agent 技能配置（issue tracker、triage labels）
│   └── research/           ← 竞品调研（EveryFeed、Sierra）
```

## 技术栈

| 层 | 选择 |
|-----|------|
| 前端 | Next.js (App Router) + TypeScript |
| 样式 | Tailwind CSS + shadcn/ui |
| 后端 | Hono（嵌入 Next.js） |
| ORM | Prisma |
| 数据库 | PostgreSQL + pgvector |
| 队列 | Redis + BullMQ |
| 认证 | Auth.js + email magic link |
| AI | 用户自配 API key + Vercel AI SDK |
| MCP | 嵌入 API 路由 |
| 部署 | 单体（Railway / Fly.io） |

详见 [ADR 索引](docs/adr/)。

## 快速开始

```bash
# 安装
pnpm install

# 启动开发环境
pnpm dev

# 运行测试
pnpm test
```

## 调研背景

- [EveryFeed.ai 调研报告](docs/research/everyfeed-ai-report.md) — AI 社交媒体管理平台分析
- [Sierra.ai 调研报告](docs/research/sierra-ai-report.md) — 企业对话 AI 平台分析
