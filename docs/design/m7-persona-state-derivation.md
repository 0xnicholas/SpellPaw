# M7 设计：Persona / State 真推导

**日期**: 2026-08-04
**状态**: 已评审（grilling 共识达成 2026-08-04），文档已据此更新；M7-A 可开工
**来源**: [概念设计 §5 状态机 + 预计算层](./2026-07-31-spellpaw-concept.md) · [ADR-0003 双路径预计算](../adr/0003-graph-precomputation-dual-path.md) · [ADR-0012 产品定位](../adr/0012-product-positioning-and-roadmap.md)
**关联**: [Phase 1 实现规范 §1](./spellpaw-phase1-implementation.md) · [术语表 Persona/State](../../CONTEXT.md) · [ADR-0015 决策记录](../adr/0015-persona-state-real-derivation.md)

---

## 1. 背景与目标

ADR-0012 把产品核心价值锁定为 **customer lifecycle intelligence**——Customer Graph + AI 洞察（Persona/State）**就是产品本身**。但代码实证显示，这部分目前是**规则桩**：

- **State**（`src/server/interactions.ts:recomputeContactState`）只实现 AWARE→ENGAGED 与手动 ACTIVATED；LOYAL / AT_RISK / CHURNED 注释原话 *"No signals yet"*；`stateRiskScore` / `stateOpportunityScore` 从未写入（恒为 null）。
- **Persona** 只写了 `personaContentDNA` 的规则计数（actionCounts / distinctPosts），`personaSentimentArc`、`personaIntentVector` 恒为 null。

**M7 目标**：把 Persona/State 从桩升级为真推导，让 `/api/contacts` 与 MCP contact 工具返回**有产品价值的** Persona + State。

**非目标**：身份合并、外部系统集成（CRM 只读）、相似客户聚类（lookalike）、付费墙——均属 M6+ 反馈驱动后续。

---

## 2. 架构定位：落在 ADR-0003 双路径上（不另造机制）

ADR-0003 已确立预计算双路径，M7 **直接复用**，不引入新触发范式：

| 路径 | 延迟 | 触发 | 内容 | M7 归属 |
|------|------|------|------|---------|
| **增量路径** | < 3s | 事件（click / inbound） | Contact.type 翻转、**State 规则重算**（便宜 SQL）、标记 dirty | M7-A |
| **批处理路径** | 每小时（可调） | dirty-flag 扫描 | **Persona AI 推导**（Content DNA / Sentiment Arc / Intent） | M7-C |

> **修正**：最初提议的"每日重算所有活跃 Contact"被废弃——改为 ADR-0003 的 **dirty-flag + 批处理**。只推导"自上次推导后有新 Interaction"的 Contact，效率更高且与既有决策一致。批处理 cadence 由 `PERSONA_BATCH_CRON` 配置（默认 `0 * * * *` 每小时，与 ADR-0003 一致；低量 Phase 1 可调为每日）。

State 与 Persona 分离的关键理由：**State 规则便宜且需实时（Inbox 打开对话时要立刻看到阶段/风险分），Persona 推导昂贵（LLM 调用）绝不能进每次点击的内联路径。**

---

## 3. 阶段拆解（M7-A → D，带依赖）

| 阶段 | 内容 | 依赖 | 可独立交付 |
|------|------|------|-----------|
| **M7-A** | State 状态机补全（LOYAL/AT_RISK/CHURNED + Risk/Opportunity 分 + 每日衰减 cron） | 无 | ✅ 纯规则，Mock 数据可测 |
| **M7-B** | AI 通用完成原语 `complete()`（system/user/json），Composer 复用 | 无 | ✅ 小重构，回归测试保行为 |
| **M7-C** | Persona 推导**管道**（dirty-flag 批处理队列 + `complete()` + 降级）——**只搭 plumbing，对 mock 验证；推导质量待 X 真实数据校验** | M7-B | ✅ 管道可建；真实外发受门禁（§4.3） |
| **M7-D** | State←Persona 耦合 + **Persona UI 暴露** + 回归 | M7-C | ⏸ **整体推迟到 X 真实数据落地**（见下） |

