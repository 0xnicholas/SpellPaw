# Review — SPEC axis, M3 (BYOK + embedded MCP) on 5ceb394

(plan.md/progress.md don't exist in repo; reviewed against spec `docs/design/spellpaw-phase1-implementation.md` §1–§3/§6, ADR-0005, ADR-0010, and the staged diff.)

## Findings

**Correct (with evidence)**
- 14-tool surface matches spec §3 table exactly (verified in `src/server/mcp/server.ts` + `tests/integration/mcp.test.ts` asserts all 14 names).
- PII contract enforced: REST (`src/server/routes/contacts.ts:13-24`) and MCP (`src/server/mcp/server.ts:311-325`) both use explicit `NON_PII_SELECT` with no `profile_*`; test seeds PII and asserts it never surfaces. No include/select leak paths found.
- AES-256-GCM at rest for model keys (`src/lib/crypto.ts`, reused by OAuth). `keyPreview` = `sk-…3456` matches spec.
- Rate limit: `sp:rl:ai:{workspaceId}` 10/min (`src/server/routes/ai.ts:18`) — matches spec §6 "AI generate 10/min".
- MCP auth: bearer (`src/server/api-tokens.ts`) + session-cookie fallback both wired in `src/server/http.ts:75-97`; workspace scoped. Schedule tools go through `schedulePost` → real BullMQ `publisher.schedule` (`src/server/posts.ts:154`, `src/server/queue.ts`).
- Route-module refactor preserved M2 surface (route parity vs `5ceb394:src/server/http.ts`); all 105 tests pass; `tsc --noEmit` clean.

**Implemented but wrong/partial**
1. `stage` param unvalidated — `contacts.ts:38` casts `query.stage as never`. Spec example `?stage=engaged` (lowercase) and any invalid value return **500** (verified empirically: 500 for `engaged`/`FOO`, 200 for `ENGAGED`). MCP `contact.list` validates via `z.enum`; REST should too → 400.
2. Dead degradation path — `touchModelKeyCheck` (`src/server/model-keys.ts:109`) has zero callers; nothing ever sets `isActive=false`/`lastChecked`. ModelProviderKey's `isActive`/`lastChecked` (spec §1) are write-dead, so spec §8/ADR-0005 key-state degradation ("yellow banner + grey button") isn't driven.

**Missing/partial vs spec**
3. Spec §3 publish-class approval/trust toggle absent (no trust switch anywhere; PRD defers to M5). `schedule.set` arms publishing with no in-dialog approval. Not in the documented-deviation list — needs tracking.
4. `/api/settings/workspace GET/PATCH` (spec §2 route list) unimplemented with no milestone mapping (unlike contacts, deviation (a)).

**Scope creep** — none material; api-tokens is documented deviation (c). Minor notes: MCP write-cap default (100/day) is arbitrary/undocumented; `providers.test.ts` timeout test leaves an unhandled rejection (vitest reports 1 error).

## Acceptance report