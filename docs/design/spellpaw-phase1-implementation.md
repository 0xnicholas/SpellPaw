# SpellPaw Phase 1 — Implementation Specification

**日期**: 2026-07-31
**来源**: [产品概念设计](./2026-07-31-spellpaw-concept.md) · [Phase 1 PRD](./spellpaw-prd-phase1.md)
**关联**: [CONTEXT.md](../../CONTEXT.md) · [ADR 索引](../../docs/adr/)

---

## 1. 数据模型 (Prisma Schema)

### 核心实体

```prisma
model Workspace {
  id        String   @id @default(cuid())
  accountId String
  name      String
  createdAt DateTime @default(now())
}

model Contact {
  id              String    @id @default(cuid())
  workspaceId     String
  type            ContactType  // AUDIENCE | CORRESPONDENT — 事件触发联动更新

  // Profile (PII, user-editable)
  profileName         String?
  profileEmail        String?
  profileSocialHandle String?
  profileSourceChannel String?
  profileTags         String[]

  // Persona (AI-derived, no PII, 365-day window)
  personaContentDNA   Json?
  personaSentimentArc Json?
  personaIntentVector Float[]?  // pgvector

  // State (real-time, rules-driven)
  stateLifecycleStage    LifecycleStage @default(AWARE)
  stateRiskScore         Int?
  stateOpportunityScore  Int?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Post {
  id          String        @id @default(cuid())
  workspaceId String
  title       String?
  status      PostStatus    @default(DRAFT)
  scheduledAt DateTime?
  publishedAt DateTime?
  createdAt   DateTime      @default(now())
  variants    PostVariant[]
}

model PostVariant {
  id           String        @id @default(cuid())
  postId       String
  channelId    String
  content      String
  charCount    Int
  mediaUrls    String[]
  publishState PublishState  @default(DRAFT)
  publishedAt  DateTime?
  errorMessage String?

  post         Post          @relation(fields: [postId], references: [id])
}

model Channel {
  id   String @id @default(cuid())
  slug String @unique
  name String
}

model OAuthConnection {
  id           String    @id @default(cuid())
  workspaceId  String
  channelId    String
  accessToken  String    // AES-256-GCM encrypted
  refreshToken String?
  expiresAt    DateTime?
  connectedAt  DateTime  @default(now())

  channel      Channel   @relation(fields: [channelId], references: [id])
}

model ModelProviderKey {
  id           String   @id @default(cuid())
  workspaceId  String
  provider     String   // "openai" | "anthropic"
  encryptedKey String   // AES-256-GCM encrypted
  keyPreview   String   // "sk-...a1b2"
  isActive     Boolean  @default(true)
  lastChecked  DateTime?
  createdAt    DateTime @default(now())
}

model ShortLink {
  id        String   @id @default(cuid())
  code      String   @unique
  targetUrl String
  postId    String
  createdAt DateTime @default(now())
}
```

### Interaction 表（分表 + VIEW 合并）

```prisma
model ContentTouch {
  id        String      @id @default(cuid())
  contactId String
  postId    String
  action    TouchAction // CLICK | LIKE | SHARE
  timestamp DateTime    @default(now())
}

model Conversation {
  id        String        @id @default(cuid())
  contactId String
  messageId String
  direction ConvDirection // INBOUND | OUTBOUND
  timestamp DateTime      @default(now())
}

model Event {
  id             String    @id @default(cuid())
  contactId      String
  eventType      EventType // REGISTER | SUBSCRIBE | UPGRADE | LOGIN | ...
  externalSource String?
  timestamp      DateTime  @default(now())
}
```

合并查询视图：

```sql
CREATE VIEW contact_timeline AS
  SELECT id, contactId, 'CONTENT_TOUCH' AS type, timestamp,
         jsonb_build_object('postId', postId, 'action', action) AS payload
  FROM content_touch
  UNION ALL
  SELECT id, contactId, 'CONVERSATION'  AS type, timestamp,
         jsonb_build_object('messageId', messageId, 'direction', direction) AS payload
  FROM conversation
  UNION ALL
  SELECT id, contactId, 'EVENT'         AS type, timestamp,
         jsonb_build_object('eventType', eventType) AS payload
  FROM event;
```

### 关键设计决策