> **排期决议（grilling Q1）**：Persona 依赖真实交互数据才有意义，而现在全部数据为 Mock（X 真实接入卡在开发者审核）。State 规则对任何数据都成立。故 M7-A/B 现在做；M7-C 只搭管道、不宣称推导质量；**M7-D（耦合 + Persona 暴露到 UI）推迟**——避免展示未经真实数据校验的"假洞察"。M7-D 的耦合**逻辑**可随 M7-C 写好，但不接 UI、不对外宣称有效。

---

## 4. 数据模型变更

M7 增量改动（grilling 后重算）：**2 个 Contact nullable 列 + 1 个 Workspace 门禁字段**，向后兼容（无破坏性迁移）：

```prisma
model Workspace {
  // 【新增·grilling Q5】Persona 推导门禁——默认 false：批处理不外发客户内容。
  // 镜像 ADR-0014 的 mcpInboxAccess 范式（默认关、按域独立）。详见 §4.3。
  personaDerivationEnabled Boolean @default(false)
}

model Contact {
  // —— 既有，M7 开始真正写入 ——
  personaContentDNA   Json?    // 升级：从计数 → 真 Content DNA
  personaSentimentArc Json?    // M7-C 写入
  personaIntent       Json?    // 【新增】可读 intent（category/confidence/evidence）
  personaIntentVector Float[]  // 既有 DOUBLE PRECISION[]；pgvector 化【推迟，见 §4.2】
  stateRiskScore        Int?   // M7-A 写入
  stateOpportunityScore Int?   // M7-A 写入

  // —— 【新增】批处理 dirty flag ——
  personaDirtyAt DateTime?     // 增量写入置位；批处理推导后清空

  @@index([personaDirtyAt])    // 批处理扫描用
}
```

### 4.1 Intent 可读化：新增 `personaIntent Json?`

概念设计把 Intent 定为"向量（探索/购买/投诉/流失）"，但向量只服务于**相似检索/聚类**——Phase 1 **没有这类消费者**（Inbox 展示单客户 Persona，不做"找相似客户"）。因此：

- **新增 `personaIntent Json?`** 存可读结构：`{ category, confidence, evidence[], derivedAt }`，供 UI/MCP 直接展示。
- `personaIntentVector` 暂留作未来相似检索槽位，M7 不写入。

### 4.2 pgvector 推迟（重要发现）

迁移实证：`personaIntentVector` 现为 `DOUBLE PRECISION[]`（普通数组），**`CREATE EXTENSION vector` 从未执行**。要做真 embedding 相似检索需：启用扩展 + 列类型迁移为 `vector(1536)` + 绑定 OpenAI embeddings（Anthropic 无 embeddings API）。

**决策**：M7 **不启用 pgvector**。理由——无相似检索消费者，启用即耦合 OpenAI embeddings 且引入列类型迁移风险，违背"反馈驱动、增量交付"。升级路径记录于 §14。`personaIntent`（可读）先行交付价值。

### 4.3 Persona 推导的内容外发门禁（grilling Q5）

> **此节修正了 v1 设计稿 §8.3 的偷懒**：原稿把"输出经 `NON_PII_SELECT` 暴露"当成解决了 PII，但**外发给 LLM 的内容**是另一条路径——客户在 DM 里写的邮箱/个人细节会原样发去 OpenAI/Anthropic，`NON_PII_SELECT` 完全不管外发。这与 Composer 改写（发用户**自己**的 Post 文本）**不同**：客户消息是第三方内容，用户未必有授权外发。

