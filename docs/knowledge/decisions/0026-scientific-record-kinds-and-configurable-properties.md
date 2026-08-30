# 0026. Scientific record kinds and configurable properties

- **Status:** accepted
- **Date:** 2026-07-21
- **Ticket:** SCI-001

## Context

Phase 5 begins by making samples, reagents and protocols first-class,
linkable scientific objects inside the existing notebook record platform.
The Virus Stability concept links samples and a protocol into an experiment
notebook; the Samples Registry and Reagents Registry mockups show them as
TanStack Table registry views with type-prefixed identifiers, statuses and
scientific fields (type, construct, batch, concentration, supplier, catalog
number, lot, expiry, quantity, unit, storage).

Decision 0015 already fixes the durable shape this work must fit:

- `records.kind` is a text column with a check constraint; **new kinds are
  added by widening the check, not by adding tables.**
- `protocol_template` is already a notebook-backed record kind (`PRT-`
  identifiers, blocks for procedure steps and materials). The Protocol
  Template (Titration Assay) mockup is exactly that kind.
- `record_links.link_type` already includes `sample`, `reagent` and
  `protocol`, and `target_record_id` is nullable so a link can render
  honestly when the target is missing, soft-deleted or permission-restricted.
- Stable identifiers are project-scoped, type-prefixed and immutable; display
  titles change freely.
- `records.status` is free-form text validated at the application boundary,
  so new kinds can introduce their own vocabulary without a migration.
- Soft archival uses `archived_at` (reversible); soft deletion uses
  `deleted_at` (tombstone). Archive/restore already have RPCs.
- Every durable mutation, including direct PostgREST CRUD, emits a
  transactional attributable change event through the existing table trigger
  (0016). RLS is the access-control boundary (0006).

The forces SCI-001 must reconcile:

- Samples and reagents are registry objects, not block documents. Their
  scientific content is a set of typed fields, not an ordered notebook. But
  they must share identity, ownership, permissions, links, audit and events
  with experiment and protocol records rather than spawning a parallel system.
- The scientific fields are domain-specific (plasmid concentration, viral
  vector lot, catalog number) and must not become universal columns on
  `records`. The ticket forbids baking biotech-specific fields into global
  infrastructure.
- Different workspaces will track different fields. The schema must be
  workspace-configurable, not global.
- Phase 4 already established a typed scientific column vocabulary
  (`text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category`)
  with `unit` and `validation` JSONB (0019). Inventing an incompatible
  property-typing system would fracture the platform.
- Protocols already exist as `protocol_template` records. SCI-001 must not
  duplicate that kind or split protocol identity.

## Decision

### 1. Samples and reagents are new `records.kind` values; protocols reuse `protocol_template`

The check constraint on `records.kind` is widened to add `sample` and
`reagent`. `protocol` is **not** a new kind: protocols are the existing
`protocol_template` kind (notebook-backed, `PRT-` identifiers). All three are
first-class records that share the existing identity, workspace/project
ownership, RLS, change events, audit attribution, links, archive and
revision machinery.

Samples and reagents are registry objects: their primary content is a set of
configurable typed properties (§2), not an ordered block document. They may
still own blocks (notes, attachments) because `records` is polymorphic, but
the registry view renders properties, not blocks. Protocol templates remain
block documents whose primary content is procedure steps and materials; they
additionally carry configurable properties (version, approval metadata) so
they sit alongside samples and reagents in the picker and inspector.

This answers the contract question directly: samples, reagents and protocols
are **record kinds within the existing record infrastructure**, not owned
subtype tables. No parallel identity, permission, event or audit system is
introduced.

### 2. Configurable typed properties via `record_field_definitions` + `records.properties`

A new workspace-owned `record_field_definitions` table defines the
configurable property schema per record kind. A new `properties` JSONB
column on `records` stores the actual values. This mirrors how
`scientific_columns` defines columns and a generated relation holds values
(0019), but for record properties instead of sheet rows.

`record_field_definitions` columns: `id`, `workspace_id`, `kind`
(`sample`/`reagent`/`protocol_template`/future kinds), `field_name` (stable
slug, unique per workspace+kind), `label`, `description`, `display_order`,
`logical_type` (reuses the scientific vocabulary
`text`/`integer`/`decimal`/`boolean`/`date`/`timestamp`/`category`), `unit`
(JSONB), `validation` (JSONB), `nullable`, `default_value` (JSONB),
`lifecycle` (`active`/`retired`), timestamps and `created_by_user_id`. Unique
on `(workspace_id, kind, field_name)`.

`records.properties` is a flat JSONB object keyed by `field_name`. It is
validated against the workspace's active field definitions for the record's
kind. Validation is layered so neither boundary is the sole enforcement
point:

- The **application boundary** (`src/lib/scientific-records.ts`) gives the
  UI clear, typed errors and drives the picker/inspector, exactly as block
  `payload` is validated against `(type, payload_schema_version)`.
- The **database boundary** is authoritative: a `SECURITY INVOKER`
  `validate_record_properties` trigger on `records` (INSERT, and UPDATE of
  `kind`/`properties`/`workspace_id`) checks every active field definition
  for the record's kind — non-nullable presence, `logical_type` type-checks,
  and `category` enum membership — so direct PostgREST CRUD cannot bypass
  validation. It raises `SB005 invalid_properties` (mapped to HTTP 422).

The schema is not enforced by a hard-coded check constraint (the set of
fields is workspace-configurable and evolves without migrations); the
trigger reads the configurable `record_field_definitions` at validate time.
The database also enforces workspace isolation and kind membership via RLS
and the widened check.
Retiring a field definition does not delete historical values: the value
remains in `properties` and the inspector renders it with its last known
label, mirroring how retired scientific columns remain readable.

Field definitions are workspace-admin managed (owner-only writes under RLS);
all members read them. They are seeded for the Virus Stability fixture so the
demo records carry realistic fields without runtime configuration.

### 3. Stable identifiers

Identifiers remain project-scoped, type-prefixed, immutable and assigned by
`create_record`:

| Kind              | Prefix | Example                    |
| ----------------- | ------ | -------------------------- |
| sample            | `SMP`  | `SMP-2025-0001`            |
| reagent           | `RGT`  | `RGT-2025-0001`            |
| protocol_template | `PRT`  | `PRT-2025-0001` (existing) |

The `create_record` RPC's kind-to-prefix CASE is widened for `sample` and
`reagent`. The per-(project, prefix, year) sequence is unchanged, so sample
and reagent identifiers share the same assignment mechanism as experiments
and protocols.

### 4. Lifecycle: statuses, archive and status transitions

Two layers, kept distinct as in 0015 §6:

- **Archive/restore** (reversible soft archival) uses the existing
  `archive_record`/`restore_record` RPCs and the `archived_at` column. These
  already work for any record kind. Archived records are excluded from
  default lists but remain readable by workspace members; links to archived
  targets remain resolvable because `record_links.target_identifier` is
  preserved.
- **Status transitions** use a new `transition_record_status` RPC. Each kind
  has a transition matrix enforced at the database so a stale or hostile
  client cannot move a record to an incoherent state. Initial matrices:
  The vocabularies match the concept-system `StatusBadge` domains (UI-005)
  and the Samples/Reagents registry mockups; they are intentionally richer
  than a minimal available/in_use/depleted lifecycle so the UI can render
  realistic registry states. Initial matrices:
  - sample (`available`, `reserved`, `consumed`, `expired`, `quarantined`,
    `frozen`): `available` to `reserved`/`consumed`/`quarantined`; `reserved`
    to `available`/`consumed`; `quarantined` to `available`. `expired` and
    `frozen` are terminal/external inventory states — set via direct PATCH,
    not driven by the transition RPC.
  - reagent (`available`, `reserved`, `consumed`, `expired`, `quarantined`,
    `low_stock`): `available` to `reserved`/`consumed`/`quarantined`/`expired`;
    `reserved` to `available`/`consumed`; `quarantined` to `available`.
    `low_stock` is a display-derived inventory state — set via direct PATCH,
    not a transition target.
  - protocol_template: `draft` to `active`/`under_review`; `under_review` to
    `active`/`draft`; `active` to `draft`.
  - experiment/report: unchanged (free-form status, no transition RPC
    required for SCI-001).

  The RPC bumps `metadata_version`, stamps `updated_by_user_id`, and the
  existing trigger emits change events. Unknown kinds or disallowed
  transitions raise `SB004 invalid_transition`.

### 5. REST surface

Samples, reagents and protocols are exposed through the same `/api/db`
boundary as existing records. No new proxy classification is needed: `records`
and `record_field_definitions` are project-domain resources; the new RPC
joins the project-domain RPC allowlist.

- `GET /api/db/records?kind=eq.sample&...` — direct CRUD, RLS-isolated.
- `POST /api/db/rpc/create_record` — widened to accept `sample`/`reagent` and
  an optional `p_properties` JSONB argument.
- `POST /api/db/rpc/transition_record_status` — new lifecycle RPC.
- `archive_record`/`restore_record`/`create_record_link` — unchanged, work
  for all kinds.
- `GET/POST/PATCH /api/db/record_field_definitions` — direct CRUD for the
  configurable schema (owner-only writes via RLS).

