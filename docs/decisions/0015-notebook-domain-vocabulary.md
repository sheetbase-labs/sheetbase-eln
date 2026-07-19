# 0015. Notebook domain vocabulary and revision boundaries

- **Status:** accepted
- **Date:** 2026-07-19
- **Ticket:** ELN-001

## Context

Phase 3 builds the first live notebook vertical slice. Before the schema
(API-002 → ELN-002) and the REST contract (ELN-003), the repository needs a
short, durable domain vocabulary that fixes what the objects are, how they
relate, which ones carry stable public identifiers, what a block is, what is
revisions versus live edits, and what soft deletion means.

The roadmap (`ROADMAP.md` §3) already fixes two things:

- The core hierarchy is **Workspace → Project → Folder → Notebook or Record
  → Section or Block**.
- "Experiments are deliberately lightweight records. Their content is
  assembled from free-form notebook blocks rather than forced into one rigid
  experiment schema. Structured objects such as samples, protocols, datasets,
  analyses, figures, reports, instruments and reagents can be linked into the
  notebook without turning the notebook into a database form."

The mockups in `Mockups/` show three record kinds that are all block
documents: **Experiment Notebook (Virus Stability)**, **Protocol Template
(Titration Assay)** and **Report Builder (Lentivector Stability Study
Report)**. Each has a typed header (identifier, status, owner, project,
timestamps, tags, visibility), a body of sections and blocks, an inspector
with properties / activity / comments / files / linked records / checks, and
outgoing links to samples, protocols, datasets, reagents, analyses and
files. Identifiers in the mockups are type-prefixed and calendar-year
numbered: `EXP-2025-0014`, `RPT-2025-0003`. Lot and material identifiers
(`LVV-250601`, `QPC-200`) belong to linked structured records, not to the
notebook record itself.

Existing decisions that constrain this one:

- 0003: identity lives in `internal.user`; domain tables reference it
  cross-schema.
- 0004: each signup gets a personal workspace; the membership model supports
  future invitations.
- 0006: row-level security is the access-control boundary; the workspace is
  the tenancy root.
- 0007/0008/0009–0014: the UI system, shell, inspector, scientific status,
  notebook frames, audit/approval components and the visual review gate are
  already productionised around these concepts.

`docs/conventions.md` fixes: plural snake_case tables, `id` uuid PKs,
`<singular_parent>_id` FKs, `created_at`/`updated_at`/`archived_at`
timestamps, type-prefixed stable public identifiers separate from the PK,
`api` schema for PostgREST surface, event names
`<domain>.<entity>.<past_tense_verb>`.

Forces:

- The model must support experiment, protocol template and report as the
  first three record kinds without baking their differences into shared
  tables.
- Blocks must be forward-compatible: future block types (sheet, chart spec,
  plate map, file) arrive without rewriting the persistence contract.
- Live editing, autosave and multi-tab liveness need a clear optimistic
  concurrency unit; review and signature need an immutable snapshot unit.
  These are different boundaries and must not be conflated.
