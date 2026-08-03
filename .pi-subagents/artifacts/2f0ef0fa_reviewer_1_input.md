# Task for reviewer

[Read from: /Users/nicholasl/Documents/build-whatever/SpellPaw/plan.md, /Users/nicholasl/Documents/build-whatever/SpellPaw/progress.md]

You are the SPEC axis of a review for a small bug-fix commit in SpellPaw (smoke-test driven) — staged changes on top of 78f0fb9.

Fixed point: 78f0fb9. Diff: git diff 78f0fb9 --cached -- . ':(exclude)pnpm-lock.yaml' (run in /Users/nicholasl/Documents/build-whatever/SpellPaw)

Context: a local smoke run of the full closed loop (mock channels) exposed that a variant marked FAILED (e.g. 'channel not connected' when publishing before connecting) could never be retried: POST /api/posts/:id/publish re-enqueued the same BullMQ jobId, which v6 silently ignores when the job already exists. The fix removes the old job record before re-adding (mirroring the existing schedule() drop-then-add rule). Spec sources to judge against:

1. docs/design/spellpaw-phase1-implementation.md — publish state machine: DRAFT → PUBLISHED / FAILED; FAILED is terminal but the user can explicitly retry (spec §5/§8 wording — find the exact 'retry' language and check the fix honors it).
2. docs/adr/0009 — redirect <30ms and never blocked by interaction writes (this diff touches publish, not redirect — confirm no regression).
3. The M2 design decision '自动管道只推 DRAFT' (auto-pipeline only pushes DRAFT; FAILED waits for explicit user action) — the fix must NOT make the auto-pipeline (scheduler/reconciler) retry FAILED variants.
4. docs/api.md — the publish endpoint contract (POST /api/posts/:id/publish) and whether the response/state semantics stay as documented.

Also judge the new scope: PostVariant.externalId (platform-side id write-through — is it consistent with the adapter contract PublishResult.externalId in types.ts, and does anything else need it, e.g. the MCP post list or analytics? Is leaving it out of those consumers acceptable for this fix?) and markVariantPublished clearing errorMessage (does the UI or MCP tool text promise errorMessage persists for FAILED variants only?).

Known intentional decisions (don't re-flag): remove-then-add may briefly remove a job that a concurrently-running reconciler just enqueued; single-user product, per-channel serialized workers.

Brief: (a) spec requirements violated or partially honored (quote spec), (b) scope creep, (c) looks-implemented-but-wrong. Under 300 words.

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