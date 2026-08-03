# SpellPaw

AI-native 外部沟通操作系统——一个人、一个 AI、管理获客到留存的所有外部沟通。

## 是什么

SpellPaw 面向 SMB 和 AI-native builders，将内容营销、客户服务和客户生命周期管理统一到一个平台上。它用 **Contact-Centric Customer Graph** 取代三套割裂的工具，让你从任何 AI 助手（ChatGPT、Claude、Cursor）或在 Web Dash 里创建内容、响应对话、跟踪客户旅程。

> 你只需要一个对外界面。SpellPaw 管理其余的一切。

## 当前阶段

**Phase 1 · M1 "Hello Graph" 已实现** — 最小可用闭环：

- ✅ 注册/登录（Auth.js 邮箱 magic link，dev 模式打印到控制台）
- ✅ Workspace 引导（首次登录自动创建）
- ✅ 单渠道连接（OAuth2 PKCE 流程，token AES-256-GCM 加密存储；未配置凭据时用 MockAdapter 走通全流程）
- ✅ Composer：创建 Post + 按渠道维护 Variant + 字符数校验
- ✅ 发布（Draft → Published，渠道隔离失败不影响其他渠道）与排程（Draft → Scheduled）
- ✅ 基础 Calendar（周视图，展示 Scheduled/Published）
- ✅ 嵌入 Hono API（/api/*）+ Vitest 单元/集成测试（54 个）+ GitHub Actions CI

**未实现（后续里程碑）**：BullMQ 发布队列（M2）、短链接 + Content Touch（M4）、MCP Server（M3）、媒体生成（M4）、分析面板（M4）、i18n（M4）。

- [产品概念设计](docs/design/2026-07-31-spellpaw-concept.md)
- [Phase 1 PRD](docs/design/spellpaw-prd-phase1.md)
- [Phase 1 实现规格](docs/design/spellpaw-phase1-implementation.md)
- [域术语表](CONTEXT.md)

## 技术栈

| 层 | 选择 |
|-----|------|
| 前端 | Next.js (App Router) + TypeScript |
| 样式 | Tailwind CSS |
| 后端 | Hono（嵌入 Next.js，`/api/[[...route]]`） |
| ORM | Prisma 7（driver adapter + pg） |
| 数据库 | PostgreSQL + pgvector（Docker Compose，宿主机端口 5433） |
| 认证 | Auth.js v5 + 邮箱 magic link（JWT 会话） |
| 状态 | Zustand（Composer 编辑器）+ TanStack Query（服务端持久化） |
| 测试 | Vitest（单元 + 集成，测试库 `spellpaw_test`） |
| CI/CD | GitHub Actions CI（TypeCheck + Lint + Test） |

详见 [ADR 索引](docs/adr/)。

## 本地开发

```bash
# 1. 基础设施（Postgres + pgvector）
docker compose up -d

# 2. 环境变量
cp .env.example .env
# 然后生成并填入 AUTH_SECRET 和 ENCRYPTION_KEY：
#   openssl rand -base64 32

# 3. 数据库 + 种子渠道（twitter / linkedin / instagram）
pnpm prisma migrate dev
pnpm db:seed

# 4. 启动
pnpm dev        # http://localhost:3000 —— magic link 打印在终端

# 5. 测试
pnpm test              # 单元 + 集成（依赖 docker 里的 Postgres）
pnpm typecheck
pnpm lint
```

> 注意：本机 5432 已被 Postgres.app 占用，Docker 映射到 **5433**。集成测试使用独立数据库 `spellpaw_test`（docker/init 自动创建），不会触碰开发数据。

## 调研背景

- [EveryFeed.ai 调研报告](docs/research/everyfeed-ai-report.md) — AI 社交媒体管理平台分析
- [Sierra.ai 调研报告](docs/research/sierra-ai-report.md) — 企业对话 AI 平台分析