**决策**：新增 `Workspace.personaDerivationEnabled`（**默认 false**），镜像 ADR-0014 的 `mcpInboxAccess` 范式（默认关、按域独立、不复用既有门禁）。Persona 批处理 Worker（§8.2）在调 LLM **前**检查此门禁：

- **关（默认）**：不外发任何客户内容；不推导；dirty 保留（等开启）。M7-C 管道的单元测试用 mock/synthetic 内容不受门禁限制（合成内容无 PII）。
- **开（用户显式）**：方可取 BYOK key、读 `contact_timeline` 内容、调 `complete()` 推导。

**为何不用正则清洗后外发**：ADR-0014 原话已否定——*"content redaction is fragile (regex-based cleaning misses)"*。门禁优于清洗。

**为何不复用 BYOK 默认同意**：BYOK（用户自配 key）确实隐含"接受向该 provider 发数据"，但 Composer 发的是用户自有内容；Persona 发的是客户内容——类别不同，需独立显式同意。此决策记入 ADR-0015。

---

## 5. State 状态机——完整规则

### 5.1 状态转移表（Phase 1 实现版）

| Stage | 进入条件 | 退出条件 | Phase-1 简化 |
|-------|---------|---------|-------------|
| **AWARE** | 首次 Content Touch（创建即默认） | ≥3 Touch OR ≥1 Conversation（30d）→ ENGAGED | — |
| **ENGAGED** | 达 AWARE 退出条件 | 产品使用证据 → ACTIVATED | — |
| **ACTIVATED** | ① 手动（既有）② Event 注册/订阅 ③ Conversation 表达购买意图（M7-D） | 连续 3 月正面 Interaction → LOYAL；静默 → AT_RISK | M7-A：仅①②；③留 M7-D |
| **LOYAL** | ACTIVATED 且最近 3 个自然月每月都有 Interaction | 30d 无 Interaction 或负面 sentiment → AT_RISK | "正面"= 有 Interaction 即可；sentiment 升级 M7-D |
| **AT_RISK** | 30d 无 Interaction（或负面信号，M7-D） | 重新活跃 → 回 ENGAGED/ACTIVATED（前向重算） | M7-A：仅静默条件 |
| **CHURNED** | AT_RISK 持续 90d 无恢复 | 重新活跃 → AWARE | — |

### 5.2 关键语义澄清（grilling Q2 已锁定，见 ADR-0015）

**"ACTIVATED sticky" 的精确含义**——当前代码注释 *"manual activation must never be downgraded"* 易被误解为"激活后永不变动"。实际语义：

- **激活单向棘轮**：一旦 ACTIVATED（任何方式），engagement 下降**不会**把它降回 ENGAGED/AWARE。只有**风险衰减**能下移（→ AT_RISK → CHURNED）。
- **LOYAL 非棘轮**：LOYAL 在 30d 静默或负面 sentiment 时降为 AT_RISK。
- **AT_RISK 恢复 = 前向重算**：恢复时不记忆"风险前阶段"，而是用当前信号从 ACTIVATED 基线前向重算（仍满足激活则回 ACTIVATED，否则 ENGAGED）。避免额外存储"上一阶段"。
- **CHURNED 恢复 → AWARE**：术语表明确规定，任意 Interaction 触发显式回 AWARE（重新开始旅程）。
- **LOYAL 的"正面"代理（grilling Q4 已锁定）**：Phase 1 无 sentiment 字段，LOYAL 用"连续 3 自然月每月有 Interaction"代理"正面 Interaction"（持续在场本身是真实忠诚信号）。**纠错回路**：M7-D sentiment 接入后，`personaSentimentArc.trend === "declining"` 可把误判的 LOYAL 拉回 AT_RISK。LOYAL 是规则（非 AI 输出），故不适用 Q1 的"未验证 AI 洞察不展示"逻辑。

### 5.3 重算函数伪代码（M7-A，`recomputeContactState` 扩展）

