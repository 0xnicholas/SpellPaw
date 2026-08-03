# Task for reviewer

[Read from: /Users/nicholasl/Documents/build-whatever/SpellPaw/plan.md, /Users/nicholasl/Documents/build-whatever/SpellPaw/progress.md]

You are the SPEC axis of a code review for the SpellPaw M4 milestone (short links + ContentTouch + analytics + i18n) — staged changes on top of commit 6b1daf4.

Fixed point: commit 6b1daf4. Diff command (run from /Users/nicholasl/Documents/build-whatever/SpellPaw):
  git diff 6b1daf4 --cached -- . ':(exclude)pnpm-lock.yaml'

Spec sources — read in the repo:
1. docs/design/spellpaw-phase1-implementation.md §1 (Interaction tables ContentTouch/Conversation/Event + contact_timeline VIEW; ContentTouch {contactId, postId, action CLICK|LIKE|SHARE, timestamp}; Contact persona/state recomputed on Interaction events).
2. Same doc §2 route list: /api/analytics/dashboard, /api/analytics/posts/:id, /api/analytics/top-posts, /api/contacts/insights/repeat-viewers.
3. Same doc §5 short-link flow: Redis-cached 301, PG fallback, fire-and-forget BullMQ clickQueue (3 retries exp backoff), worker batch INSERT ContentTouch.
4. Same doc §7 i18n: next-intl, path prefix /zh,/en, middleware + short-link pattern exclusion, Accept-Language detection, messages/zh.json + en.json.
5. ADR-0009 (self-hosted short links: one API route, Redis TTL 24h, redirect <30ms not blocked on interaction write), ADR-0012 (M4 = Graph with real data: short links + ContentTouch + analytics + i18n en/zh; closed loop real publish → short-link clicks → ContentTouch → Graph).

Known intentional deviations already documented in code (verify documented, don't re-flag as new findings): (a) redirect served by Node route /s/:code instead of Next.js Middleware (edge cannot run BullMQ) — comment in src/app/s/[code]/route.ts; (b) ContentTouch.contactId nullable for anonymous clicks + variantId added for per-channel attribution — comment in schema.prisma; (c) ShortLink carries workspaceId + variantId (unique per variant) — comment in schema.prisma; (d) contact row created synchronously at redirect time (upsert) to close the visitor-cookie race — comment in route; (e) Interaction tables Conversation/Event + VIEW arrive in M4 (schema-only in M3).

Brief: Report (a) requirements the spec asked for that are missing or partial within M4 scope (quote the spec line); (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong (quote spec line + explain mismatch). Pay attention to: the exact ContentTouch/Conversation/Event/VIEW shapes vs spec §1 (columns, enums, index coverage); repeat-viewers semantics (≥2 distinct posts — does the SQL match?); analytics dashboard vs §2 (fields, scoping); click queue retry semantics (3 attempts, exponential — check defaultJobOptions and worker wiring incl. instrumentation.ts); i18n spec compliance (path prefix both locales, Accept-Language redirect, /s and /api exclusion in middleware matcher, messages files both locales with matching keys); the closed-loop end-to-end (publish → create short link → redirect sets cookie → second click reuses contact → stage promotion after 2 distinct posts); and whether any analytics/contacts endpoint can leak PII via the raw SQL or the recentTouches list (contactId exposure is OK — it is not PII — profile fields are the banned ones).

Under 400 words.

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