# 0019. Scientific table and generated-resource contract

- **Status:** accepted
- **Date:** 2026-07-19
- **Ticket:** DATA-001

## Context

Phase 4 adds editable scientific sheets backed by PostgreSQL and exposed by
PostgREST. Before creating metadata or management functions, Sheetbase needs a
durable contract for the identity of tables, columns and rows; the relationship
between user-facing labels and SQL names; supported scientific types and
validation; safe schema evolution; and the boundary between direct CRUD and
transactional RPCs.

The contract is constrained by existing decisions:

- PostgreSQL and row-level security are authoritative. The browser and external
  API clients use the same PostgREST resources and claims (0002, 0005, 0006).
- Only the `api` schema is exposed to PostgREST. Privileged helpers live in
  `internal`, pin `search_path = ''`, and receive narrow grants
  (`docs/development/database-access.md`).
- Stable identifiers are separate from mutable display names, and published
  REST fields are not silently renamed (`docs/development/conventions.md`).
- A notebook is a record's ordered blocks; the Phase 4 sheet is a `sheet` block
  whose payload points to table metadata rather than containing the dataset
  (0015).
- Every durable mutation, including direct PostgREST CRUD, must produce a
  transactional, attributable change event suitable for live reconciliation
  (0016, 0017).
- HyperFormula formulas are durable definitions. A calculated value may be a
  cache, but is never the sole authoritative representation of a calculation
  (`ROADMAP.md`).

The approved Dataset Explorer mockup reinforces the separation between data and
metadata: headers show a label, unit and logical type; formulas use approachable
labels; schema, relationships and lineage are separate views; and the UI shows
row/column counts, selection, filters, calculations and save state. The Virus
Stability notebook mockup shows a compact sheet block in the continuous document
with `Timepoint (days)`, `Replicate`, `Volume (µL)` and `Storage condition`, plus
an “Open as table” path to a larger editor.

The repository does not contain or link a separate `db-api` implementation that
can be treated as source code. The applicable precedent is therefore the
existing Sheetbase database API: generated resources use the same exposed
schema, same-origin proxy, external credentials, PostgREST query semantics,
stable error envelope, RLS policy shape, direct-CRUD default and transactional
RPC exception as projects and notebook records. DATA-003 documents the new
resources in the same style as `docs/api/notebook-api.md`.

## Decision

### 1. A sheet block points to one scientific table

A **scientific table** is a workspace-owned metadata object with one generated
PostgreSQL relation. A `sheet` block owns exactly one table and stores only the
stable table identifier plus block-level presentation preferences. Rows, column
definitions, formulas and calculated results never live in the block JSON.

A table belongs to the same workspace and notebook record as its owning block.
The database enforces that chain; clients cannot attach an existing table to a
block in another workspace or record. A table can later be viewed in Dataset
Explorer without copying it or changing ownership.

### 2. Stable identities and generated names

Identity, API naming and display naming are separate:

| Object  | Stable relational identity | Published REST identity                                                | Mutable display state                    |
| ------- | -------------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| table   | UUID `id`                  | `resource_name`, generated as `sheet_<26 lowercase base32 characters>` | `name`, description, display settings    |
| column  | UUID `id`                  | `field_name`, generated as `col_<26 lowercase base32 characters>`      | label, description, display order, width |
| row     | UUID `id`                  | `id` in the generated resource                                         | grid position is derived, never identity |
| formula | UUID `id`                  | target `(table_id, row_id, column_id)` and stable dependency ids       | rendered expression may use labels       |

The base32 suffix is generated from 128 random bits by a controlled database
function. It is lowercase, starts with a letter through the fixed prefix, is
well under PostgreSQL's 63-byte identifier limit and has a unique constraint;
collisions are retried. UUIDs are immutable, opaque relational identifiers used
in metadata responses, sheet block payloads, formula targets and RPC arguments;
they are not user-facing route names. This explicit use is necessary for stable
cell relationships and is narrower than the convention against exposing raw
UUIDs as human-facing URLs. Generated resource and field names are the immutable
REST route/field identities shown by the API inspector.

User input is never converted into an executable identifier. Table and column
labels can contain spaces, punctuation, Unicode, units and duplicate text.
Renaming a label changes metadata only. Reordering a column changes
`display_order` only. Neither operation renames a PostgreSQL object, changes a
REST URL/field, or rewrites a stable formula dependency.

