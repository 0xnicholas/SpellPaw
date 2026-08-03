All evidence gathered. Here is the SPEC-axis review.

## Review

**Correct (verified):**
- AES-256-GCM at-rest encryption is correct: 12-byte random IV, auth tag, `"v1:iv:tag:ct"` format, 32-byte key enforced (`src/lib/crypto.ts:8-17, 29-46`); round-trip/tamper tests pass.
- Schema-vs-§1 alignment for M1 entities: Workspace/Post/OAuthConnection/Channel fields match the spec (diff vs §1 blocks); `PostStatus DRAFT/SCHEDULED/PUBLISHED` and `PublishState` match CONTEXT lifecycle and §5. `mediaUrls String[]` on PostVariant is the only missing field — a documented M1 deferral (media = M3).
- Status flow Draft→Scheduled→Published holds (schedule/cancel/publish in `src/server/posts.ts:71-107, 132-176`); one-channel-failure isolation is implemented and integration-tested (`api.test.ts` "keeps publishing other channels…").
- Workspace isolation via accountId-scoped lookup (layout + middleware) is solid. Magic-link auth (FR-001) present.

**(a) Missing/partial within M1:**
1. §2 `GET /api/calendar (?view=week&channels=...)` — implemented as `?start=&days=`; `channels` filter and `view` dropped (`src/server/http.ts:229-239`).
2. PRD FR-020 "Calendar 时间跨度默认为用户本地时区，Storage 为 UTC" — calendar is UTC end-to-end (`CalendarPanel.tsx:34-39, 86-98`); Composer's `datetime-local` is parsed as *server* local time, so scheduled times shift by the server's offset.
3. §2 `PATCH /api/schedule/:pid` (reschedule), `GET /api/posts/:id`, `GET /api/variants/:vid` absent (partially justified as M2).
4. FR-002 default workspace name: spec "Workspace" vs "My Workspace" (`workspaces.ts:10`); no rename UI.

**(b) Scope creep (mild):** all three channels seeded/connectable with mocks though M1 = single channel (`seed.ts`, `registry.ts`); `PATCH /api/variants/:id` exists but the Composer never calls it (always creates a new Post) — dead M2 code.

**(c) Looks implemented but wrong:**
1. `publishPost` sets post-level PUBLISHED when *any* variant succeeds (`posts.ts:173-177`), then re-publish is rejected ("post is already published", `http.ts:96-99`) — a FAILED variant can never be retried. Latent in M1, breaks §5/§8 semantics in M2.
2. Calendar drops overdue SCHEDULED posts: query only returns SCHEDULED posts with `scheduledAt` in `[start,end)` (`posts.ts:246-251`); with no queue in M1 a past-due scheduled post silently disappears from the "基础 Calendar".
3. OAuth callback loses workspace: the callback GET can't carry `x-workspace-id`, so `ensureWorkspace` resolves the *default* workspace (`http.ts:117-124`) — a non-default workspace's connect would land in the wrong workspace (contradicts FR-003 once a 2nd workspace exists).
4. OAuth state/verifier cookies are per-browser, not per-connect (`http.ts:141-152`) — a second concurrent connect invalidates the first.
5. Composer `datetime-local` sends TZ-less wall time; `new Date(value)` parses in server TZ (`Composer.tsx:155`, `http.ts:242`) — FR-020 violation feeding bug #2's data.

No blockers; 54 tests pass (unit + integration against `spellpaw_test`).