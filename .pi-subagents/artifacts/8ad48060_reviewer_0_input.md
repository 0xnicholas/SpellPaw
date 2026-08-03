# Task for reviewer

[Read from: /Users/nicholasl/Documents/build-whatever/SpellPaw/plan.md, /Users/nicholasl/Documents/build-whatever/SpellPaw/progress.md]

You are the STANDARDS axis of a code review for the SpellPaw M1 implementation (Next.js + Hono + Prisma, uncommitted staged changes).

Fixed point: commit ac754f9 (docs-only repo state). Diff command (run from /Users/nicholasl/Documents/build-whatever/SpellPaw):
  git diff ac754f9 --cached -- . ':(exclude)pnpm-lock.yaml' ':(exclude)src/app/favicon.ico'
No commits between the fixed point and the work — the entire change is the staged working tree. If the diff is empty, first run: git add -A (the reviewer must not modify the repo beyond that).

Standards sources in the repo: AGENTS.md, docs/agents/*, CONTEXT.md (domain terminology — the code should use the documented ubiquitous language: Post/PostVariant/Channel/OAuthConnection/Workspace, statuses DRAFT/SCHEDULED/PUBLISHED), and the technical decisions in docs/design/spellpaw-phase1-implementation.md (Hono embedded in /api/[[...route]], Zustand for composer local state + TanStack Query for server persistence, AES-256-GCM at-rest encryption, adapter pattern per channel).

Plus this fixed smell baseline (Fowler, Refactoring ch.3) — applies even where the repo documents nothing; each is a labelled judgement call, never a hard violation; a documented repo standard overrides the baseline; skip anything tooling already enforces (typecheck/lint):
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