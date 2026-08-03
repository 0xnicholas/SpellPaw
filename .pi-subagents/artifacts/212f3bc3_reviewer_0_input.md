# Task for reviewer

You are the STANDARDS axis of a review for a small bug-fix commit in SpellPaw (smoke-test driven) — working-tree changes on top of 78f0fb9 (nothing staged yet, read `git diff 78f0fb9 -- . ':(exclude)pnpm-lock.yaml'` in /Users/nicholasl/Documents/build-whatever/SpellPaw).

The change fixes a real bug found by a local smoke test: BullMQ v6 silently ignores add() with an existing jobId, so a FAILED variant could never be re-enqueued for retry. Fix = remove-then-add in enqueuePublish (src/server/queue.ts). Also: PostVariant.externalId column (migration postvariant_external_id, src/generated not checked in — generated client lives in src/generated and is gitignored) + write-through of the publish result id (src/server/posts.ts); markVariantPublished now clears errorMessage (src/domain/post.ts); a regression test simulates fail→connect→retry→published (tests/integration/queue.test.ts); a header comment warns not to run queue tests while a dev server is up (its instrumentation workers share the Redis queues and steal jobs, causing timeouts — this was the observed flakiness root cause).

Standards sources: AGENTS.md, docs/agents/*, CONTEXT.md (publish state semantics: FAILED is terminal until explicit retry; Token Refresh term), the queue semantics comments in src/server/queue.ts (schedule 'drop-then-add' rule — does remove-then-add align?), and the fixed smell baseline (Fowler ch.3): Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest.

Scrutinize: queue.ts remove-then-add (remove() returns 0 when a job is locked/being processed — is the subsequent add still safe? is remove() on a never-existing job a no-op?), posts.ts externalId write-through (placement after publish, before markVariantPublished — what if the update throws mid-way; is the variant left in a weird state?), domain/post.ts markVariantPublished errorMessage: null (any UI/MCP consumer that would break on a cleared message?), migration correctness (nullable, no backfill, applies from scratch — check the migration SQL file), the new regression test (does it faithfully exercise fail→connect→retry→published? is the MockAdapter connect dance reasonable given MockAdapter.exchangeCode ignores the verifier?), the header warning comment (accurate? sufficient?), and any leftover debug code.

Brief: per file — (a) documented-standard violations (cite), (b) smells (name + quote), (c) doc/code gaps. Hard vs judgement. Under 300 words.

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