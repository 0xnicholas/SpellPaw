# SpellPaw

AI-native 外部沟通操作系统——一个人、一个 AI、管理获客到留存的所有外部沟通。

## 是什么

SpellPaw 面向 SMB 和 AI-native builders，将内容营销、客户服务和客户生命周期管理统一到一个平台上。它用 **Contact-Centric Customer Graph** 取代三套割裂的工具，让你从任何 AI 助手（ChatGPT、Claude、Cursor）或在 Web Dash 里创建内容、响应对话、跟踪客户旅程。

> 你只需要一个对外界面。SpellPaw 管理其余的一切。

## 当前阶段

**Phase 1 · M1–M4 已实现，M5 发布就绪进行中**

M1 "Hello Graph"：

- ✅ 注册/登录（Auth.js 邮箱 magic link，dev 模式打印到控制台）
- ✅ Workspace 引导（首次登录自动创建）
- ✅ 单渠道连接（OAuth2 PKCE 流程，token AES-256-GCM 加密存储；未配置凭据时用 MockAdapter 走通全流程）
- ✅ Composer：创建 Post + 按渠道维护 Variant + 字符数校验
- ✅ 发布与排程状态机 + 基础 Calendar（周视图）
- ✅ 嵌入 Hono API（/api/*）+ Vitest 测试 + GitHub Actions CI

M2 "队列 + 排程"：

- ✅ BullMQ v6 队列（Redis）：每个渠道独立 publish 队列 + Worker（并发 5）
- ✅ 发布流程：202 Accepted → 队列异步执行 → Published/Failed；渠道失败互不阻塞
- ✅ 失败重试：瞬时错误 3 次指数退避（30s/60s/120s），永久错误（校验/未连接）不重试直接标记
- ✅ FAILED variant 可重新发布（幂等 jobId，不重复入队）
- ✅ 排程：≤7 天用 BullMQ delayed job（jobId 幂等，改期先删后加），>7 天由 5 分钟 cron reconciler 兑底
- ✅ 取消排程：移除 scheduler job + 待触发的 publish job
- ✅ UI：PostList/Calendar 显示 queued/posting 状态徽章，非终态时 2.5s 轮询
- ✅ 队列集成测试（9 个，真实 Redis）；全量 76 个测试

**里程碑（2026-08 重新审视，ADR 0012）**：

- ✅ M3 "AI Sees You"：BYOK AI Provider（OpenAI/Anthropic，密钥加密存储）+ 嵌入式 MCP Server（5 模块 14 Tools，PII 契约）
- ✅ M4 "Graph Emerges"：自托管短链 + ContentTouch 点击管道 + Customer Graph 真数据、分析面板、i18n（en 主 / zh 次）
- ✅ M5 发布就绪（进行中）：MCP/API 文档、部署指南、性能/安全加固、Landing + 案例（英文叙事）
- ⏳ 【插入】Twitter/X 真实接入（OAuth 四件套 + 开发者审核）——真实渠道闭环的前置项
- M6+ 反馈驱动：Inbox Phase 1 / 分析深度 / 编排引擎（按此顺序）
- 其余尾项：Calendar 拖拽改期（M2）、护栏式限额已落地（3/50/1000，env 可调）

- [产品概念设计](docs/design/2026-07-31-spellpaw-concept.md)
- [Phase 1 PRD](docs/design/spellpaw-prd-phase1.md)
- [Phase 1 实现规格](docs/design/spellpaw-phase1-implementation.md)
- [域术语表](CONTEXT.md)
- [API 文档（REST + MCP 工具）](docs/api.md)
- [自托管部署指南](docs/ops/DEPLOYMENT.md)

## 技术栈

| 层 | 选择 |
|-----|------|
| 前端 | Next.js (App Router) + TypeScript |
| 样式 | Tailwind CSS |
| 后端 | Hono（嵌入 Next.js，`/api/[[...route]]`） |
| ORM | Prisma 7（driver adapter + pg） |
| 数据库 | PostgreSQL + pgvector（Docker Compose，宿主机端口 5433） |
| 队列 | BullMQ v6 + Redis（Docker Compose，端口 6379） |
| 认证 | Auth.js v5 + 邮箱 magic link（JWT 会话） |
| 状态 | Zustand（Composer 编辑器）+ TanStack Query（服务端持久化） |
| 测试 | Vitest（单元 + 集成，测试库 `spellpaw_test`） |
| CI/CD | GitHub Actions CI（TypeCheck + Lint + Test） |

详见 [ADR 索引](docs/adr/)。

## 本地开发

```bash
# 1. 基础设施（Postgres + pgvector + Redis）
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
pnpm test              # 单元 + 集成（依赖 docker 里的 Postgres + Redis）
pnpm typecheck
pnpm lint
```

> 注意：本机 5432 已被 Postgres.app 占用，Docker 映射到 **5433**。集成测试使用独立数据库 `spellpaw_test`（docker/init 自动创建），不会触碰开发数据。

## 调研背景

- [EveryFeed.ai 调研报告](docs/research/everyfeed-ai-report.md) — AI 社交媒体管理平台分析
- [Sierra.ai 调研报告](docs/research/sierra-ai-report.md) — 企业对话 AI 平台分析