```ts
// 输入：contact 当前数据 + 最近 30d/365d 的 touch/conversation 计数 + lastInteractionAt
// 输出：{ stage, riskScore, opportunityScore }
function computeState(...) {
  // 1) engagement 基线（既有）
  const engaged = touches30d >= 3 || conv30d >= 1;
  let base = manualActivated ? ACTIVATED : engaged ? ENGAGED : AWARE;

  // 2) 前向晋升：ACTIVATED → LOYAL（loyal 仅在已激活时评估）
  if (base === ACTIVATED && loyalMet(3 个自然月每月有 Interaction)) base = LOYAL;

  // 3) 风险衰减（时间驱动，需 lastInteractionAt）
  const d = daysSince(lastInteractionAt);
  if (wasAtRisk && d >= CHURNED_DAYS)      base = CHURNED;
  else if (d >= AT_RISK_DAYS && base !== AWARE) base = AT_RISK;  // ACTIVATED/LOYAL/ENGAGED 可降
  //   ↑ ACTIVATED 可降到 AT_RISK（风险衰减），但不会因 engagement 降到 ENGAGED

  // 4) 评分（§6）
  const risk = computeRiskScore(base, d, volume365d);
  const opp  = computeOpportunityScore(base, d, volume30d);

  return { stage: base, riskScore: risk, opportunityScore: opp };
}
```

> 注：`wasAtRisk` 由"当前 stage 已是 AT_RISK"判定（无需额外字段）。恢复（有新 Interaction）时 d 变小，自动脱离 AT_RISK 分支走前向重算。

---

## 6. Risk / Opportunity 评分公式

**设计原则（grilling Q3 已锁定）**：Phase 1 用**透明、可解释、env 可调、刻意未校准**的启发式公式。关键定位——评分是"**原始信号之上的便利默认层**"，**不是经验真理的声明**：

- **同时暴露原始信号**（stage、距上次互动天数、30d/365d 互动量、时间线）——MCP/API 用户（主用户，AI-native builders）可无视启发式分、用自己的 agent 推理。
- **UI 用 band**（Low/Med/High，从分数派生）而非裸 0–100，避免假精度误导次要用户（micro-SMB）。
- 所有权重/阈值 env 可调（§13），为真实数据校准而设计；转为学习型模型需新 ADR（§14）。

分数 0–100 整数，公式如下：

### 6.1 Risk Score（流失概率）

```
base(stage):   AWARE=20  ENGAGED=15  ACTIVATED=25  LOYAL=10  AT_RISK=80  CHURNED=98
silencePenalty = clamp( daysSinceLastInteraction / CHURNED_DAYS * 60, 0, 60 )
engagementDiscount = clamp( totalInteractions365d / 10 * 5, 0, 20 )   # 历史深度降权
risk = clamp( round(base + silencePenalty - engagementDiscount), 0, 100 )
```

### 6.2 Opportunity Score（升级/增购可能）

```
base(stage):   AWARE=5  ENGAGED=25  ACTIVATED=60  LOYAL=80  AT_RISK=10  CHURNED=2
recencyBonus = clamp( (30 - daysSinceLastInteraction) / 30 * 15, 0, 15 )   # 近期活跃加成
volumeBonus   = clamp( (touches30d + conv30d) / 10 * 10, 0, 15 )
intentBonus   = 0   # M7-D：读 personaIntent.category=="buy" → +20
opp = clamp( round(base + recencyBonus + volumeBonus + intentBonus), 0, 100 )
```

> 所有权重/阈值通过 env 暴露（§13），调参不动代码。

---

## 7. 增量路径：State 重算 + 每日衰减 cron

### 7.1 事件触发的同步重算（既有，扩展）

`recomputeContactState` 在 `applyClick` / `recordInboundMessage` / `manuallyActivateContact` 内联调用，事务内更新 stage + 两个分数。**同时置 `personaDirtyAt = now()`**（为批处理铺路，M7-C 用）。State 规则全 SQL 计数，单次 < 数十 ms，可接受。

