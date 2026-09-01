# FIND — Contextual Discovery, Recents & Favourites

**Status:** active; FIND-01 completed 2026-08-31; FIND-02 completed 2026-08-31.

## Programme goal

Help scientists quickly rediscover work and related context without turning search into a second data model.

## FIND-01 — Recents & Work Resumption

### Goal
Provide reliable, user-specific ways to resume recently relevant work.

### Scope
- recent Notebooks, Sheets, Datasets, Records and projects;
- distinguish viewed/edited/reviewed where useful;
- deterministic ordering/timestamps from canonical activity where possible;
- compact home/navigation surfaces.

### Exit
A user can leave Sheetbase and quickly resume the objects they were genuinely working with, without relying on browser history.

### Implemented contract

- **Two signals, one spine.** *Edited/reviewed* recency derives from the
  canonical `change_events` audit trail (`actor_user_id` = current user,
  operations `create`/`update`/`amend`); block/link events attribute to their
  owning record via the trigger's `record_id` hint, and review-submission
  events yield a `reviewed` signal. No server persistence was added for these
  signals — they are a read over data that already exists.
- **Viewed** is a thin per-user table, `api.recently_viewed`
  (migration `0154_find_01_recently_viewed`): `(user_id, object_kind,
  object_id, viewed_at)`, unique per user/kind/object. It is written
  exclusively through the `record_recent_view` SECURITY DEFINER RPC, which
  resolves the object's workspace from its canonical table, verifies
  workspace membership, upserts the timestamp, and caps retention at 200
  objects per user. Direct INSERT/UPDATE is revoked; SELECT is RLS-locked to
  `user_id = api.current_user_id() AND api.is_workspace_member(workspace_id)`,
  so rows for a workspace whose membership was revoked or suspended vanish
  from the Recent surface immediately (covered by
  `tests/db/recents-rls.test.ts`, which needs a real database). Unknown or
  no-longer-visible objects are ignored, never errors. Object pages record a
  view through the `useRecentViewTracking` hook (`src/lib/recents.ts`); the
  write is fire-and-forget and can never disturb the page.
- **Ordering is deterministic:** per object, last activity =
  max(viewed_at, latest edit, latest review); the displayed signal is the
  newest of the three (ties resolve edited > reviewed > viewed); sort is
  lastActivity desc with a kind-then-id tiebreak, capped at 20
  (`RECENTS_LIMIT`). All of this lives in pure functions in
  `src/lib/recents.ts` (`buildRecentItems`, `signalEventsFromChangeEvents`,
  `resolveRecentItems`). Two ordering guarantees guard the cap: the raw
  candidate set is `RECENTS_CANDIDATE_MULTIPLIER`× the visible limit and the
  20-cap is applied to *resolved* (still-visible) items only, so hidden
  objects replenish from older candidates; and edit/review signals page
  `change_events` until enough *distinct* objects are seen, so a burst of
  edits to one object cannot evict others from the raw window.
- **Labels and destinations are canonical.** `resolveRecentItems` batch-fetches
  the underlying `records`/`datasets`/`sheet_instances`/`projects`/
  `notebook_templates` rows for labels and routes exclusively through
  `src/lib/navigation.ts` helpers (`recordDestination`, `sheetPath`,
  `datasetPath`, `projectPath`, `notebookTemplatePath`). Archived, deleted,
  retired and no-longer-resolvable objects are dropped, so recents never link
  somewhere the user cannot go.
- **Surface.** The home route renders a compact "Recent" section (grid, 20
  cap) between quick actions and the work panels, with kind icon, canonical
  label, identifier, relative last-activity time and an
  Edited/In review/Viewed badge. No app-shell changes; NAV surfaces and
  destinations are untouched.
- **Boundaries honoured:** PostgreSQL/RLS stays authoritative (views are
  server-persisted per user; edit/review signals come from the audited trail);
  stable IDs only — no label-based identity; no shadow model for discovery;
  FIND-02 favourites and FIND-03 discovery are not started.

## FIND-02 — Favourites & Saved Context

### Goal
Let users deliberately pin important scientific work for fast return.

### Scope
- favourite/unfavourite canonical objects;
- user-scoped persistence and RLS;
- navigation/search integration;
- clear behaviour for archived/retired/deleted objects.

### Exit
Favourites persist across sessions, respect visibility/lifecycle, and do not duplicate or own the underlying scientific object.

### Implemented contract

- **One thin per-user pin table.** `api.user_favourites` (migration
  `0155_find_02_user_favourites`): `(user_id, object_kind, object_id,
  created_at)`, unique per user/kind/object, same five-kind check constraint
  as `recently_viewed` (`record | dataset | sheet | project |
  notebook_template`). A favourite is only a (kind, uuid) pair plus a
  timestamp — it never owns, duplicates or mutates the underlying scientific
  object, and identity is stable IDs only, never labels.
