# Task for reviewer

[Read from: /Users/nicholasl/Documents/build-whatever/SpellPaw/plan.md, /Users/nicholasl/Documents/build-whatever/SpellPaw/progress.md]

You are the STANDARDS axis of a code review for the SpellPaw M4 milestone (short links + ContentTouch click attribution + analytics + i18n) — staged changes on top of commit 6b1daf4.

Fixed point: commit 6b1daf4. Diff command (run from /Users/nicholasl/Documents/build-whatever/SpellPaw):
  git diff 6b1daf4 --cached -- . ':(exclude)pnpm-lock.yaml'

Standards sources: AGENTS.md, docs/agents/*, CONTEXT.md (ubiquitous language), docs/design/spellpaw-phase1-implementation.md (spec §1 Interaction tables + contact_timeline VIEW; §5 short-link redirect flow with Redis cache + fire-and-forget click queue; §7 next-intl path prefix /zh,/en + Accept-Language + short-link exclusion; §6 security incl. SQL injection via Prisma parameterized queries; PII contract — contact endpoints never return profile_*), docs/adr/0009-self-hosted-short-links.md (Next.js Middleware <30ms redirect, Redis TTL 24h, BullMQ 3 retries; NOTE the repo deliberately deviated — route handler instead of middleware, documented in src/app/s/[code]/route.ts — treat that as the documented standard), docs/adr/0012 (M4 scope: short links + ContentTouch + analytics + i18n en/zh).

Plus this fixed smell baseline (Fowler, Refactoring ch.3) — each is a labelled judgement call, never a hard violation; a documented repo standard overrides the baseline; skip anything tooling enforces (typecheck/lint):
- Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest.

Also scrutinize: the click pipeline race handling in src/app/s/[code]/route.ts (cookie validation + upsert-at-redirect vs worker upsert), the ShortLinkCache structural interface vs ioredis adapter in the route, analytics raw SQL (parameterization of postId/limit, quoted camelCase identifiers), the contact-timeline VIEW SQL (quoted identifiers, idempotency, prod migration vs test setup duplication), the interactions.ts transaction (applyClick), the migration file hand-edits (variantId nullable + index + VIEW appended — is the migration replay-safe from scratch?), the i18n restructure (middleware matcher exclusions, generateStaticParams, setRequestLocale, DashboardNav locale switcher EN/中 href target), and the graph.test.ts beforeEach cleanup order (FK order).

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