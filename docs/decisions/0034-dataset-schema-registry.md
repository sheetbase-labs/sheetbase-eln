# 0034. Dataset schema registry — central reusable scientific data models

- **Status:** accepted
- **Date:** 2026-07-23
- **Ticket:** DATA-007 (and a new SCI-010 to be added)

## Context

The product goal, restated by the user, is to behave like "a better Benchling":
as much scientific data as possible should be backed by a central, typed,
permission-managed schema layer. Operators should be able to manage, version
and retire schema fields; experiments should be able to select a reusable
workspace schema or create one on the fly; and the API should be able to query
all rows conforming to a schema across every sheet that uses it.

Two schema systems already exist, and both are isolated:

1. `record_field_definitions` (ADR 0026) is a workspace-level typed registry —
   but only for `records.properties` (sample/reagent/protocol metadata). It is
   reusable and central for its scope, but it does not cover scientific sheet
   data.

2. `scientific_tables` + `scientific_columns` (ADR 0019, migration 0013) are
   table-local. Each sheet block owns a separate generated physical table and
   its own column definitions. Columns have no identity beyond their owning
   table. Two sheets that measure "Titer (TU/mL)" create two unrelated
   columns. There is no way to query "every Titer value across every stability
   sheet" because the physical columns have different generated names and no
   shared field identity.

So the missing layer is a **workspace-level dataset schema registry**: a stable
identity for a reusable schema (e.g. "Stability Study Result"), stable field
identities that survive across every sheet that uses them, and a cross-sheet
query path that unions rows by stable field identity rather than by physical
column name.

Forces that conflict:

- **Reproducibility vs. propagation.** A submitted experiment must remain
  reproducible against the schema it was recorded under. Schema field changes
  must not silently reinterpret existing data. But new sheets should be able to
  use the latest schema revision without manual re-entry.

- **Reuse vs. ad-hoc.** Users must be able to select a pre-existing workspace
  schema, but also create a schema on the fly. Ad-hoc schemas must not remain
  anonymous local columns — they should be created in the same central registry
  so they can be discovered and reused later.

- **Central identity vs. physical storage.** Each sheet still needs its own
  physical table (the existing generated-table model works, is RLS-enforced,
  and supports HyperFormula). The registry must not require migrating all sheet
  data into one giant table. The stable field identity is a metadata layer over
  the existing physical storage.

- **Permissions.** Schema management is an operator capability, but "operator"
  in the current role vocabulary means `workspace_memberships.role = 'owner'`
  (ADR 0006). The existing `record_field_definitions` already uses owner-only
  writes and member reads. This decision reuses that model rather than
  introducing a new role.

## Decision

Add a workspace-level **dataset schema registry** as a metadata layer over the
existing per-sheet physical tables. The registry provides stable schema and
field identities; the physical tables remain the storage implementation.

### New tables

**`api.dataset_schemas`** — a reusable, named, versioned schema definition
owned by a workspace.

| Column               | Type              | Notes                                                          |
| -------------------- | ----------------- | -------------------------------------------------------------- |
| `id`                 | uuid PK           | stable schema identity                                         |
| `workspace_id`       | uuid → workspaces | cascade                                                        |
| `slug`               | text              | stable, immutable, workspace-unique (`stability_study_result`) |
| `name`               | text              | human label ("Stability Study Result")                         |
| `description`        | text              |                                                                |
| `revision`           | integer           | immutable once published; starts at 1                          |
| `status`             | text              | `draft` \| `published` \| `retired`                            |
| `created_by_user_id` | text → user       |                                                                |
| `...timestamps`      |                   |                                                                |

Only one `published` revision per `slug` is active at a time. Draft revisions
are editable; publishing freezes the revision number. Retiring a schema
prevents new sheets from binding to it but does not delete it or existing
bindings.

**`api.dataset_schema_fields`** — stable field identities within a schema
revision.

| Column          | Type                   | Notes                                            |
| --------------- | ---------------------- | ------------------------------------------------ |
| `id`            | uuid PK                | stable field identity — the cross-sheet join key |
| `schema_id`     | uuid → dataset_schemas | cascade                                          |
| `workspace_id`  | uuid → workspaces      | cascade                                          |
| `slug`          | text                   | stable, immutable within (schema_id, slug)       |
| `label`         | text                   | human label                                      |
| `description`   | text                   |                                                  |
| `display_order` | integer                |                                                  |
| `logical_type`  | text                   | reuses the 0019 vocabulary                       |
| `nullable`      | boolean                |                                                  |
| `default_value` | jsonb                  |                                                  |
| `unit`          | jsonb                  |                                                  |
| `validation`    | jsonb                  |                                                  |
| `lifecycle`     | text                   | `active` \| `retired`                            |
| `...timestamps` |                        |                                                  |