- **Writes go through one SECURITY DEFINER RPC.** `set_record_favourite(
  p_object_kind, p_object_id, p_favourite)` has two paths. Removal
  (`p_favourite = false`) deletes the CALLER-OWNED pin immediately, BEFORE
  any object-resolution or membership check, so users can unfavourite
  objects that have since been deleted or whose workspace they left; the
  `user_id` predicate makes it impossible to remove another user's favourite.
  Creation (`p_favourite = true`) resolves the object's workspace from its
  canonical table, verifies `api.is_workspace_member`, then upserts
  (preserving the original `created_at` — re-starring never moves a favourite
  to the top). Unknown or no-longer-visible objects return NULL
  and are ignored, never errors. Deleted records resolve to no workspace and
  can no longer be (re)favourited, but they CAN be unfavourited. No retention
  cap: favourites are deliberate and persist until the user unfavourites.
  Direct INSERT/UPDATE/DELETE is revoked; the table and RPC are revoked from
  `anon`/`api_client`, and favourites are NOT in the external-token
  allowlists (`src/lib/external-token.ts` untouched — fail-closed by
  default). Migration generated with `pnpm db:generate` (clean delta over
  the 0154 checkpoint — no earlier hand-authored DDL re-emitted), with the
  RPC/grants/RLS hand-authored per the 0154 pattern. **Not yet executed
  against a database** — this environment has no PostgreSQL; run
  `pnpm db:migrate` before deploy.
- **RLS requires continued workspace visibility.** The
  `user_favourites_select` policy is
  `user_id = api.current_user_id() AND api.is_workspace_member(workspace_id)`:
  the user_id predicate alone would keep exposing favourite metadata (kind,
  object id, workspace id, timestamps) to a former member after workspace
  access was revoked. No drizzle snapshot change was needed — RLS policies
  are not captured in snapshots (same as every earlier hand-authored policy).
- **Toggle UX.** `FavouriteToggle`
  (`src/components/favourites/favourite-toggle.tsx`) renders a star in the
  page header of the five surfaces FIND-01 tracks views on:
  `records/$recordId` (record header actions), `projects/$projectId`
  (project header), `datasets` (explorer header actions),
  `templates` (via a new optional `headerActions` slot on
  `VersionedNotebookTemplatePanel`), and `sheets/$instanceId` (shell
  top-bar `primaryAction` slot — the Sheet workspace is full-bleed with no
  page header). Optimistic via TanStack Query cache updates with rollback
  and a surfaced inline error; a failed write never blocks the page. The
  pre-existing templates-route localStorage "favourites" filter (protocol
  template catalogue list filter) is untouched and unrelated.
- **Home surface.** A "Favourites" section on the home route above "Recent":
  persistent across sessions, deterministic ordering `created_at` desc with
  a kind-then-id tiebreak, capped at 12 (`FAVOURITES_LIMIT`), with a
  per-item remove-star control. The cap applies to RESOLVED items:
  `fetchFavouriteItems` resolves a wider window (40 raw favourites) first,
  so hidden archived/retired/deleted favourites do not consume the visible
  budget. Unfavouriting (star on an object page, the remove control here,
  or from a workspace the user has since left) is the only removal path.
- **Lifecycle at read time.** `resolveFavouriteItems` in
  `src/lib/favourites.ts` batch-fetches canonical labels and drops archived,
  deleted, retired and no-longer-resolvable objects — a favourite of a
  since-archived object is HIDDEN, not deleted; restoring the object brings
  the favourite back, and destinations come exclusively from
  `src/lib/navigation.ts` helpers so favourites never link somewhere the
  user cannot go.
- **Navigation/search integration kept minimal.** Favourites surface in the
  ⌘K command palette (`src/components/app-shell.tsx`): a "Favourites"
  group above Actions listing the same resolved items the home section uses
  (canonical labels/destinations, `FAVOURITES_LIMIT` cap, queried via the
  shared `favouritesQueryKeys.items()` cache only while the palette is
  open; failures render no group, never an error UI). No app-shell nav
  changes (NAV owns navigation structure) and no parallel search model —
  the star toggle on each object page, the home section, and the palette
  group are the integration.
- **Boundaries honoured:** PostgreSQL/RLS stays authoritative (server-side
  per-user persistence through the RPC, RLS-scoped reads); no saved
  searches/views (GRID-04 owns Sheet presentation state); no recents
  changes beyond reading the same kind vocabulary; `NEXT.md` untouched.

## FIND-03 — Contextual Discovery & Related Work

### Goal
Surface relevant related scientific objects from existing identity/relationship/provenance data.

### Scope
- related Records/Datasets/Notebooks/Sheets/files/figures;
- project/model/schema/provenance-aware discovery;
- transparent reasons for suggested related items where practical;
- augment the canonical global search rather than replacing it.

### Exit
Users can discover meaningfully related work from object context, with every result resolving to a canonical object under normal permissions.

## Boundaries

- PostgreSQL/RLS remains authoritative for visibility.
- Do not create a shadow knowledge graph solely for discovery.
- Search ranking/recents/favourites may be user-specific, but scientific identity and relationships are not.
