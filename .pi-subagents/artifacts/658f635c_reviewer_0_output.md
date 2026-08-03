## Review

**Correct (evidence)**
- **Analytics SQL (spec §6):** every dynamic value (`limit`, `postId`, `workspaceId`) is bound via `Prisma.sql` tagged params — never interpolated (`src/server/routes/analytics.ts:21,37,80,124`); all camelCase identifiers quoted in raw SQL. `contacts.ts` repeat-viewers query likewise parameterized.
- **contact_timeline VIEW:** quoted identifiers, `CREATE OR REPLACE VIEW` (idempotent), identical SQL in migration and `prisma/views/contact_timeline.sql` — duplication is documented in both files, so the repo standard overrides the Duplicated Code smell.
- **Migration replay:** m4 migration only references tables created in earlier migrations (init/m3); hand-edits (nullable `variantId` + index + appended VIEW) match `schema.prisma` exactly. Replay-safe from scratch.
- **graph.test.ts beforeEach:** FK order correct — contentTouch → contact → shortLink → postVariant → post (RESTRICT chain respected).
- **i18n:** middleware matcher excludes `api|s|_next|_vercel|.*\..*` (§7 short-link exclusion); `generateStaticParams`, `setRequestLocale`, en/zh key parity verified. `tsc --noEmit` passes.

**Blocker**
- `src/app/s/[code]/route.ts:84-99` + `src/server/interactions.ts:56-62` — race-handling defect: `resolveVisitor` pre-creates the contact `{id, workspaceId, type}` **without** `profileSourceChannel`; the worker's `upsert({create:{..., profileSourceChannel}, update:{}})` then skips `create` and `update` is empty, so the field is **always NULL** in the real pipeline. The test (`graph.test.ts:166-168`) only passes because it calls `applyClick` directly without the route pre-creating. Fix: worker `update` must set `profileSourceChannel`.

**Fixed** — none (review-only).

**Notes (judgement calls)**
- `src/components/DashboardNav.tsx:45,49` — locale switcher `href="/content"` renders `/en/content`/`/zh/content` (localePrefix always) — no such route; EN/中 both 404. Should target `/${workspace.id}/content` (or current pathname).
- `interactions.ts:31-33` — comment claims "a failed recompute must not lose the touch," but recompute runs inside the same transaction, so a failed recompute rolls back the touch. Comment/behavior mismatch.
- `route.ts:97-101` — `decodeURIComponent` on a public cookie has no try/catch; a malformed `sp_c` yields 500 instead of redirect.
- Duplicated Code (judgement): `HAVING count(DISTINCT postId) >= 2` rule re-implemented in `analytics.ts:96` and `contacts.ts:34`; three analytics queries re-state the ContentTouch×Post join. Small; acceptable.
- Per-request `new Queue()` + `close()` in `route.ts:50-57` churns a Redis connection on every click — documented fire-and-forget, but note it.

No blockers beyond the profileSourceChannel defect.