All generated relations live in the explicitly managed `api` schema because it
is the sole PostgREST schema. Their names must match the exact generated-name
grammar. Metadata and management functions reject any caller-supplied resource,
field, schema, type, cast, operator or constraint fragment. Privileged DDL uses
`format('%I', identifier)` for identifiers, fixed schema qualification and
allow-listed SQL templates; quoting is required even after validation.

Every generated row has reserved fields that cannot collide with user columns:

| Field                        | Contract                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `id`                         | immutable UUID primary key, database-generated                                        |
| `workspace_id`               | immutable tenancy key, defaulted from the request claim                               |
| `version`                    | positive bigint optimistic-concurrency version                                        |
| `created_at`, `updated_at`   | database timestamps                                                                   |
| `formula_column_ids`         | database-maintained UUID set identifying cells whose literal is replaced by a formula |
| user/credential actor fields | actor attribution from request claims                                                 |

Reserved names never use the `col_` prefix. UUIDs, machine names,
`workspace_id`, creation fields and formula markers are protected by database
immutability guards. A row's visual order is a query/view concern; it is not
persisted as row identity.

Each generated relation is permanently bound to the owning workspace recorded
in its metadata. Its physical definition includes a fixed
`CHECK (workspace_id = <owning workspace UUID>)`; its RLS predicates require the
request workspace, owning workspace and row workspace to agree. Browser policies
also require membership in that workspace, and `api_client` policies require the
credential's pinned workspace to own the relation. A caller from workspace B
therefore cannot insert workspace-B rows into workspace A's physical relation.

### 3. Column metadata and supported types

Each column has a logical type, an allow-listed PostgreSQL storage type,
nullability, optional typed default, optional structured unit, structured
validation, category constraints and lifecycle state. Phase 4 supports:

| Logical type | PostgreSQL storage | Supported validation                                          |
| ------------ | ------------------ | ------------------------------------------------------------- |
| `text`       | `text`             | min/max length; anchored regular expression                   |
| `integer`    | `bigint`           | inclusive/exclusive min and max                               |
| `decimal`    | `numeric`          | inclusive/exclusive min and max; optional precision and scale |
| `boolean`    | `boolean`          | nullable/required                                             |
| `date`       | `date`             | earliest/latest date                                          |
| `timestamp`  | `timestamptz`      | earliest/latest instant                                       |
| `category`   | `uuid`             | membership in an ordered metadata vocabulary                  |

`number` in the UI means `decimal`; the UI names `integer` separately when
fractional values are invalid. Dates are calendar dates without timezone.
Timestamps are instants stored with timezone and rendered in the user's locale.
Empty text is not coerced to null. NaN and infinities are not accepted as
decimal values.

Units are structured metadata, not label suffixes or mixed into numeric cell
strings. A unit has a required canonical code and symbol plus an optional
quantity/kind and vocabulary reference. Phase 4 does not perform implicit unit
conversion: values in one column share its declared unit, and changing that unit
without converting values is an explicit metadata change with a warning. The
label may include the symbol for readability, but the inspector and exports read
the structured unit.

Defaults are typed JSON values validated against the logical type before DDL.
Defaults are limited to literals; arbitrary SQL expressions are forbidden.
`now` is the single explicit dynamic default and is valid only for `timestamp`.
A default applies to new rows and does not silently backfill old nulls.

Validation is enforced at PostgreSQL as a generated `CHECK`, `NOT NULL`, or
foreign-key-equivalent category constraint wherever possible. Handsontable and
the application repeat the same metadata rules for immediate feedback, but they
are never the sole boundary. Validation metadata is declarative—clients cannot
supply SQL expressions. Categories have stable UUID identities and mutable
labels; the physical cell stores the category identity, not its label, so a
category rename preserves meaning. A controlled database trigger verifies that
a category is active and belongs to the exact column and owning workspace; a
foreign key to an option UUID alone is insufficient.

Column lifecycle is `active | retired`. Retired metadata and stable identities
remain queryable for history, formula dependency explanations and imports, but
retired fields are hidden from default grid views and cannot receive new writes.

### 4. Safe schema evolution