### 7.2 每日衰减 cron（时间驱动，新增）

静默衰减（AWARE→…→AT_RISK→CHURNED）是**时间驱动**，不靠事件触发——失联客户不会有事件。复用 BullMQ repeatable + reconciler 模式（同 `queue.ts` 的 5 分钟 scheduler reconciler）：

- 队列 `state-decay`，repeatable job，cadence `STATE_DECAY_CRON`（默认每日 `0 3 * * *`，低峰）。
- 每轮扫描：`updatedAt < now - AT_RISK_DAYS` 的 Contact，按 `@@index([workspaceId, updatedAt])` 取最近 N 批（`STATE_DECAY_BATCH`，默认 500），批量重算 State。
- 写回 stage + 分数；不触碰 Persona。

---

## 8. 批处理路径：Persona AI 推导（M7-C）

### 8.1 dirty-flag 机制

- 增量路径每次写 Interaction → `personaDirtyAt = now()`（§7.1）。
- 批处理 job 扫描 `personaDirtyAt IS NOT NULL ORDER BY personaDirtyAt LIMIT N`（`PERSONA_BATCH_SIZE`，默认 50），逐个推导，成功后 `personaDirtyAt = null`。

### 8.2 触发与队列

- 队列 `persona-derive`，repeatable job，cadence `PERSONA_BATCH_CRON`（默认每小时 `0 * * * *`，对齐 ADR-0003）。
- Worker 对每个 dirty Contact：**先检查 `Workspace.personaDerivationEnabled`（§4.3）**——关则跳过（不外发内容、不清 dirty）；开则取 workspace 的 BYOK ModelProviderKey（`decryptString`）→ 调 `complete()` 推导三项 → 写回 → 清 dirty。

### 8.3 数据源

`contact_timeline` VIEW（已合并 ContentTouch/Conversation/Event），取最近 365 天。

**PII 边界（grilling Q5 已修正，两条风险分清）**：

- **(a) 对外暴露**：推导**输出**只经 `NON_PII_SELECT` 暴露（不含 `profile_*`）——Persona 是"对 Contact 的统计抽象，不含原始 PII"（术语表）。✅ 已覆盖。
- **(b) 内容外发给 LLM**：推导**读取** Conversation/Post 正文并发给 BYOK provider——这是 `NON_PII_SELECT` **不管**的路径，客户消息可能含 PII（如 DM 里写的邮箱）。由 §4.3 的 `personaDerivationEnabled` 门禁（默认关）控制——**关时不读取、不外发**。

即：Persona 推导域可触达内容，但触达受显式门禁约束，与 ADR-0014"门禁优于清洗"精神一致。

### 8.4 三项推导

**数据准备**（喂给 LLM 的压缩摘要，非 raw 全量——控 token）：
- `touchedPosts`：被 touch 的 Post 正文 + action（LIKE/SHARE 权重高于 CLICK）+ 来源 channel。
- `conversations`：按时间分桶的 Conversation 正文（每桶取代表性消息）。

**① personaContentDNA**（JSON）：
```jsonc
{
  "topics": [{ "label": "developer tools", "weight": 0.6 }],
  "channelAffinity": { "twitter": 0.8, "linkedin": 0.2 },
  "toneAffinity": ["technical", "concise"],
  "derivedAt": "ISO"
}
```
*Phase-1 简化*：按 Contact 自身 touch 集做**相对权重**归一化；ADR-0003 所述"跨 Contact 全局对比"推迟（§14）。

**② personaSentimentArc**（JSON）：
```jsonc
{
  "points": [{ "ts": "ISO", "score": -0.3, "label": "frustrated" }],
  "trend": "declining",            // improving | stable | declining
  "currentScore": -0.3,            // -1..1
  "derivedAt": "ISO"
}
```
按时间桶压缩（每桶一条），趋势由首末分比较。

