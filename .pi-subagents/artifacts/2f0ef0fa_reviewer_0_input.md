# Task for reviewer

[Read from: /Users/nicholasl/Documents/build-whatever/SpellPaw/plan.md, /Users/nicholasl/Documents/build-whatever/SpellPaw/progress.md]

You are the STANDARDS axis of a review for a small bug-fix commit in SpellPaw (smoke-test driven) — staged changes on top of 78f0fb9.

Fixed point: 78f0fb9. Diff: git diff 78f0fb9 --cached -- . ':(exclude)pnpm-lock.yaml' (run in /Users/nicholasl/Documents/build-whatever/SpellPaw)

The change fixes a real bug found by a local smoke test: BullMQ v6 silently ignores add() with an existing jobId, so a FAILED variant could never be re-enqueued for retry. Fix = remove-then-add in enqueuePublish. Also: PostVariant.externalId column (migration postvariant_external_id) + write-through of the publish result id; markVariantPublished now clears errorMessage; a regression test simulates fail→connect→retry→published; a header comment warns not to run queue tests while a dev server is up (its workers steal jobs).

Standards sources: AGENTS.md, docs/agents/*, CONTEXT.md (Token Refresh, publish state semantics: FAILED is terminal until explicit retry — this fix makes explicit retry actually work), the M2-era queue semantics comments in src/server/queue.ts (schedule 'drop-then-add' rule — does the new remove-then-add align or conflict with cancelSchedule's job cleanup?), and the fixed smell baseline (Fowler ch.3): Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest.

Scrutinize: queue.ts remove-then-add (race with the reconciler enqueueing the same variant concurrently? remove() on a job being processed returns 0 — is the add still safe? does remove() on a never-existing job throw?), posts.ts externalId write-through (placement after publish, before markVariantPublished — atomicity if update fails mid-way), domain/post.ts markVariantPublished errorMessage: null (does any UI rely on errorMessage surviving a republish? does markVariantFailed→markVariantPublished round-trip clear it correctly?), migration correctness (nullable, no backfill), the new regression test (does it prove re-enqueue? is the MockAdapter connect dance in the test faithful to the real OAuth flow?), the header warning comment, and whether the test-suite flakiness root cause (dev workers stealing jobs) is fully documented.

Brief: per-file — (a) documented-standard violations (cite), (b) smells (name + quote), (c) doc/code gaps. Hard vs judgement. Under 300 words.

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