`(schema_id, slug)` is unique. `slug` and `logical_type` are immutable after
creation (identity guard trigger, same pattern as
`guard_record_field_definitions_identity`). Retiring a field does not delete
historical data; type changes require a new field/revision, not a silent
reinterpretation.

### Binding: sheet → schema

**`api.scientific_tables`** gains two nullable columns:

| Column                    | Type                   | Notes                                         |
| ------------------------- | ---------------------- | --------------------------------------------- |
| `dataset_schema_id`       | uuid → dataset_schemas | nullable; null = legacy unbound sheet         |
| `dataset_schema_revision` | integer                | the published revision the sheet was bound to |

**`api.scientific_columns`** gains one nullable column:

| Column                    | Type                         | Notes                              |
| ------------------------- | ---------------------------- | ---------------------------------- |
| `dataset_schema_field_id` | uuid → dataset_schema_fields | nullable; null = local-only column |

When a sheet is created from a schema, each `scientific_column` is linked to
its source `dataset_schema_field_id`. The physical `field_name`
(`col_<base32>`) remains table-local and generated — it is the storage column
name, not the cross-sheet identity. The stable identity is
`dataset_schema_field_id`.

Ad-hoc columns (created on the fly in a sheet that is bound to a schema) may
have `dataset_schema_field_id = null`; they are local to that sheet. An
ad-hoc schema created on the fly is a `dataset_schemas` row with `status =
draft` (or `published` if the creator chooses); it is not a special case.

### Versioning and upgrade semantics

- **Immutable revisions.** A `published` schema revision is frozen. Adding,
  retiring, or type-changing a field creates a new revision. This preserves
  reproducibility: a sheet bound to revision 2 stays bound to revision 2 even
  after revision 3 is published.
- **Explicit upgrade.** A sheet can be upgraded to a newer revision through an
  explicit RPC (`upgrade_scientific_schema`). Additive changes (new fields)
  are safe; type changes or field retirements require a per-column
  confirmation/migration step. Sheets are not auto-upgraded.
- **Field retirement** sets `lifecycle = retired` and prevents new writes to
  that field, but existing data is preserved. This mirrors the existing
  `retire_scientific_column` contract.

### Permission model

Reuses the existing role vocabulary (ADR 0006): `owner` and `member`.

| Action                                       | Who                                          |
| -------------------------------------------- | -------------------------------------------- |
| List/read schemas and fields                 | any workspace member                         |
| Create a dataset schema (reusable or ad-hoc) | any workspace member                         |
| Publish/retire a schema revision             | workspace owner                              |
| Add/retire fields on a draft revision        | schema creator or workspace owner            |
| Bind a sheet to a schema                     | any workspace member (at sheet creation)     |
| Upgrade a sheet to a newer revision          | any workspace member with write on the sheet |

No new role is introduced. This mirrors `record_field_definitions` (owner
writes the published schema, members read and use it) while allowing members to
create draft/ad-hoc schemas — the "create on the fly" requirement.

### Cross-sheet query API

A new RPC, **`api.query_dataset(p_schema_id, p_revision, p_filters, p_limit,
p_offset)`**, returns a typed, uniform row set across every RLS-visible
scientific table bound to `(schema_id, revision)`. It:

1. Finds every `scientific_tables` row with `dataset_schema_id = p_schema_id`
   and `dataset_schema_revision = p_revision` (RLS-filtered to the caller's
   workspace).
2. For each table, `EXECUTE`s a parameterised `SELECT` that projects the
   physical columns mapped through `scientific_columns.dataset_schema_field_id`
   into a stable JSONB shape keyed by field slug.
3. `UNION ALL`s the per-table results and returns a single typed row set:
   `{ row_id, table_id, record_id, field_values: { <slug>: <value>, ... } }`.

No dynamic table name is ever exposed to the caller. The physical
`resource_name` and `field_name` are internal. The stable, typed surface is
the schema field slug. This is the same safety posture as the existing
generated-table RPCs: identifiers are generated server-side, labels and
user input are never interpolated as SQL.

### REST resources and RPCs

