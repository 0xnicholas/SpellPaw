## Review

**Correct (evidence):**
- §1 shapes: `ContentTouch`/`Conversation`/`Event`/`TouchAction`/`ConvDirection`/`EventType` match spec (migration.sql); `contact_timeline` VIEW matches spec's three-branch UNION ALL with identical `payload` jsonb shapes (`prisma/views/contact_timeline.sql`), quoted-camelCase adaptation correct for Prisma-generated tables. Index coverage on (contactId, timestamp)/(postId, timestamp)/(variantId, timestamp) supports the timeline queries.
- §2 routes all present and workspace-scoped (`routes/analytics.ts`, `routes/contacts.ts`). Repeat-viewers SQL `HAVING count(DISTINCT ct."postId") >= 2` matches "≥2 distinct posts" in both `repeatViewerCount` (analytics.ts:126) and insights (contacts.ts:32). All user input bound via `Prisma.sql` tagged params — no injection. recentTouches/insights expose only `contactId`/persona/state/updatedAt, never `profile_*` — no PII leak.
- §5: Redis cache (TTL 24h) + PG fallback + fire-and-forget enqueue before redirect (`route.ts`); `defaultJobOptions` attempts=3 + exponential backoff on the clickQueue producer; clickWorker wired into `instrumentation.ts` → `createWorkers` (queue.ts:323).
- §7: `/zh`,`/en` always-prefixed (routing.ts), middleware matcher excludes `api|s|_next|_vercel` + dotted files, next-intl plugin/request/navigation wired; en.json/zh.json key sets identical (verified programmatically) and zh genuinely translated.
- All 116 tests pass (12 files); new `graph.test.ts` covers link creation, cache fallback, click pipeline, ENGAGED promotion after 2 distinct posts, analytics rollups, idempotent shorten, no-PII.

**Missing/partial (a):**
- Spec §5: "Worker batch INSERT ContentTouch" — `applyClick` does a per-job single-row insert (interactions.ts:44); no batching anywhere. Functionally equivalent at Phase 1 scale, but the literal requirement is unmet.
- Spec §1 "Contact persona/state recomputed on Interaction events" — recompute is wired only for CLICK; Conversation/Event have no writers/recompute. Consistent with deviation (e), but partial.
- ADR "3 retries": `attempts: 3` = 1 initial + 2 retries (semantics ambiguous; 5s base backoff).

**Scope creep (b):**
- `/api/shorten` isn't in §2's route list (necessary for the closed loop — additive, not harmful); analytics dashboard UI (`AnalyticsClient.tsx`) exceeds §2's route-only scope; 2-posts/30d ENGAGED rule is an undeclared spec decision (no spec threshold exists).

**Wrong (c):** none found.

**Residual risk:** the redirect route (cookie set, `resolveVisitor` reuse) is explicitly untested ("smoke-tested via dev server", graph.test.ts comment) — the closed loop's cookie path has no automated coverage; plan.md/progress.md referenced in the task do not exist in repo.