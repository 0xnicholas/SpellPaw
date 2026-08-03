## Review

**Correct**
- The fix is sound: `enqueuePublish` now removes the old job before re-adding (`src/server/queue.ts:118-120`), mirroring `schedule()`'s drop-then-add rule. I verified BullMQ v6 `Queue.remove` is idempotent/no-throw on missing jobs (`node_modules/bullmq/dist/esm/classes/queue.js` → `backend.remove(jobId)`, returns a code). This honors the M2 design decision (commit 507eab5): *"FAILED variants stay retryable via explicit publish; the auto-pipeline (scheduler job + reconciler) only pushes DRAFT variants"*.
- Auto-pipeline untouched: `autoPublishableVariantIds` still filters `publishState === "DRAFT"` only (`src/server/queue.ts:196-203`); the reconciler test "never re-enqueues permanently FAILED variants" still passes. No regression to ADR 0009 (no redirect/click-touch changes) or the docs/api.md contract (still 202 `{queued, postId}`).
- `markVariantPublished` clearing `errorMessage` is consistent: PostList shows it only in the FAILED branch (`PostList.tsx:129-131`); MCP `post.performance` returns the DB value. Nothing promises errorMessage persists post-success.
- `externalId` write-through matches the pre-existing `PublishResult.externalId` contract (`src/adapters/channels/types.ts`); mock + twitter adapters both return it. Migration exists (`prisma/migrations/20260803135758_postvariant_external_id/migration.sql`).

**(a) Spec:** no violations. §5 "3 retries with backoff 30s/2m/8m" (worker retries) and §8 "Publish 单条失败 … 队列自动重试" remain honored at the transient level; the M2 commit records the intentional deviation that permanent FAILED waits for explicit user action — the fix follows that.
**(b) Scope creep:** `externalId` is additive beyond the retry bug, but small and justified — the contract already required it and the value was previously discarded. No consumer needs it yet; acceptable.
**(c) Looks-implemented-but-wrong:** none found.

**Note:** nothing is staged — the diff exists only in the working tree, and the migration dir is untracked. Parent must `git add`. Also a leftover `console.log` debug line in `tests/integration/queue.test.ts:345`.