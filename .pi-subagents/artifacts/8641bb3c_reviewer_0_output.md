## Review

**Hard (documented-standard violations): none.** Code matches CONTEXT.md "Token Refresh" and DEPLOYMENT §7: silent refresh-on-publish before the platform call (`src/server/posts.ts:207-238`), encrypted write-back of the rotated set, FAILED-without-retry on dead grant (PermanentPublishError → `src/server/queue.ts:224` skips retry), `@handle` from `users/me` at connect, scope `tweet.read tweet.write users.read offline.access` (`twitter.ts:19`). The rethrow `if (err instanceof PermanentPublishError) throw err` (`posts.ts:242-243`) does **not** disturb pre-existing permanent errors — validation/not-connected/no-adapter all throw *before* the try (`posts.ts:170-196`), so they still escape. Error detail is preserved in `tokenRequest` (`error_description ?? error ?? status`); only the prefix changed ("token exchange failed"→"token request failed") — cosmetic, tests match.

**Judgement (baseline smells + doc/code gaps):**
- Duplicated defensive code: `fetchAccountName` try/catch→null in `channels.ts:65-74` duplicates the best-effort semantics already inside `twitter.ts:102-118` (which never throws). Defensible only because the type docstring doesn't forbid throwing.
- Doc/code: `.env.example` says "Set all three for the REAL Twitter adapter", but `registry.ts:11-19` gates on only clientId+secret, and `TWITTER_OAUTH_REDIRECT_URI` is never read — the adapter uses the runtime-derived redirectUri (`routes/channels.ts:41,54`). Pre-existing dead config; new wording overstates it.
- Doc/code: DEPLOYMENT §7.6 / CONTEXT.md "提示用户重新连接" — recorded `errorMessage` ("token refresh failed: …") contains no reconnect hint; no UI prompt in this milestone.
- Doc nuance: §7.5 claim holds only for *new* connections (no backfill) — migration `20260803133312_x_account_name` is correctly nullable.
- Data point: all refresh failures (incl. transient 5xx) are permanent — deliberate, doc-aligned judgement; residual risk.
- Edge: `posts.ts:200-206` now decrypts refreshToken each publish; corrupt ciphertext → transient "failed" loop instead of publishing.

**Tests** prove the three claims (write-back asserts decrypted DB values; `refreshes === 0`; PermanentPublishError escape + FAILED + message), and the api.test connect dance is correct (server-supplied redirectUri echoed; `challenge` param harmlessly ignored; verifier from cookie). All pass.

Note: `plan.md`/`progress.md` don't exist at the repo root.