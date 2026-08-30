# FIND — Contextual Discovery, Recents & Favourites

**Status:** planned; not active until promoted by `docs/knowledge/NEXT.md`.

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
