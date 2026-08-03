# Task for reviewer

[Read from: /Users/nicholasl/Documents/build-whatever/SpellPaw/plan.md, /Users/nicholasl/Documents/build-whatever/SpellPaw/progress.md]

You are the SPEC axis of a code review for SpellPaw's X-Connect milestone (real Twitter adapter: token refresh + account name) — staged changes on top of commit 15415dd (M5).

Fixed point: 15415dd. Diff command (run in /Users/nicholasl/Documents/build-whatever/SpellPaw):
  git diff 15415dd --cached -- . ':(exclude)pnpm-lock.yaml'

Spec sources — read in the repo:
1. docs/design/spellpaw-phase1-implementation.md §1 adapter contract + §5 publish path (workers, retries, permanent vs transient failure semantics: FAILED is terminal, auto-pipeline only pushes DRAFT).
2. docs/adr/0012: X real integration must land (first real channel, M4+); real publish → real clicks → Content Touch → Graph is the revenue-critical loop.
3. docs/ops/DEPLOYMENT.md §7 (new): the documented X integration contract — scope offline.access, silent refresh on publish when stale, rotated tokens written back encrypted, dead grant = FAILED without retry, @handle fetched at connect (cosmetic, failures never block connect).
4. docs/adr/0009: redirect <30ms and never blocked by writes (this milestone touches the publish path, not redirect — but verify no regression).

Known intentional deviations documented in code (verify documented, don't re-flag): refresh failure treated as permanent (PermanentPublishError) rather than transient; MockAdapter stays refresh-less so mock channels never rotate.

Brief: Report (a) spec requirements missing/partial (quote spec line); (b) behaviour not asked for (scope creep); (c) requirements that look implemented but wrong. Pay attention to: does refresh-write-back introduce a race if two publish jobs for the same workspace/channel run concurrently (both read stale token, both refresh, second write clobbers — is the final token still valid? is there a lost-update of the rotated refresh token that would break the NEXT publish?) — evaluate severity honestly for a single-user product with per-channel queues. Does the permanent-failure path in posts.ts still mark the variant FAILED with a user-facing error before escaping (check markVariantFailed ordering vs throw)? Does the API list channels endpoint now leak anything new? Is the @handle display correct in both en/zh UI copies? Does the migration work from scratch (migrate deploy on an empty DB)? Is there anything in the diff that would break the M4 closed loop (redirects, clicks, analytics)? Under 350 words.

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