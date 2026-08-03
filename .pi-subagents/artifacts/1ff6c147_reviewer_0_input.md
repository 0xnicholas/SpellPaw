# Task for reviewer

[Read from: /Users/nicholasl/Documents/build-whatever/SpellPaw/plan.md, /Users/nicholasl/Documents/build-whatever/SpellPaw/progress.md]

You are the STANDARDS axis of a code review for the SpellPaw M2 milestone (BullMQ queue + scheduling) — staged changes on top of commit 60f3eba.

Fixed point: commit 60f3eba. Diff command (run from /Users/nicholasl/Documents/build-whatever/SpellPaw):
  git diff 60f3eba --cached -- . ':(exclude)pnpm-lock.yaml'
Commit list: no commits yet — the entire M2 change is the staged working tree.

Standards sources: AGENTS.md, docs/agents/*, CONTEXT.md (ubiquitous language: Post/PostVariant/Channel/Workspace, statuses DRAFT/SCHEDULED/PUBLISHED, PublishState DRAFT/PUBLISHED/FAILED), and technical decisions in docs/design/spellpaw-phase1-implementation.md §5 (BullMQ publishQueue, per-channel isolated workers, retries with backoff 30s/2m/8m, ≤7d delay + 5-min cron reconciler, idempotent jobId reschedule, one channel failure not blocking others) and §1 (schema unchanged — queue state must NOT be added to DB enums).

Plus this fixed smell baseline (Fowler, Refactoring ch.3) — each is a labelled judgement call, never a hard violation; a documented repo standard overrides the baseline; skip anything tooling enforces (typecheck/lint):
- Mysterious Name — name doesn't reveal what it does → rename.
- Duplicated Code — same logic shape in more than one hunk/file → extract shared shape.
- Feature Envy — method reaches into another object's data more than its own → move method onto the data.
- Data Clumps — same few fields/params travel together → bundle into one type.
- Primitive Obsession — primitive standing in for a domain concept → give it its own small type.
- Repeated Switches — same switch/if-cascade on the same type recurs → one map both sites share.
- Shotgun Surgery — one logical change forces scattered edits → gather into one module.
- Divergent Change — one file edited for several unrelated reasons → split.
- Speculative Generality — abstraction/params/hooks for needs the spec doesn't have → delete.
- Message Chains — long a.b().c().d() navigation → hide behind one method.
- Middle Man — class that mostly delegates onward → cut it.
- Refused Bequest — implementer ignores most of what it inherits → composition.

Also scrutinize: resource lifecycle (Redis connections/queues/workers opened per call vs shared; leaks), error paths (worker 'failed' handler idempotency, double-marking), and the sync-fake publisher in tests drifting from real worker behavior.

Brief: Report — per file/hunk where relevant — (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls — documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words.

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