## Review

**Correct (verified):**
- **Security headers** (`src/server/http.ts:47-52`): placement after `await next()` is safe — Hono's compose catches errors per-level and unwinds normally, so headers land on error responses too. Empirically confirmed `nosniff` on a 401.
- **/api/health anonymity** (`src/server/http.ts:55-66`): registered *before* the `app.use("*")` auth middleware and short-circuits, so it genuinely runs anonymously — empirically confirmed 200 with `getAccountId → null`. **But** `tests/integration/api.test.ts`'s "anonymously" test uses `makeApp()` whose default `getAccountId` returns a non-null account — it doesn't actually test anonymity.
- **Anonymous-touch consistency** (`src/app/s/[code]/route.ts:100-104`): `applyClick` already treats `contactId: null` as anonymous (cookie-blocked path, `ContentTouch.contactId` nullable) — budget degradation is consistent.
- **MCP gate** (`src/server/mcp/server.ts:56-72`): 14 tools/5 modules match api.md; gate covers all publish-path tools (`schedule.set/reschedule/cancel`; no `post.publish` exists).
- **api.md route table** matches all `app.*` registrations (verified across 11 route files). **DEPLOYMENT.md** env names match `auth.ts` (`SMTP_URL`/`SMTP_FROM`/`AUTH_EMAIL_DEV_MODE`).
- Tests: 62 integration tests pass (settings/mcp/api/graph).

**Judgement calls / notes:**
- **MCP cap 0-trap** (`src/server/routes/mcp.ts:54`): `Number(env) || undefined` makes `MCP_WRITE_DAILY_CAP=0` silently fall back to the default 100 (`?? 100` in mcp/server.ts:49) — inconsistent with the documented FREE_PLAN_* "0 = unlimited" convention; undocumented.
- **`limits.ts:17-20`** `num()`: non-integer/negative values silently fall back to defaults — a typo like `"5O"` silently yields 50. Doc'd convention, but silent.
- **Hot path** (`route.ts`): `contactBudgetAvailable` adds a `contact.count` per new-visitor click (returning visitors skip it) — indexed via `[workspaceId, stateLifecycleStage]` prefix, but a new DB round trip on the ADR-0009 <30ms path. Intentional per comments; residual risk.
- **`settings.ts` GET**: `findUniqueOrThrow` P2025 → generic 500, not the 404 api.md implies (only reachable by TOCTOU; workspace middleware 404s first).
- **Gate ordering** (`mcp/server.ts:82-83`): `checkWriteCap` runs before `checkPublishApproval`, so rejected calls consume the daily write budget.
- **Playwright** (`playwright.config.ts`): only `DATABASE_URL`/`AUTH_URL`/`PORT` injected — `AUTH_SECRET`/`ENCRYPTION_KEY`/`REDIS_URL`/`AUTH_EMAIL_DEV_MODE` depend on the developer's `.env`; if `AUTH_EMAIL_DEV_MODE` isn't "true" locally, magic-link log parsing (`/tmp/spellpaw-e2e.log`) times out. Orphaned dev server on 3100 after abrupt kills blocks re-runs (`reuseExistingServer: false`). Re-run DB pollution is benign (fresh email → fresh workspace per run; seed is idempotent).
- **Smells**: Duplicated `secure = NODE_ENV === "production"` cookie logic in `route.ts:63` + `channels.ts:33` (Duplicated Code, minor); `SettingsClient.tsx` DOM-query input + checkbox defaulting `true` pre-load (minor).
- **No hard violations** of documented standards found.