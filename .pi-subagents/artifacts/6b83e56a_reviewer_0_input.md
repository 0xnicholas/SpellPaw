# Task for reviewer

[Read from: /Users/nicholasl/Documents/build-whatever/SpellPaw/plan.md, /Users/nicholasl/Documents/build-whatever/SpellPaw/progress.md]

You are the STANDARDS axis of a code review for the SpellPaw M5 milestone (release readiness: MCP publish approval, /api/settings/workspace, free-plan guardrails, security hardening, landing, docs, Playwright E2E) — staged changes on top of commit b1a68c7.

Fixed point: commit b1a68c7. Diff command (run from /Users/nicholasl/Documents/build-whatever/SpellPaw):
  git diff b1a68c7 --cached -- . ':(exclude)pnpm-lock.yaml'

Standards sources: AGENTS.md, docs/agents/*, CONTEXT.md (ubiquitous language incl. the new terms Publish Approval / Free-Plan Guardrails), docs/design/spellpaw-phase1-implementation.md (spec §3 publish approval gating; §2 /api/settings/workspace GET/PATCH; guardrail semantics per ADR-0012), docs/adr/0009 (redirect never blocked by writes), docs/ops/DEPLOYMENT.md and docs/api.md (newly written — verify the code matches what they claim), and this fixed smell baseline (Fowler Refactoring ch.3 — each a labelled judgement call, never a hard violation; a documented repo standard overrides it; skip anything tooling enforces): Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest.

Scrutinize specifically: src/server/limits.ts (env parsing — the 0=unlimited vs missing-env fallback trap; count queries on every create path — cost & index coverage), the redirect-budget degradation in src/app/s/[code]/route.ts (contactBudgetAvailable called on every click — does it break the <30ms/cache-hot promise? is the anonymous-touch path consistent with applyClick's null-contactId handling?), src/server/routes/settings.ts workspace GET/PATCH (PATCH data typing; empty patch semantics; findUniqueOrThrow 404 shape), src/server/mcp/server.ts checkPublishApproval (per-call DB read; error message clarity; does the gate also cover post.publish-style tools or only schedule.*?), the security headers middleware placement in src/server/http.ts (after next() — does it actually run on errors?), /api/health (anonymous, DB only — fine?), the Landing component (i18n structure, Link locale usage, a11y basics), the Playwright config (env injection, log-file coupling, e2e DB lifecycle — does it leave a server running / pollute the e2e DB on re-runs?), and the docs (DEPLOYMENT.md env names vs src/lib/auth.ts SMTP_URL/SMTP_FROM and AUTH_EMAIL_DEV_MODE; api.md route table vs the actual route registrations in src/server/http.ts + src/server/routes/*).

Brief: Report per file/hunk — (a) every place the diff violates a documented standard (cite the standard), (b) any baseline smell (name it, quote the hunk), (c) any doc/code mismatch. Distinguish hard violations from judgement calls. Under 400 words.

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