| 决策 | 方案 | 理由 |
|------|------|------|
| Contact 类型 | `type` 枚举字段，事件触发联动更新 | 实时一致、读无 JOIN |
| Post-Variant | 一对多关系，分表存储 | 按 Channel 索引查询、Variant 独立状态更新 |
| Interaction 并存 | 三类分表 + VIEW 合并 | 各自独立索引优化、Timeline 一次查询完成 |
| PII 分离 | 同表命名前缀 `profile_*` vs `persona_*` | 读取时按需 SELECT，MCP 不暴露 PII |
| Channel 存储 | Channel 表元数据 + OAuthConnection 表 | 新增渠道 INSERT 一行，无需 migration |
| Adapter 注册 | 运行时 TypeScript Map——不存 DB | 纯函数映射，不序列化 |

---

## 2. API Route 结构

```
/api/posts          GET (list) / POST (create)
/api/posts/:id      GET / PATCH / DELETE
/api/variants/:vid  GET / PATCH
/api/schedule/:pid  POST (set) / PATCH (reschedule) / DELETE (cancel)
/api/calendar       GET (?view=week&channels=...)
/api/channels       GET (list + status)
/api/channels/:slug/connect POST (start OAuth)
/api/channels/:slug DELETE (disconnect)
/api/media/upload   POST (multipart)
/api/media/generate POST ({ prompt, style })
/api/media/search   GET (?q=laptop&page=1)
/api/analytics/dashboard GET
/api/analytics/posts/:id GET
/api/analytics/top-posts GET
/api/contacts       GET (?stage=engaged&limit=20)
/api/contacts/:id   GET (Persona + State, no PII)
/api/contacts/insights/repeat-viewers GET
/api/settings/model-keys   GET / POST
/api/settings/model-keys/:id DELETE
/api/settings/workspace    GET / PATCH
/api/mcp/*          MCP SSE + messages (embedded, not separate service)
```

Hono catch-all 结构：

```typescript
// app/api/[[...route]]/route.ts
const app = new Hono()
  .route('/posts',     postsRoutes)
  .route('/variants',  variantRoutes)
  .route('/schedule',  scheduleRoutes)
  .route('/calendar',  calendarRoutes)
  .route('/channels',  channelRoutes)
  .route('/media',     mediaRoutes)
  .route('/analytics', analyticsRoutes)
  .route('/contacts',  contactRoutes)
  .route('/settings',  settingsRoutes)
  .route('/mcp',       mcpRoutes)
```

---

## 3. MCP Server Tool 定义

阶段 1 暴露 5 个模块、14 个 Tools：

| 模块 | Tools | 说明 |
|------|-------|------|
| **Post** | `post.create_draft`, `post.list`, `post.get`, `post.update_variant` | 内容创建与管理 |
| **Schedule** | `schedule.set`, `schedule.reschedule`, `schedule.cancel` | 排程操作 |
| **Calendar** | `calendar.view`, `calendar.find_slot` | 日历视图与空位查询 |
| **Performance** | `post.performance`, `dashboard.summary` | Post 表现与 Dashboard 摘要 |
| **Contacts** | `contact.list`, `contact.get`, `contact.repeat_viewers` | Graph 读取——永不含 PII |

Tool 安全约束：
- `contact.get` 返回 Persona + State + 最近 Interaction，永不暴露 `profileName/Email/SocialHandle`
- 写操作 (`create/update/schedule`) 受 MCP token cap 约束
- 发布类操作需 AI 对话内审批（除非用户开启信任开关）

---

## 4. 组件树

```
app/[locale]/(dashboard)/[workspaceId]/content/
├── page.tsx                    ← ContentPage (Server Component)
│
├── _components/
│   ├── ComposerPanel.tsx
│   │   ├── GlobalEditor.tsx       ← 源文本 + AI 生成按钮
│   │   ├── ChannelTabBar.tsx      ← Twitter | LinkedIn | Instagram
│   │   ├── VariantEditor.tsx      ← 单 Channel 编辑
│   │   │   ├── CharCounter.tsx
│   │   │   ├── MediaPicker.tsx    ← [AI Generate] [Upload] [Unsplash]
│   │   │   └── ChannelPreview.tsx ← 平台渲染预览
│   │   └── PublishBar.tsx         ← [Save Draft] [Schedule] [Publish]
│   │
│   ├── CalendarPanel.tsx
│   │   ├── CalendarHeader.tsx     ← 周/月切换 + 导航
│   │   ├── CalendarGrid.tsx       ← 日期格子 + PostCard (拖拽: @dnd-kit)
│   │   ├── PostCard.tsx           ← 单 Post 概要
│   │   └── PostQuickView.tsx      ← Side Panel (Post详情 + Graph数据)
│   │
│   └── PerformancePanel.tsx
│       ├── SummaryCards.tsx       ← Posts | Scheduled | Failed | Clicks
│       ├── TopPostsList.tsx
│       └── GraphInsight.tsx       ← 3人看了5条帖仍未联系
```