**③ personaIntent**（JSON，§4.1 新字段）：
```jsonc
{
  "category": "buy",               // explore | engage | buy | complaint | churn | dormant
  "confidence": 0.8,               // 0..1
  "evidence": ["asked pricing", "2 purchases in events"],
  "derivedAt": "ISO"
}
```

### 8.5 Prompt 策略

单次 LLM 调用产出全部三项（控成本、控延迟），`complete({ json: true })` 要求结构化 JSON。system prompt 固定 Persona 推导角色 + JSON schema；user prompt 注入压缩摘要。JSON 解析做防御（去 markdown 包裹、截断到首个完整 JSON）。

---

## 9. AI 通用完成原语（M7-B）

`src/lib/ai/providers.ts` 现有 `generateContent` 硬编码 Composer 改写 prompt。抽出底层：

```ts
export interface CompleteOptions {
  provider: AiProvider;
  apiKey: string;
  system: string;
  user: string;
  json?: boolean;           // 要求结构化 JSON 输出
  model?: string;           // 覆盖默认模型
  timeoutMs?: number;       // 默认 30000
}
export async function complete(opts: CompleteOptions): Promise<string>;
```

- OpenAI：`json:true` → `response_format: { type: "json_object" }`。
- Anthropic：无原生 JSON mode → system 追加 "respond with valid JSON only, no prose"；输出做宽松解析。
- `generateContent` 改为 `complete()` 的薄封装（保持 Composer 行为，回归 `providers.test.ts`）。
- 错误分类、超时、key preview 不变。

---

## 10. State ← Persona 耦合（M7-D）

State 仍**不调 LLM**，只读最新已推导的 Persona 列：

- **AT_RISK 升级**：除 30d 静默外，`personaSentimentArc.trend === "declining" && currentScore <= SENTIMENT_RISK_THRESHOLD`（默认 -0.3）→ AT_RISK。
- **Opportunity Score**：`personaIntent.category === "buy" && confidence >= 0.6` → intentBonus = 20。
- **ACTIVATED 自动**：`personaIntent.category === "buy" && confidence >= 0.8` 可作为激活证据③（M7-A 留的口子）。

耦合在批处理推导**之后**的轻量 State 重算中应用（同一 job 内，写完 Persona 立即重算一次 State）。

---

## 11. 降级矩阵（无密钥 / AI 失败 / 无数据 也绝不阻塞读路径）

| 情况 | State | Persona |
|------|-------|---------|
| 无 BYOK 密钥 | 正常（纯规则） | 写**规则降级值**（Content DNA=既有计数、Sentiment=null、Intent=`{category:"dormant"}`），清 dirty（不无限重试） |
| AI 调用失败/超时 | 正常 | 保留旧 Persona，**不清 dirty**（下次批处理重试，指数退避由 BullMQ attempts） |
| 无任何 Interaction | AWARE/risk=20 | 不推导（dirty 永不置位） |
| **门禁关 `personaDerivationEnabled=false`**（默认） | 正常 | **不读取内容、不外发、不推导**；dirty 保留待开启（§4.3） |
| 读路径（contact.get） | 始终返回当前值 | 始终返回当前值（可能为规则降级或旧值；门禁关时为既有/空） |

读路径零阻塞——Persona 永远是异步后台填充。

---

## 12. 暴露（REST / MCP / UI）

- **REST**：`/api/contacts`（list/get）已走 `NON_PII_SELECT`——确认三 Persona 列 + `stateRiskScore`/`stateOpportunityScore` + 新 `personaIntent` 正确返回；`stage` 过滤已支持全部 6 阶段。`/:id/timeline` 不变。
- **MCP**（`src/server/mcp/server.ts`）：`contact.get` / `contact.insights` 经同一 `NON_PII_SELECT`——同样自动覆盖。确认 tool 描述更新。
- **UI**（Inbox 三列侧栏）：展示当前 **stage** + Risk/Opportunity **band（Low/Med/High，grilling Q3）** + 原始信号（距上次互动天数、互动量）。
  - **Persona 摘要（top topics / sentiment / intent）属 M7-D，整体推迟**（grilling Q1）——在 X 真实数据落地、推导质量校验前不在 UI 暴露，避免展示未验证洞察。

