All verification complete. Let me compile the findings.

## Review

**Spec coverage (quote → status):**

- §3 "发布类操作需 AI 对话内审批（除非用户开启信任开关）": **Complete.** The only publish-triggering MCP tools are `schedule.set/reschedule/cancel` — all call `checkPublishApproval` (src/server/mcp/server.ts:56-70, 80-84, 212-216). There is no MCP `post.publish`; `post.update_variant` edits content only. The gate reads the workspace from the DB **per call**, so a mid-session toggle flip is honored (verified by the MCP test flipping the toggle between calls, tests/integration/mcp.test.ts:172-201).
- §2 `/api/settings/workspace GET/PATCH`: both exist (src/server/routes/settings.ts:31-71). Empty `{}` and partial bodies pass zod `.optional()` → verified by test (`noop` PATCH → 200) and by running it. Usage counters match the enforced counts exactly (oAuthConnection/post/contact counts = the same queries as the enforcers, src/server/limits.ts).
- ADR-0012 guardrails: enforced on REST POST /posts (429) and MCP `post.create_draft` — `createPost` calls `enforcePostLimit` (src/server/posts.ts:33), so the "50 posts" cap is **not** bypassed via MCP; 0=unlimited handled (limits.ts:19-30).
- ADR-0009: redirect budget check documented as intentional (route.ts:88-91, limits.ts:71-76, CONTEXT.md); anonymous touch confirmed real — `applyClick` inserts ContentTouch with `contactId:null` (interactions.ts:74-79) and totalTouches counts it.
- Landing: English-first per ADR-0012 (defaultLocale en); signed-in redirect works (page.tsx). DEPLOYMENT.md instrumentation claim matches (workers: per-slug publish, scheduler, click-touch, reconciler+cron, instrumentation.ts → createWorkers). Docs verified against actual routes.

**Findings (severity → file):**

- **minor/doc** `docs/api.md:44` — channels callback is documented as "返回 429" but the route catches all `completeConnect` errors incl. the 429 and 302-redirects to `channels?error=connect_failed` (routes/channels.ts:70-76); the limit is enforced, the response shape is not 429 and the user sees "exchange_failed".
- **minor** mcp/server.ts:80-84 — `checkWriteCap` runs *before* the approval gate, so gated (rejected) schedule calls still burn a daily write token.
- **minor** mcp/server.ts `post.update_variant` on a SCHEDULED post: tool text says "resets it to draft" but only the variant resets; post stays SCHEDULED with its job armed, and this content-mutation-on-the-publish-path sits outside the approval gate (gray area of §3, not a violation).
- **minor** `MCP_WRITE_DAILY_CAP=0` falls back to default 100 (`Number("0")||undefined`, routes/mcp.ts:49) — inconsistent with FREE_PLAN_* "0=unlimited".
- **note** E2E: `cms` workspace-id regex holds today (verified generated id `cmsd7z65w…` via cuid v1) but is timestamp-dependent; analytics assertions catch total-touch breakage but not per-visitor double counting (`uniqueContacts>=1` is weak); 3s+1s waits may flake.
- **note** One full-suite run failed 8 queue tests; 3 subsequent runs green (124/124) — possible cross-file Redis interference.
- **note** channel limit is count-then-upsert (non-atomic) — two concurrent callbacks at max-1 can slip; acceptable guardrail semantics.

No blockers. Correct: full gate coverage + per-call toggle, guardrail parity, 429 on post limit, fail-open rate limit documented, empty/partial PATCH, mid-session toggle honored, docs mostly accurate.