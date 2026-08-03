## Review

**Correct (verified)**
- ≤7d/>7d boundary matches spec exactly: `shouldUseCron` uses `delay > CRON_HORIZON_MS` (queue-domain.ts:19-20); horizon test asserts delay-path at exactly 7d, cron-path at +8d.
- Reconciler query = `status='SCHEDULED' AND scheduledAt ≤ NOW()` (queue.ts:224-226) → push to publish queues, per spec §5.
- Idempotent reschedule within ≤7d: remove-then-add with stable `schedule-{postId}` (queue.ts:106-116); test proves delay moves 60s→90s.
- Queue state never leaks into DB: schema untouched, `PublishState` = DRAFT|PUBLISHED|FAILED, `PostStatus` = DRAFT|SCHEDULED|PUBLISHED (prisma/schema.prisma:21-23,15-17).
- 202 + `{queued, postId}`; queue state surfaced via existing GETs. Permanent failures (`PermanentPublishError`) skip retry and are marked FAILED; transient exhausted-attempts → FAILED via worker `failed` handler. Retry config (attempts 3, exponential 30s base) reachable in prod via defaults in route.ts/instrumentation.ts.
- `pnpm test`: 76/76 passed (incl. real-Redis queue suite); all 3 deviations documented (a,c in code comments; b in README.md — queue.ts:87 has no comment, minor).

**Blocker — stale delayed job on reschedule from ≤7d to >7d** (src/server/queue.ts:98-101)
Spec §5: `jobId = "post:{id}" (idempotent reschedule)`. When a scheduled post is moved beyond the 7-day horizon, `schedule()` returns early *without* removing the already-armed delayed job. That job still fires at the old time; `schedulerJobProcessor` (queue.ts:206-211) only checks `status === "SCHEDULED"`, which is still true after reschedule → the post publishes days early. No test covers this direction.

**Medium — reconciler re-enqueues permanently-FAILED variants forever** (queue.ts:207-208, 229-230)
Ready-filter is `publishState !== "PUBLISHED"`, so FAILED variants qualify. An overdue SCHEDULED post whose variants fail permanently stays `status=SCHEDULED` (settlePost leaves it unchanged), so every 5 min a fresh failing job is spawned and `errorMessage` rewritten. Conflicts with §1/§8 terminal-FAILED semantics ("Publish 单条失败 → PostCard 红框 + 错误信息").

**Notes**
- queue.ts:176-181: retry-backoff state ("delayed") maps to UI label "scheduled"/"delayed", not "posting".
- http.ts:96-104: sequential Redis `getJob` per variant — 50-post calendar ≈ 150 roundtrips, risking PRD's ≤300ms budget.
- Missing/partial M2: FR-018 drag-to-reschedule (README lists as "M2 尾项"); FR-024 "(X: 1/2)" per-post progress counter absent. No real scope creep found.