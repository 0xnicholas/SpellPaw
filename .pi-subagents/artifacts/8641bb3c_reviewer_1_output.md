## Review

**Correct**
- Spec contract (DEPLOYMENT §7) fully honored: `offline.access` in scope (twitter.ts:24); silent refresh when stale with 5-min margin (posts.ts:256); rotated tokens written back AES-GCM-encrypted (posts.ts:231-242); dead grant = FAILED without retry (PermanentPublishError + worker `return` at queue.ts:224); @handle from `users/me`, cosmetic, never blocks connect (twitter.ts:104-118; channels.ts:68-76). Registry fallback to MockAdapter intact (registry.ts).
- Permanent path ordering correct: `markVariantFailed` runs *before* `throw PermanentPublishError` (posts.ts:226-231), worker skips retry; test asserts `FAILED` + errorMessage (queue.test.ts).
- No new leak: `/api/channels` adds only `accountName` (public platform handle), workspace-scoped; no tokens.
- Migration from scratch verified: `prisma migrate deploy` on an empty scratch DB applied all 6 migrations; `accountName` nullable, no backfill needed.
- M4 loop untouched: no redirect/click/analytics/shortlink files in diff; publish-path changes additive.
- Full suite: 134/134 tests pass.

**Fixed**: none (review-only).

**Blocker**: none.

**Notes**
- *Race (low severity)*: queues are per-channel but worker concurrency is 5 (queue.ts:302). Two same-channel jobs in the same stale window both refresh with token R0; Twitter rotates R0, so the second refresh may return invalid_grant → that variant is spuriously FAILED ("token refresh failed") while the grant is healthy. If both refreshes succeed, the last write wins and — since every written token was platform-issued — the final set is always valid; **no lost-update breaks the next publish**. Single-user + narrow window ⇒ low. Mitigate with concurrency 1 per publish queue or a conditional update.
- DEPLOYMENT §7 pt.6 "错误信息提示重新连接渠道" is partial: stored message is `token refresh failed: …` with no explicit "reconnect channel" hint (minor).
- @handle itself is locale-neutral and renders correctly in en/zh; surrounding "Connected"/"Not connected" is hardcoded English — pre-existing, no new i18n keys (minor).
- `plan.md`/`progress.md` do not exist in the repo (task references unfulfilled; worked from spec docs + staged diff).

No scope creep; `tokenRequest` refactor is shared code.