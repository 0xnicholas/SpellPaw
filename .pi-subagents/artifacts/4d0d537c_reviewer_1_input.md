# Task for reviewer

[Read from: /Users/nicholasl/Documents/build-whatever/SpellPaw/plan.md, /Users/nicholasl/Documents/build-whatever/SpellPaw/progress.md]

You are the SPEC axis of a code review for the SpellPaw M3 milestone (BYOK AI provider + embedded MCP server) — staged changes on top of commit 5ceb394.

Fixed point: commit 5ceb394. Diff command (run from /Users/nicholasl/Documents/build-whatever/SpellPaw):
  git diff 5ceb394 --cached -- . ':(exclude)pnpm-lock.yaml'

Spec sources — read in the repo:
1. docs/design/spellpaw-phase1-implementation.md §1 (ModelProviderKey model: provider 'openai'|'anthropic', encryptedKey AES-256-GCM, keyPreview, isActive, lastChecked; Contact model: type AUDIENCE|CORRESPONDENT, profile_* PII vs persona_* no-PII, state_*; Interaction tables ContentTouch/Conversation/Event + contact_timeline VIEW).
2. Same doc §2 (API routes: /api/settings/model-keys GET/POST, /api/contacts GET (?stage=engaged&limit=20), /api/contacts/:id GET (Persona+State, no PII), /api/contacts/insights/repeat-viewers GET, /api/mcp/* MCP SSE + messages embedded).
3. Same doc §3 (MCP tools: 5 modules / 14 tools exactly as listed; contact.get returns Persona + State + recent Interaction, never profileName/Email/SocialHandle; write ops token-capped; publish-class ops need in-dialog approval unless trust toggle).
4. Same doc §6 security (rate limit AI generate 10/min; key encryption AES-256-GCM for OAuth token + model key; PII leak row).
5. ADR-0005 (BYOK, graceful degradation on key failure), ADR-0010 (MCP embedded, reuse same DB/auth).

Known intentional deviations already documented (verify documented, don't re-flag as new findings): (a) Contact/Interaction tables arrive in M3 schema-only (M4 writes data) — spec says Phase 1, no explicit milestone mapping, so M3/M4 split is a scheduling choice; (b) Interaction tables + VIEW deferred to M4; (c) api-tokens (workspace bearer tokens) added for MCP external clients — not in the spec route list, needed for spec §3 'external assistants connect' to work.

Brief: Report (a) requirements the spec asked for that are missing or partial within M3 scope (quote the spec line); (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong (quote spec line + explain mismatch). Pay attention to: the exact 14-tool surface vs spec §3 table, PII contract enforcement (both routes and MCP), ModelProviderKey fields (isActive/lastChecked used or dead), rate limit keys/limits, MCP auth (session cookie path for /api/mcp and bearer), the schedule tools going through the real queue, and whether any contact endpoint can leak PII via include/select mistakes. Under 400 words.

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