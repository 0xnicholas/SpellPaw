## Review

**Verified compliant (hard standards):** AES-256-GCM model-key at-rest (spec §6; `saveModelKey`→`encryptString`, test asserts no plaintext); AI generate 10/min (spec §6; `ai.ts` `sp:rl:ai:{ws}` 10/60); §8 taxonomy MODEL_KEY_INVALID→400 / MODEL_KEY_QUOTA→429 (`ai.ts:37-46`, provider tests cover 401/429/500/network/timeout); PII contract — `contact.get`/`list` select excludes `profile_*` (mcp.test.ts asserts no leakage); MCP 5 modules/14 tools (spec §3, test asserts count); write ops token-capped (spec §3, `checkWriteCap`); ADR-0005/0010; CONTEXT terminology intact. Middleware ordering is sound: MCP bearer → session-auth (skips via `mcpViaToken`) → workspace-scoping (skips) — no boundary breach.

**Correctness bugs**
- **contacts.ts:37** — `listQuerySchema.parse(...)` throws ZodError (e.g. `?limit=abc`) → `http.ts` onError → **500 instead of 400**. Use safeParse→ApiError.
- **Composer.tsx:126** — `title="Rewrite the draft as a {activeChannel.name} post…"` renders the literal braces; tooltip is broken.

**Duplicated Code (baseline)**
- **NON_PII_SELECT** twice (contacts.ts:9-21 vs mcp/server.ts:331-341) with drift: the MCP copy omits `createdAt` — the two "source-of-truth" copies already diverge.
- **schedule.set/reschedule** (mcp/server.ts:150-199) identical handlers; REST side deduped via `applySchedule` (schedule.ts) — MCP side not.
- **keyPreview** logic duplicated: providers.ts:120 vs inline `slice` at model-keys.ts:59 (loses short-key masking).

**Speculative Generality / dead code**
- **touchModelKeyCheck** (model-keys.ts:109) is never called — spec §8 "key失效→banner+按钮灰掉" unwired; `isActive=false` and SettingsClient.tsx:133 "inactive" badge are unreachable.
- schedule.ts:12 `throw new Error("unreachable")` dead defensive branch.

**Judgement calls/notes**
- **rate-limit.ts** — no `close()`; Redis down ⇒ `allow()` throws ⇒ 500 (no open-mode degradation); `mcpViaToken` edge: invalid Bearer 401s even with a valid session cookie.
- **getActiveModelKey** (model-keys.ts:94) orders `createdAt asc` → oldest key wins; a replaced key for the same provider is never used.
- **MCP session Map** (routes/mcp.ts) — no TTL/eviction; not bound to the creating token (workspace re-scoped per request, so no cross-tenant read); session pinning breaks across multiple Next.js workers (fine under ADR-0010 single-process).
- providers.test.ts timeout test emits a PromiseRejectionHandledWarning (unhandled rejection noise).

**Tests:** full suite 105/105 pass; M3 integration 18/18 pass (Postgres+Redis up).