- Linked records must render honestly when the target is missing,
  soft-deleted or permission-restricted (RecordLink's contract from UI-005).
- Soft deletion, archival and restoration must preserve audit and review
  evidence.

## Decision

### 1. Objects and hierarchy

The domain objects are:

| Object      | Parent           | Many? | Notes                                                                                                 |
| ----------- | ---------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| workspace   | —                | 1     | Tenancy root (0004). Already in `api.workspaces`.                                                     |
| project     | workspace        | many  | Already in `api.projects` with immutable `key`.                                                       |
| folder      | project          | many  | Optional organisational layer. A project's records can live at the root or in a folder. Folders nest. |
| record      | project + folder | many  | The polymorphic notebook-backed record (experiment, protocol_template, report, …).                    |
| block       | record           | many  | Ordered, typed content unit. Sections are heading blocks, not a separate table.                       |
| record_link | record           | many  | Outgoing typed link from a record to another record (or to a structured object by stable id).         |
| revision    | record           | many  | Immutable snapshot taken at submission, signature or explicit save point.                             |

"Notebook" is **not a separate table**. A record's notebook _is_ its ordered
set of blocks. This keeps the model honest with the roadmap ("experiments
are lightweight records … assembled from blocks") and with the mockups,
where experiment, protocol template and report are all block documents with
different headers and kinds, not three different object models.

### 2. Experiment, protocol template and report are kinds of record

`records.kind` is a text column with a check constraint starting at
`('experiment', 'protocol_template', 'report')`. New kinds are added by
widening the check, not by adding tables. Each kind has its own
type-prefixed identifier (§3), its own status vocabulary (reusing
`StatusBadge` domains from UI-005: `experiment`, `review`, `sample`,
`dataset`), and its own header layout (reusing `RecordHeader` from UI-004),
but the block document, links, files, inspector, audit and revision
machinery are shared.

This is the answer to "does an experiment own a notebook or is it one kind
of notebook-backed record?": **an experiment is one kind of notebook-backed
record.** Protocol templates and reports are also notebook-backed records.
The product language uses "experiment", "protocol template" and "report" as
the record kind, and "notebook" as the block document owned by any of them.
A route like `/projects/<key>/experiments/<id>` is a friendly view over
`records` filtered by `kind = 'experiment'`; the API surface is
`/records?kind=eq.experiment` plus kind-specific RPCs when needed.

### 3. Stable public identifiers

Every user-visible record type has a stable, immutable, type-prefixed
identifier separate from its uuid primary key, matching the mockups and
`docs/conventions.md`:

| Record kind       | Prefix                | Format          | Example                 | Scope            |
| ----------------- | --------------------- | --------------- | ----------------------- | ---------------- |
| project           | (uses existing `key`) | free text       | `lentivector-stability` | workspace-unique |
| folder            | `F`                   | `F-YYYY-NNNN`   | `F-2025-0007`           | project-unique   |
| experiment        | `EXP`                 | `EXP-YYYY-NNNN` | `EXP-2025-0014`         | project-unique   |
| protocol_template | `PRT`                 | `PRT-YYYY-NNNN` | `PRT-2025-0003`         | project-unique   |
| report            | `RPT`                 | `RPT-YYYY-NNNN` | `RPT-2025-0003`         | project-unique   |

The mockup's `PR-1021` is a **material catalog number** owned by the
reagents registry, not a protocol-record identifier; protocol records use
`PRT-`. Lot identifiers (`LVV-250601`) belong to sample/material records.

Identifiers are assigned at record creation by a workspace-scoped sequence
over `(workspace_id, year, prefix)`. They are immutable; the display title
changes freely. Internal uuid PKs never appear in URLs or public API
examples. Blocks do **not** carry type-prefixed identifiers; they carry a
uuid `id` that is stable for the block's lifetime and is the anchor for
comments, review and deep links (`/records/<id>#block-<uuid>`).

### 4. Blocks, sections and payload ownership

A block is one row in `blocks`:

| Column                     | Purpose                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | uuid PK, stable for the block's lifetime. Anchor for comments and links.                                                                                                   |
| `record_id`                | FK to `records`. Indexed.                                                                                                                                                  |
| `type`                     | Block type (see below).                                                                                                                                                    |
| `payload`                  | JSONB, type-specific, owned by the block type's schema.                                                                                                                    |
| `payload_schema_version`   | Integer. Bumped when the type's payload schema changes; the application validates `payload` against the schema for `(type, payload_schema_version)` at the write boundary. |
| `order`                    | Real-valued ordering key (fractional indexing) so inserts and moves do not rewrite every block.                                                                            |
| `created_at`, `updated_at` | timestamptz.                                                                                                                                                               |
| `created_by_user_id`       | Actor attribution. Cross-schema FK to `internal.user`.                                                                                                                     |
| `version`                  | Integer, optimistic-concurrency version for **block content** edits.                                                                                                       |

**Sections are heading blocks, not a separate table.** A `heading` block
with level 2 opens a section; the section's blocks are the following blocks
until the next same-or-higher level heading. This matches the mockups,
where "Objective", "Materials", "Experimental design" are H2 headings
inside the document, and the Report Builder's numbered sections are a
derived rendering over the same heading blocks. A future report-specific
view can project section status (Auto-filled, Edited, To do) from the
blocks under each heading without a separate sections table.

Initial block types (ELN-005 implements the first four):

- `heading` — level (1–6) + text.
- `rich_text` — structured text payload (paragraphs, inline formatting).
- `checklist` — items with checked/text.
- `linked_record` — target record id/type/key + link label; rendered with
  `RecordLink` (UI-005), including missing/deleted/permission-restricted
  states.
- `list` — ordered/unordered items (mockup "Materials" list).
- `callout` — variant (info/warning/note) + text.
- `table` — columns, rows, cell values; the Handsontable sheet block
  (Phase 4) is a distinct `sheet` type, not this static table.
- `chart` — chart specification + provenance; rendered with `ChartFrame`
  (UI-006).
- `plate_map` — wells + bands; rendered with `PlateMap` (UI-006).
- `file` — file attachment metadata (name, size, mime, object-storage key);
  the bytes live behind an object-storage boundary (deferred to Phase 5).
- `metric` — labelled value with unit and provenance (Report Builder "Titer
  summary").
- `procedure_step` — numbered step with optional linked records (Protocol
  Template).

Unsupported future block types are preserved as readable placeholders: the
`type` and `payload` are returned untouched, the UI renders a "unsupported
block type" frame, and the application never silently drops or rewrites
payloads it does not understand.

### 5. Record links

`record_links` is a separate table, not a block, because links are also
used for inspector counts, lineage and review. Columns:
`id`, `source_record_id`, `target_record_id` (nullable), `target_kind`,
`target_identifier` (the stable public id, preserved so the link can render
honestly when the target is deleted), `link_type` (`sample`, `protocol`,
`dataset`, `reagent`, `analysis`, `file`, `general`), `created_at`,
`created_by_user_id`. Constraints: source and target must be in the same
workspace (enforced by RLS + a check); no duplicate
`(source, target, link_type)`; `target_record_id` is set when the target
exists and the viewer can reach it, null otherwise. The `RecordLink`
component's `available | missing | deleted | permission-restricted` states
map directly to: target row exists and is readable; target row never
existed or was hard-deleted; target row is soft-deleted; target row exists
but RLS denies the viewer.

### 6. Soft deletion, archival and restoration

Two distinct lifecycle moments, following the convention that lifecycle
moments get their own past-tense column:

- `archived_at` — the record is archived (reversible). Archived records are
  excluded from default lists but remain readable by members. Restoration
  clears `archived_at`. The existing `projects.archived_at` column already
  follows this pattern.
- `deleted_at` — the record is soft-deleted (a tombstone). Soft-deleted
  records are excluded from default reads and from most joins, but the row
  is retained for audit and review evidence. A background cleanup job
  (deferred) purges rows whose `deleted_at` is older than the workspace
  retention window. Restoration from `deleted_at` is allowed only within
  the retention window and only by an owner/admin.
- Blocks and record_links are hard-deleted when their parent record is
  hard-purged; they are preserved (and hidden via RLS) while the record is
  soft-deleted. Revisions (§7) are **never** deleted with the record; they
  outlive the row so that signed and submitted evidence remains
  reconstructable.

RLS enforces that only workspace members can archive/delete, and only
owners/admins can restore from `deleted_at` (the role check builds on
0006's membership model).

### 7. Revision boundaries

There are **three** revision boundaries, kept distinct because they change
at different rates and have different consumers:

1. **Record metadata** (title, status, tags, folder assignment, visibility).
   Bumps `records.updated_at` and is captured in the audit/change event
   stream (LIVE-001). No per-field version column; the audit trail is the
   history.
2. **Block structure** (insert, move, delete a block). Bumps
   `records.structure_version` (integer). A move or insert is atomic: it
   updates `blocks.order` and `records.structure_version` in one
   transaction, and the client must send the expected
   `structure_version` with the mutation (ELN-003, ELN-006). Stale
   structure requests are rejected with a stable `stale_structure` error.
3. **Block content** (edit a block's `payload`). Bumps that block's
   `blocks.version` only. Autosave (ELN-007) sends the expected
   `block.version`; a stale version returns `stale_block_content` and the
   client reconciles. The record's `structure_version` does **not** move on
   a content edit, so reordering and content edits do not collide.

An immutable **revision** is taken at submission, signature or an explicit
"save version" action: `revisions` records `id`, `record_id`,
`structure_version`, `metadata_snapshot` (JSONB: title, status, tags,
…), `block_snapshot` (JSONB array of `{id, type, payload,
payload_schema_version, order, version}` at snapshot time), `reason`
(`submit`, `sign`, `manual`), `created_by_user_id`, `created_at`. The
snapshot is the authority for review (Phase 6); the live `records`/`blocks`
rows continue to evolve. A revision is never mutated; a superseded
revision is marked `superseded_by_revision_id` but kept.

### 8. Review against the mockups

- **Experiment Notebook (Virus Stability):** maps to `records.kind =
'experiment'`, identifier `EXP-2025-0014`, status `in-progress`
  (experiment vocabulary), project `Lentivector Stability Study`, owner
  `Gareth Price`. Body blocks: `heading` (Objective, Materials,
  Experimental design, Results), `rich_text`, `list` (Materials), `table`
  (Experimental design), `chart` (Results). Inspector properties, files,
  linked records (Samples 2, Protocol 1, Dataset 1) and checks all map to
  `records` metadata + `record_links` + the file/metadata surfaces
  introduced in later phases. Activity and comments build on the
  `AuditTrail` (UI-007) and a future comments table.
- **Protocol Template (Titration Assay):** maps to `records.kind =
'protocol_template'`, identifier `PRT-2025-000X`, status `active`
  (template vocabulary), version `1.2` carried as record metadata. Body
  blocks: `heading`, `rich_text`, `list`/`checklist` (Materials with
  catalog numbers), `procedure_step` (numbered Procedure), `callout`
  ("Include NTC in triplicate"), `table` (Run qPCR stages). The approval
  sidebar maps to the review/approval machinery from UI-007.
- **Report Builder (Lentivector Stability Study Report):** maps to
  `records.kind = 'report'`, identifier `RPT-2025-0003`, status `draft`.
  Numbered sections are `heading` blocks; section status (Auto-filled,
  Edited, To do) is derived from the blocks under each heading. Content
  blocks include `chart`, `metric` (Titer summary), `table`, `file`
  (dataset). The review/approval sidebar and the export settings are
  report-kind metadata; the document hierarchy is the same blocks model.

### 9. Naming the first events

Following `docs/conventions.md`, the durable change/audit event names for
this domain are:

- `record.created`, `record.archived`, `record.restored`,
  `record.deleted`
- `record.metadata_updated`
- `record.block_inserted`, `record.block_moved`, `record.block_deleted`,
  `record.block_updated`
- `record.link_added`, `record.link_removed`
- `record.revision_created`

Event types are added, never renamed.

## Consequences

- ELN-002 adds `folders`, `records`, `blocks`, `record_links` and
  `revisions` to the `api` schema, with workspace RLS on each, real-valued
  `blocks.order`, optimistic-concurrency `version` on blocks and
  `structure_version` on records, and JSONB `payload` validated at the
  application boundary by `(type, payload_schema_version)`.
- ELN-003 exposes `records`, `blocks`, `record_links` and `revisions`
  through PostgREST, plus RPCs for multi-row atomic operations
  (`create_record_with_blocks`, `move_block`) that bump
  `structure_version` in one transaction.
- ELN-004/005 build the experiment notebook route, record header and
  initial block types (`heading`, `rich_text`, `checklist`,
  `linked_record`) over this contract; later phases add `chart`,
  `plate_map`, `sheet`, `file`, `metric`, `procedure_step`, `callout`,
  `list`, `table` without schema changes.
- The `RecordLink`, `StatusBadge`, `RecordHeader`, `Inspector`,
  `NotebookBlock`, `AuditTrail` and `ApprovalStepper` components from
  Phase 2 map directly onto this model; no UI contract changes are needed
  to start Phase 3.
- Review and signature (Phase 6) read from `revisions`; live editing reads
  from `records`/`blocks`. The two never share a row, so a submitted
  version stays reconstructable while work continues.
- Soft-deleted records retain revisions; hard purge (deferred) removes
  rows but a pre-purge export job is the audit-safe path (operational
  hardening, Phase 9).
