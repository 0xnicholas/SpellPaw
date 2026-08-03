## Review

**Correct (with evidence):** The BullMQ v6 behavior claim is verified in source: `addStandardJob-9.lua` → `handleDuplicatedJob` returns the existing jobId without re-enqueueing ("silently ignores"); `removeJob-2.lua` returns 1 for unlocked jobs (removed from all state sets), 0 for locked/active (no throw), and never throws for missing jobs. So remove-then-add (`src/server/queue.ts:117-121`) is safe in every state, aligns with the schedule() "drop-then-add" rule (queue.ts:126-134), and the `publishJobId` comment in queue-domain.ts now matches real behavior. `posts.ts:238` writes PUBLISHED+publishedAt+errorMessage+externalId in one atomic Prisma update — no partial state if it throws. `markVariantPublished` errorMessage:null is safe for all consumers (PostList.tsx:130 uses `v.errorMessage ?? "failed"`; mcp/server.ts:317 passes nullable through). Migration is correct: nullable TEXT, no backfill, ordered after `20260803133312_x_account_name`; `src/generated` gitignored (`.gitignore:46`). New test faithfully exercises fail→connect→retry→published and passes (15/15 queue suite, 14/14 domain, typecheck clean). Header warning is accurate: dev workers subscribe to the same queue names/Redis and would starve the test worker.

**Fixed:** none needed.

**Blocker:** none.

**Note (judgement):**
1. `queue.ts:117-121` — Duplicated Code, mild: drop-then-add + `job.opts.jobId as string` re-encodes `schedule()`; `publishJobId(v.id)` computed twice.
2. `queue.test.ts:455-467` — narrow flake window: `remove()` returns 0 if the FAILED job is still active (~ms after the DB write) → add ignored → waitFor(10s) timeout. Rare but possible.
3. Same race in production: a retry hitting an active permanent-failure job is silently skipped; converges on the next retry.
4. Test bypasses the real `/api/channels/instagram/callback` route — acceptable smoke scope.
5. No leftover debug code (verified no console/debugger/TODO in changed files).

No AGENTS.md/CONTEXT.md vocabulary violations; ADR-0008's "rescheduling replaces" was already documented as deviated in code.