# Task for reviewer

[Read from: /Users/nicholasl/Documents/build-whatever/SpellPaw/plan.md, /Users/nicholasl/Documents/build-whatever/SpellPaw/progress.md]

You are the STANDARDS axis of a code review for SpellPaw's X-Connect milestone (real Twitter adapter: token refresh + account name) — staged changes on top of commit 15415dd (M5).

Fixed point: 15415dd. Diff command (run in /Users/nicholasl/Documents/build-whatever/SpellPaw):
  git diff 15415dd --cached -- . ':(exclude)pnpm-lock.yaml'

Standards sources: AGENTS.md, CONTEXT.md (ubiquitous language incl. Token Refresh), docs/adr/0004 (adapter pattern), docs/design/spellpaw-phase1-implementation.md, docs/ops/DEPLOYMENT.md §7 (newly written — verify the code matches what it claims: scope offline.access, refresh-on-publish, encrypted write-back, FAILED-without-retry on dead grant, @handle from users/me at connect), and this fixed smell baseline (Fowler ch.3 — labelled judgement calls, not violations; skip tooling-enforced issues): Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest.

Scrutinize specifically: src/adapters/channels/types.ts (optional refresh/fetchAccountName — is optionality the right seam? backward compat), src/adapters/channels/twitter.ts (tokenRequest helper, refresh rotation semantics — Twitter rotates refresh tokens; does the error path preserve the original error message? fetchAccountName best-effort), src/server/posts.ts publishVariantToChannel (refresh-before-publish placement, the new catch that rethrows PermanentPublishError — did the author accidentally change behaviour for OTHER permanent errors like validation/not-connected that were already thrown outside the try? verify those still escape; the 5-minute margin in needsRefresh), src/server/channels.ts (fetchAccountName helper try/catch — duplicated try/catch elsewhere? accountName upsert), migration x_account_name (nullable column, no backfill needed), tests (queue.test.ts new describe — do the 3 tests actually prove refresh-write-back, no-refresh-when-valid, permanent-failure escape? api.test.ts new connect test — is the named adapter's buildAuthUrl redirect-URI dance correct?), ChannelsClient @handle display, docs (DEPLOYMENT §7 accuracy, .env.example wording).

Brief: per file/hunk — (a) documented-standard violations (cite), (b) baseline smells (name + quote), (c) doc/code mismatch. Distinguish hard vs judgement. Under 350 words.

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