All physical-schema changes run through narrowly granted transactional
management RPCs. Callable entrypoints live in `api`; supporting DDL and trigger
helpers live in `internal`. DDL entrypoints are narrowly granted
`SECURITY DEFINER` functions that pin `search_path = ''` and explicitly validate
the workspace claim, browser membership or credential scope, ownership and
expected `schema_version` before doing owner-level work. They never rely on RLS
inside the definer function.

The RPC locks table metadata, performs metadata and DDL in one PostgreSQL
transaction where PostgreSQL permits, increments `schema_version`, emits one
attributable schema-change event and queues
`pg_notify('pgrst', 'reload schema')`. PostgreSQL delivers the notification only
after successful commit; rollback emits nothing. PostgREST reloads its schema
cache asynchronously, so DDL success does not guarantee that the new REST
resource is immediately routable. DATA-003 must use bounded readiness probes and
show cache-reload delay/failure as a recoverable unavailable state. Every
PostgREST instance must receive the reload signal.

| Change                         | Contract                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| add column                     | Add metadata and physical field atomically. A required column on a populated table needs a typed default/backfill plan.                                                                    |
| rename label                   | Metadata-only. `field_name` is unchanged.                                                                                                                                                  |
| reorder                        | Metadata-only `display_order` change.                                                                                                                                                      |
| change validation/default/unit | Preflight existing data and formula dependants; reject invalidating changes unless an explicit supported conversion/backfill plan succeeds.                                                |
| compatible conversion          | Allow-listed cast into a server-named shadow field, validate every row, then atomically swap only the physical backing fields while preserving the column UUID and published `field_name`. |
| incompatible conversion        | Reject with row counts/examples. The user may create a new column and migrate explicitly; never use a lossy implicit cast.                                                                 |
| retire column                  | Mark retired after dependency inspection and explicit confirmation; keep identity and data. No immediate `DROP COLUMN`.                                                                    |
| physical purge                 | Deferred operational action outside Phase 4, allowed only after retention, dependency and recovery checks.                                                                                 |

Changing a logical type, retiring a column, removing a category, changing unit
semantics, or removing a source table is destructive when data, formulas or API
clients depend on it. The management RPC returns a preflight report; the caller
must resubmit its hash as explicit confirmation so confirmation applies to the
state actually inspected. The confirmed conversion RPC acquires a write-blocking
lock on the generated relation, rechecks `schema_version`, recomputes the
preflight and hash under that lock, and rejects changed evidence before
converting. Display-only changes do not require confirmation.

Published `resource_name` and `field_name` values are immutable in Phase 4.
Future API renaming, if ever required, is additive: expose a compatibility view
or alias for a documented deprecation window rather than silently renaming a
resource.

### 5. Direct CRUD versus transactional RPCs

The generated table is a normal PostgREST resource. Subject to scope, grants,
RLS and database constraints, clients use direct CRUD for:

- paginated, filtered and ordered row reads;
- inserting one or more independent rows when ordinary PostgREST transaction
  semantics are sufficient;
- updating literal fields on a row with `id` and expected `version`;
- deleting rows that have no protected formula dependencies.

Optimistic updates and deletes include both `id=eq.<row-id>` and
`version=eq.<expected-version>`. A trigger increments `version` and
`updated_at`. The same-origin boundary requests canonical representations with
at-most-one-row semantics and maps an empty mutation result to the stable
conflict envelope rather than accepting PostgREST's default zero-match `204` as
success.

Request roles receive table-level `SELECT` and permitted `DELETE`, but only
column-level `INSERT` and `UPDATE` grants for active literal fields. They never
receive table-wide `INSERT`/`UPDATE`; reserved, retired and formula-marker fields
are excluded from writable-column grants. `workspace_id`, UUID identities,
machine names and creation fields additionally have database immutability
guards. RLS compares every row's `workspace_id` to the relation owner and active
claim, and verifies membership for browser sessions; external `api_client`
claims are pinned to the owner workspace. No exposed relationship permits a
join to another workspace.

Transactional RPCs are required for:

- table creation and every schema change;
- atomic paste, fill, import and other all-or-report bulk edits;
- formula create/update/remove operations;
- operations that replace a formula with a literal or a literal with a formula;
- category vocabulary changes affecting existing rows;
- dependency-sensitive row/column/table retirement or deletion;
- type conversion, backfill and multi-row transformations;
- any operation requiring multiple metadata/data writes or one coherent audit
  outcome.

