# Task for reviewer

[Read from: /Users/nicholasl/Documents/build-whatever/SpellPaw/plan.md, /Users/nicholasl/Documents/build-whatever/SpellPaw/progress.md]

You are the SPEC axis of a code review for the SpellPaw M2 milestone (BullMQ queue + scheduling) — staged changes on top of commit 60f3eba.

Fixed point: commit 60f3eba. Diff command (run from /Users/nicholasl/Documents/build-whatever/SpellPaw):
  git diff 60f3eba --cached -- . ':(exclude)pnpm-lock.yaml'

Spec sources — read in the repo:
1. docs/design/spellpaw-phase1-implementation.md §5 (异步流程): short-link click flow (M4, out of scope); 发布队列: BullMQ publishQueue, TwitterWorker/LinkedInWorker/InstagramWorker isolated, 3 retries with backoff 30s/2m/8m, status flow Queued → Posting → Published / Failed, one channel failure NOT blocking others; 排程: ≤7 天 BullMQ delay + jobId = "post:{id}" idempotent reschedule, >7 天 status=SCHEDULED + 5-min cron reconciler (SELECT status='SCHEDULED' AND scheduledAt ≤ NOW() → push to publishQueue).
2. docs/design/spellpaw-prd-phase1.md M2 milestone: 多 Channel Composer + Variant 管理、完全体 Calendar、Scheduler + Queue 完整链路.
3. Implementation spec §1: PublishState enum = DRAFT | PUBLISHED | FAILED — queue state must NOT be added to the DB schema; §8: Publish 单条失败 → PostCard 红框 + 错误信息, queue auto-retry.

Known intentional deviations already documented in code (do NOT re-flag as new findings, but do verify they are actually documented): (a) per-channel publish queues (publish-<slug>) instead of one shared publishQueue — BullMQ v6 job routing; (b) backoff is exponential 30s base instead of exact 30s/2m/8m ladder; (c) instrumentation.ts starts workers in the Next.js process.

Brief: Report (a) requirements the spec asked for that are missing or partial within M2 scope (quote the spec line); (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong (quote spec line + explain mismatch). Pay attention to: the ≤7d/>7d boundary handling, idempotent reschedule (jobId replace semantics), cancel behavior, reconciler query semantics, retry/backoff configuration reachable in prod, worker failure handling vs permanent errors, 202/queue-state API surface, and whether queue state ever leaks into the DB. Under 400 words.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```