Direct PostgREST PATCH on `records` remains safe under RLS and emits change
events via the existing trigger; clients should set `updated_by_user_id` for
attribution, and the lifecycle RPC is preferred for status changes so the
transition matrix is enforced.

### 6. Cross-workspace link rejection and archived references

The existing `create_record_link` RPC already validates that a referenced
target record exists in the same workspace (RLS makes cross-workspace records
invisible, and the RPC raises `SB002 missing_link` for an unresolved target).
SCI-001 adds no new link machinery; it reuses `record_links`, the
`sample`/`reagent`/`protocol` link types, and the preserved
`target_identifier` so links to archived, soft-deleted or
permission-restricted targets render honestly through `RecordLink`'s
`available`/`missing`/`deleted`/`permission-restricted` states.

### 7. Audit and durable events

No new event or audit system. The `change_event_records` trigger already
emits `record.created`, `record.updated`, `record.archived`, `record.restored`
and `record.deleted` for every mutation path (direct CRUD and RPC). The new
`transition_record_status` RPC updates `records` through a normal UPDATE, so
the trigger emits events without modification. `record_field_definitions`
gets its own change-event trigger following the same pattern, so
configurable-schema changes are durable and live-reconcilable.

## Consequences

- SCI-001's migration widens `chk_records_kind`, adds `record_field_definitions`
  with workspace RLS, adds `records.properties` JSONB, widens `create_record`,
  and adds `transition_record_status`. No applied migration is modified.
- Samples and reagents inherit all record infrastructure: `structure_version`
  and `calculation_input_revision` remain at their defaults because registry
  objects do not own block documents by default; they are not removed, so a
  sample can still own notes blocks.
- The configurable-property schema is workspace-scoped, so the Virus
  Stability fixture seeds field definitions for the fixture workspace. Tests
  create their own definitions rather than asserting against demo data.
- `protocol_template` records are not duplicated; protocol pickers filter
  `records?kind=eq.protocol_template`.
- Future kinds (datasets, analyses, files) widen the same check and reuse
  the same property mechanism without new tables.
- The transition matrix is encoded in the RPC, so adding a status requires a
  migration (intentional: status vocabularies are small and durable).
- SCI-002 builds the protocol-reference and materials notebook blocks over
  these foundations; SCI-001 does not implement those blocks.
- The Samples/Reagents registry routes (TanStack Table views) are Phase 7;
  SCI-001 delivers the picker and inspector summaries that link these objects
  into notebook workflows, not the full registry screens.

## Migration and rollback notes

- `chk_records_kind` is replaced (DROP + ADD) to include `sample` and
  `reagent`; existing rows are unaffected because no existing row has either
  kind.
- `records.properties` is added `NOT NULL DEFAULT '{}'::jsonb`; backfill is
  unnecessary.
- `record_field_definitions` is a new table; rollback drops it and the
  `properties` column and narrows the check constraint.
- The `transition_record_status` and widened `create_record` functions are
  replaced; rollback restores the original signatures.

## Alternatives considered

- **Owned subtype tables (`samples`, `reagents` tables).** Rejected: it
  would fork identity, permissions, events, audit and links, duplicating
  0015's entire platform for a shape difference (properties vs blocks) that
  is cleanly handled by a JSONB column and a configurable schema table.
- **A global `properties` JSONB column with no schema table.** Rejected:
  without `record_field_definitions` there is no workspace-configurable,
  queryable, typed schema; validation would be ad hoc and the inspector could
  not render stable labels for retired fields.
- **A new `protocol` kind distinct from `protocol_template`.** Rejected: the
  mockup's protocol is a notebook-backed block document, which is exactly
  `protocol_template`; a second kind would split protocol identity and break
  existing links.
- **Encoding the transition matrix in a table.** Rejected for SCI-001: the
  matrices are small and stable; a function is simpler to audit and test. A
  table can be introduced later if status vocabularies become
  workspace-configurable.

## Relationship to existing decisions

- Extends **0015** (notebook domain vocabulary) by widening `records.kind`
  and adding configurable properties, exactly as 0015 §2 anticipates ("new
  kinds are added by widening the check").
- Reuses the **0019** scientific type vocabulary for property typing.
- Reuses **0006** (RLS), **0016/0017** (durable events and live
  reconciliation) and the **0010** archive/restore and link RPCs unchanged.
- Does not supersede any decision; 0015's contract is preserved, not
  reversed.

**Corrections to prior decisions:** none. 0015's statement that "structured
objects such as samples, protocols, datasets, analyses, figures, reports,
instruments and reagents can be linked into the notebook without turning the
notebook into a database form" is satisfied by making samples and reagents
record kinds with configurable properties, which is the path 0015 §2
explicitly leaves open.