RPCs accept stable IDs and typed JSON, never SQL fragments. They use explicit
expected table/schema/row/formula versions and return canonical changed rows,
versions and structured per-cell validation errors so the UI can reconcile
without guessing. Bulk writes are atomic by default. CSV import may use a
staged, explicitly resumable workflow for large files, but a committed chunk is
never partially applied.

### 6. Literal cells, formula definitions and calculated outputs

A cell target is the stable tuple `(table_id, row_id, column_id)`, never a grid
coordinate. A cell contains either a literal source value or a formula
definition, not both:

- literals are stored in the generated relation's typed `col_…` field;
- formulas are stored separately with their target identity, durable canonical
  expression, syntax/engine version and formula version;
- dependency edges store stable source table, row and column identities;
- optional calculated results are separate caches with typed result/error,
  formula version, input revision, schema revision, status and calculated time.

The generated row's reserved `formula_column_ids` marker serializes the
literal/formula exclusion on the same row as direct literal updates. Formula
creation locks the row, atomically marks the target column, clears its literal
and inserts the definition. Formula removal locks the row, removes the marker
and either leaves the target null or writes an explicit replacement literal in
the same RPC. A generated-relation trigger rejects a non-null literal whose
column is marked as a formula target. Direct roles cannot alter the marker, so a
literal PATCH and formula RPC cannot commit a state containing both.

Handsontable coordinates and friendly formula labels are presentation. The
workbook adapter resolves them against current metadata and persists stable
references. A sheet/column/category label rename changes only rendered formula
text. Reordering rows or columns changes coordinate translation, not dependency
identity. Cross-sheet references are limited to sheet blocks in the same
notebook record; the database rejects cross-notebook and cross-workspace
dependencies.

Raw row CRUD returns authoritative literals. Formula and result resources expose
definitions and cache state separately; a composed sheet read used by the grid
and API inspector labels each cell as `literal`, `formula`, `current`, `stale`,
`failed` or `unavailable`. A cache is current only when its formula, input and
schema revisions match. It is never presented as source data.

CALC-001 settles the HyperFormula syntax, allow-list, recalculation and server
trust policy without changing these storage distinctions.

### 7. Events and live reconciliation

Triggers on generated row tables emit workspace-scoped durable events for
insert, update and delete regardless of whether the caller is the browser or an
external API client. Events contain table and row identity, changed column IDs,
row version, actor and client identity, but never full scientific row values.

DATA-002 extends the durable event vocabulary before producing these events:
`scientific_table`, `scientific_row`, `formula` and `calculation` are stable
entity types. Existing `create | update | delete` operations are reused where
possible; the precise schema/calculation operation belongs in the lightweight
payload. `change_events` gains nullable `actor_credential_id` alongside
`actor_user_id`. The emitter accepts either `sub` or `credential_id` and skips
only requests with neither. Generated-row attribution likewise has nullable
user and credential actor fields so external writes remain attributable.

Management RPCs emit schema events containing table identity, schema version,
operation and affected column IDs. Formula and calculation operations emit their
own lightweight events. LIVE-003 adds mappings for the new entity types before
sheet UI depends on them and uses their identities to invalidate only the
affected sheet metadata, page, formulas or results. Failed transactions emit
nothing.

## Consequences

- DATA-002 adds metadata for tables, columns and categories, generated relation
  management, RLS/grants, row/schema versions and durable event triggers. It
  must prove invalid identifiers, rollback and two-workspace isolation.
- DATA-003 can expose every generated relation through the existing
  `/api/db/<resource_name>` proxy without adding a route per table. Metadata is
  discoverable through stable ordinary resources or read-only views.
- SHEET-002 stores only a scientific-table identifier in a typed `sheet` block
  payload and composes typed literals, formulas and cache status for the grid.
- Display label changes and column reorder are cheap metadata edits. Published
  REST names and formula dependencies remain stable.
- The physical schema is intentionally not a user-controlled namespace. Users
  configure scientific meaning; Sheetbase controls every executable name and
  SQL template.
- Retiring is deliberately easier than dropping. This consumes storage but
  preserves API, formula, audit and future review evidence.
- Formula persistence can evolve independently from generated row storage while
  keeping PostgreSQL literals authoritative and calculated caches explicitly
  non-authoritative.
