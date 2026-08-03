## Review

plan.md/progress.md don't exist at the stated paths (root, and nowhere in repo) — reviewed the staged diff against the fixed point and the standards directly.

**Correct** (verified)
- §1 schema unchanged: no DB enum additions; `queueState` is transient JSON only (http.ts `enrichQueueStates`).
- §5 core decisions honored: per-channel isolated queues/workers; `shouldUseCron` boundary `> CRON_HORIZON_MS` (queue-domain.ts:20) matches "≤7d delay / >7d cron" and is boundary-tested; 5-min reconciler (`RECONCILER_EVERY_MS`); idempotent jobIds (remove-then-add in `schedule`, publish dedupe via `publishJobId`); `PermanentPublishError` skips retries; domain helpers (`markVariantFailed`, PublishState) reused from `domain/post.ts`.
- `pnpm typecheck` passes; full suite 76/76 passes incl. real-Redis queue tests; CI/docker/README/env updated for Redis.

**Documented-standard breaches** (hard)
1. Spec §5 "3 retries with backoff 30s/2m/8m" vs `default jobOptions { attempts: 3, backoffMs: 30_000 }` (queue.ts:51): attempts=3 gives **2** retries at 30s/60s (BullMQ exponential `2^(n-1)·delay`, verified backoffs.js). Both count and delays deviate.
2. Stale delayed job on horizon-crossing reschedule — queue.ts:101 early-returns when >7d **without removing** an existing delayed job (remove only in the ≤7d branch, ~104). Rescheduling ≤7d→>7d fires the post at the old time.
3. Connection leak — `schedulerJobProcessor` (queue.ts:211) and `runScheduleReconciler` (233) build a fresh `createPublisher` per call; `queueFor` (61-65) opens a new `Queue`+IORedis per channel, cached only per publisher instance, and `Publisher` has no close path. Leaks scale with every scheduled publish; tests leak too (publisher queues never closed after `workers.close()`).

**Baseline smells** (judgement calls)
- Mysterious Name + Speculative Generality: `DAY_MS_QUEUE` (queue-domain.ts:5) exported, never imported.
- Duplicated Code: identical ready-variant filter at queue.ts:202-205 and 238-241; validation→`markVariantFailed` shape at posts.ts:164-170 vs 250-256.
- Unit-confusion/duplicated constant: `removeOnFail: { age: 86_400 }` (seconds, queue.ts:89/114) vs `86_400_000` (ms, queue-domain.ts:5); test re-declares `const DAY` (queue.test.ts:20).
- Redundant `jobId` in the enqueue item (queue.ts:76) — only `opts.jobId` (82) is used.

**Note**
- Sync-fake drift (api.test.ts): no retries (transient → immediate FAILED vs 3 attempts), no-op schedule/cancel, null queueState — documented in-comment; residual risk.
- N+1: `enrichQueueStates` does per-variant Prisma+Redis round trips on every list/calendar fetch.
- `upsertJobScheduler` is fire-and-forget (queue.ts:279) — unhandled rejection if Redis is down at boot.
- `attemptsMade < (opts.attempts ?? 3)` guard (queue.ts:253) is correct ('failed' fires per attempt, verified bullmq worker.js:635); the `?? 3` fallback mismatches BullMQ's default 1 — latent only.