---

## 13. 配置（env，与 free-plan 护栏模式一致）

| Env | 默认 | 说明 |
|-----|------|------|
| `LOYAL_MONTHS` | 3 | LOYAL 连续月数 |
| `AT_RISK_DAYS` | 30 | 静默触发 AT_RISK |
| `CHURNED_DAYS` | 90 | AT_RISK 转 CHURNED |
| `STATE_DECAY_CRON` | `0 3 * * *` | 每日衰减 cron |
| `STATE_DECAY_BATCH` | 500 | 每轮扫描上限 |
| `PERSONA_BATCH_CRON` | `0 * * * *` | Persona 批处理（每小时） |
| `PERSONA_BATCH_SIZE` | 50 | 每次 dirty 扫描上限 |
| `SENTIMENT_RISK_THRESHOLD` | -0.3 | AT_RISK 的 sentiment 阈值 |
| `PERSONA_INTENT_BUY_BONUS` | 20 | Opportunity 的 intent 加成 |

---

## 14. 已记录的简化与升级路径

| 简化 | 升级路径 |
|------|---------|
| Content DNA 按 Contact 自身归一化（非跨 Contact 全局对比） | 批处理引入 workspace 级 topic 分布做 z-score 归一化 |
| Intent 只存可读 JSON，pgvector 未启用 | 出现相似检索/聚类需求时：`CREATE EXTENSION vector` + 列迁移 `vector(1536)` + OpenAI embeddings，`personaIntentVector` 正式启用 |
| LOYAL "正面"= 有 Interaction | M7-D 接入 sentiment 后，LOYAL 要求每月 sentiment ≥ 阈值 |
| 评分公式透明启发式 | 有真实数据后可引入学习型模型（需 ADR） |

---

## 15. 测试策略

- **M7-A**：单测 `computeState` 各流转（含棘轮语义、恢复前向重算、CHURNED→AWARE）；集成测每日 cron 触发衰减；阈值 env 生效。
- **M7-B**：回归 `providers.test.ts`（Composer 行为不变）；新测 `complete({json:true})` 两 provider 的解析与降级。
- **M7-C**：mock `complete()` 注入确定性 JSON；验证三列写回 + dirty 清除；无密钥→规则降级；AI 失败→保留旧值、不清 dirty。
- **M7-D**：耦合后 AT_RISK/Opportunity 升级；PII 契约（输出经 `NON_PII_SELECT` 不含 `profile_*`）；E2E Inbox 侧栏展示。
- 全量 `pnpm test` 绿；`pnpm typecheck` / `pnpm lint` 绿。

---

## 16. 评审决议（grilling 共识，2026-08-04）

| 项 | 决议 |
|----|------|
| **Q1 排期** | M7-A/B 现在做；M7-C 只搭管道对 mock 验 plumbing；**M7-D 推迟到 X 真实数据**（§3） |
| **Q2 激活棘轮** | ACTIVATED 抗 engagement 降级，但**受风险衰减→可到 CHURNED**（§5.2） |
| **Q3 评分归属** | 启发式 0–100 + 原始信号都交；UI 用 band；评分是"便利默认层"非经验真理（§6） |
| **Q4 LOYAL 代理** | 现在用"在场"代理"正面"，有 sentiment 纠错回路（§5.2） |
| **Q5 PII 外发门禁** | 新增 `personaDerivationEnabled`（默认关），镜像 ADR-0014（§4.3） |

共识达成，进入 **M7-A**（`todo #1`）实现。