状态管理：
- **Zustand** — Composer 编辑器本地状态（globalDraft, channelVariants, activeTab, isGenerating）
- **TanStack Query** — 服务端持久化（drafts, schedule, analytics, contacts）
- 两个 store 之间通过 ComposerPanel 协调——不跨组件共享

---

## 5. 异步流程

### 短链接重定向 + Content Touch

```
Short link click → Next.js Middleware (< 30ms)
    │
    ├─ Redis cache hit → 301 Redirect
    │                   └─ fire-and-forget → BullMQ clickQueue
    │                                         └─ Worker batch INSERT ContentTouch
    │
    └─ Redis miss → PG lookup → write cache → 301 Redirect
                    └─ fire-and-forget → BullMQ clickQueue
```

### 发布队列

```
Post Publish → BullMQ publishQueue
    │
    ├─ TwitterWorker   (isolated, 3 retries with backoff 30s/2m/8m)
    ├─ LinkedInWorker  (isolated)
    └─ InstagramWorker (isolated)

Status flow: Queued → Posting → Published / Failed
One channel failure does NOT block others.
```

### 排程

```
Schedule → BullMQ schedulerQueue (delay = scheduledAt - now)
    │
    ├─ ≤ 7 days: BullMQ delay + jobId = "post:{id}" (idempotent reschedule)
    ├─ > 7 days: status=SCHEDULED, 5-min cron reconciler picks it up
    └─ 5-min cron: SELECT status='SCHEDULED' AND scheduledAt ≤ NOW()
                   → push to publishQueue
```

---

## 6. 安全机制

| 措施 | 实现 | 覆盖 |
|------|------|------|
| **CORS** | Hono `cors` — dashboard domain + localhost | 所有 API |
| **CSRF** | Hono `csrf` + Auth.js session | POST/PATCH/DELETE |
| **CSP** | Hono `secureHeaders` — script/img/connect 白名单 | 全局 headers |
| **Rate Limit** | Redis counter per workspace per endpoint, 梯度限速 | Auth 5/min, Posts 60/min, AI generate 10/min |
| **Input Validation** | Zod schema per endpoint | 所有 POST/PATCH |
| **Key Encryption** | AES-256-GCM — OAuth token + Model key | 存储层 |
| **SQL Injection** | Prisma 参数化查询 | 所有 DB 操作 |
| **PII Leak** | MCP `contact.get` 永不返回 PII columns | Contact API |

---

## 7. 国际化

- **方案**: next-intl, path prefix (`/zh/content`, `/en/content`)
- **Middleware**: `createMiddleware` + short link pattern exclusion
- **文件**: `messages/zh.json` + `messages/en.json`
- **自动检测**: `Accept-Language` header → locale redirect

---

## 8. 错误与降级

统一错误码体系 (`MODEL_KEY_INVALID`, `MODEL_KEY_QUOTA`, `CHANNEL_AUTH_EXPIRED`, etc.)，三态降级：

| 状态 | UI | 能力保持 |
|------|-----|---------|
| Model key 失效 | 黄色横幅 + AI 按钮灰掉 | 手动编辑/发布照常 |
| Channel OAuth 过期 | 红色圆点 + tooltip | 其他 Channel 正常 |
| Publish 单条失败 | PostCard 红框 + 错误信息 | 队列自动重试 |

---

## 9. 数据库操作

- **本地开发**: `prisma db push`（快速同步）+ `prisma migrate dev`（生成 migration 文件）
- **CI 验证**: `prisma migrate diff` — 确保 schema 与 migrations 一致，不对生产 DB 操作
- **生产执行**: 手动 `prisma migrate deploy`（Phase 1 无 CD）
- **种子数据**: `prisma db seed` — 三条 Channel 记录预设（twitter, linkedin, instagram）
- **本地环境**: Docker Compose（pgvector:pg17 + redis:7-alpine）