| Resource                                              | Purpose                                              |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `GET /api/db/dataset_schemas?workspace_id=eq.<id>`    | list schemas (RLS)                                   |
| `GET /api/db/dataset_schema_fields?schema_id=eq.<id>` | list fields (RLS)                                    |
| `POST /api/db/rpc/create_dataset_schema`              | create a reusable or ad-hoc schema                   |
| `POST /api/db/rpc/publish_dataset_schema`             | publish a draft revision (owner)                     |
| `POST /api/db/rpc/add_dataset_schema_field`           | add a field to a draft revision                      |
| `POST /api/db/rpc/retire_dataset_schema_field`        | retire a field (owner)                               |
| `POST /api/db/rpc/instantiate_dataset_schema`         | create a scientific table bound to a schema revision |
| `POST /api/db/rpc/upgrade_scientific_schema`          | upgrade a sheet to a newer revision                  |
| `POST /api/db/rpc/query_dataset`                      | cross-sheet typed query by schema id + revision      |

`create_scientific_table` is extended: if `p_dataset_schema_id` is provided,
the columns are cloned from the schema's published revision and each
`scientific_column` is linked to its `dataset_schema_field_id`. If omitted,
the existing ad-hoc behaviour is preserved.

### Legacy migration strategy

Existing `scientific_tables` rows have `dataset_schema_id = null` and
`dataset_schema_revision = null` — they are **legacy unbound sheets**. They
continue to work unchanged. A backfill migration creates one
`dataset_schemas` row (status `published`, revision 1) per distinct existing
sheet, with fields cloned from its `scientific_columns`, and links the table
and columns to it. This is opt-in per sheet (a backfill RPC), not forced, so
the live demo database is not disrupted. Unbound sheets are still queryable
through the existing per-table RPCs; `query_dataset` simply does not include
them until they are bound.

## Alternatives considered

1. **Copy schema columns into each sheet (no registry).** Rejected — loses
   durable cross-sheet field identity. Two "Titer" columns are unrelated, so
   cross-sheet query is impossible without fragile label matching.

2. **One giant shared physical table per schema.** Rejected — breaks the
   existing per-sheet RLS, HyperFormula, and generated-table model; requires
   migrating all sheet data; couples every sheet's storage.

3. **Materialised cross-sheet index table updated by triggers.** Rejected for
   now — adds indexing delay and stale-result surface (the same reasons SCI-008
   chose real-time FTS). `query_dataset` runs against current committed data
   per call. A materialised rollup could be added later if query-time
   performance at scale demands it.

4. **Extend `record_field_definitions` to cover sheet data.** Rejected —
   `record_field_definitions` is scoped to `records.properties` for a record
   kind; sheet data is row-oriented, not property-oriented. Conflating the two
   would break the existing contract and the `kind` check constraint.

5. **Introduce a new `operator` role.** Rejected — the existing `owner`/`member`
   vocabulary is sufficient. Owners publish/retire schemas; members create
   drafts and use schemas. Adding a role now is scope creep that touches auth,
   RLS, and the UI without a clear benefit.

## Consequences

**Easier:**

- Cross-sheet queries by stable schema identity — the core "better Benchling"
  requirement.
- Schema reuse: create once, instantiate in many experiments/projects.
- Ad-hoc schemas become discoverable and reusable instead of anonymous.
- Centralised, permission-managed schema lifecycle (draft → published →
  retired) with audit attribution via existing `emit_change_event`.

**Harder:**

- One more metadata layer to maintain (dataset_schemas, dataset_schema_fields,
  bindings). The physical storage model is unchanged, but the registry must
  stay consistent with `scientific_columns`.
- Schema upgrades are explicit and require care for type changes and field
  retirements.
- Cross-sheet query performance at very large scale may eventually need a
  materialised rollup (deferred).

**Forbidden:**

- Silently reinterpreting existing data when a field type changes.
- Exposing physical `resource_name` / `field_name` to the API surface.
- Auto-upgrading bound sheets without an explicit upgrade call.
- Deleting retired fields or schemas (retirement is soft, data is preserved).

## Open questions (to settle before implementation)

1. Should ad-hoc schemas default to `draft` or `published`? (Proposal: `draft`
   — the creator can publish if they want reuse; this matches "create on the
   fly" without prematurely committing a workspace-wide schema.)
2. Should `query_dataset` support cross-revision queries (union of revisions)
   or only a single revision? (Proposal: single revision only for the initial
   implementation; cross-revision is a later enhancement.)
3. Should the backfill be automatic on migration or an explicit per-sheet RPC?
   (Proposal: explicit RPC, to avoid disrupting the live demo database.)
