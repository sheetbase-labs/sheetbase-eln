# FIND — Contextual Discovery, Recents & Favourites

**Status:** active; FIND-01 completed 2026-08-31.

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
  objects per user. Direct INSERT/UPDATE is revoked; SELECT is
  RLS-locked to `user_id = api.current_user_id()`. Unknown or no-longer-visible
  objects are ignored, never errors. Object pages record a view through the
  `useRecentViewTracking` hook (`src/lib/recents.ts`); the write is
  fire-and-forget and can never disturb the page.
- **Ordering is deterministic:** per object, last activity =
  max(viewed_at, latest edit, latest review); the displayed signal is the
  newest of the three (ties resolve edited > reviewed > viewed); sort is
  lastActivity desc with a kind-then-id tiebreak, capped at 20
  (`RECENTS_LIMIT`). All of this lives in pure functions in
  `src/lib/recents.ts` (`buildRecentItems`, `signalEventsFromChangeEvents`,
  `resolveRecentItems`).
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
