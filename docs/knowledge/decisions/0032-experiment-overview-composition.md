# 0032. Experiment overview composition

- **Status:** accepted
- **Date:** 2026-07-23
- **Ticket:** SCI-007

## Context

SCI-007 builds the Experiment Overview: a read-oriented view that composes the
notebook's blocks and linked records into the approved overview layout from the
"Experiment Overview (Results)" mockup. Every prior ticket (SCI-001 through
SCI-006) has established the block model, scientific record kinds, file storage,
chart specifications, plate maps, protocol/materials blocks and reusable
templates. The overview must read from the same blocks and linked records rather
than duplicating content, let users choose which blocks appear, keep record
identity and links in the inspector, and render locked or historical versions
without live-edit controls.

Decisions that constrain this one:

- 0015: an experiment is a notebook-backed record; blocks are the source of
  truth; revisions are immutable snapshots.
- 0010: the inspector is a content container; routes own data and pass typed
  tab content.
- 0012: ChartFrame, PlateMap and NotebookBlock are the visualisation frames the
  overview must reuse.
- 0018: autosave and conflict operate on live blocks; a submitted revision is
  the authority for historical rendering.
- 0019–0023: scientific tables and HyperFormula contracts; the overview renders
  sheet/table blocks in read-only mode through the existing preview components.
- 0025: structured rich text (H2/H3, paragraphs, prose lists in Tiptap JSON);
  the overview renders rich_text through the existing `RichTextContent`.
- 0026: scientific record kinds and configurable properties; linked records are
  read through `record_links` and the scientific-record-summary pattern.
- 0027–0031: protocol/materials, file, chart, plate map and template contracts;
  the overview reuses their preview renderers.

## Decision

### 1. The overview is a read-only composed view, not a duplicated document

The Experiment Overview is a new deep-linkable route
(`/projects/$projectId/experiments/$recordId/overview`) that reads from the same
`records`, `blocks`, `record_links`, `file_objects` and scientific-sheet
resources through the same RLS-enforced PostgREST queries the notebook editor
uses. No overview content is persisted or duplicated. The overview composes
blocks into named sections by type and renders each block through its existing
preview component in read-only mode.

### 2. Block-to-section mapping

Blocks are grouped into overview sections by type. Sections appear in a
canonical reading order; within each section, blocks appear in notebook order
(`blocks.order` ascending) so provenance is preserved.

| Block type(s)                          | Section id       | Section label  |
| -------------------------------------- | ---------------- | -------------- |
| `rich_text`, `callout`                 | `notes`          | Notes          |
| `materials`                            | `materials`      | Materials      |
| `protocol_reference`, `procedure_step` | `procedures`     | Procedures     |
| `table`, `sheet`                       | `tables`         | Tables & data  |
| `chart`, `plate_map`                   | `visualizations` | Visualizations |
| `metric`                               | `metrics`        | Metrics        |
| `file`                                 | `files`          | Files          |
| `linked_record`                        | `links`          | Linked records |
| `checklist`                            | `tasks`          | Tasks          |

The mapping is derived (not configured): a block's type determines its section.
`rich_text` blocks carry their own H2/H3 headings (decision 0025), so the
section label "Notes" is the grouping label and each block's internal heading
serves as its sub-heading. Unknown block types render as readable placeholders
in their own "Other" section, preserving the block id and type (decision 0015).

Empty sections (no blocks of that type, or all blocks excluded) are hidden.

### 3. Overview configuration: per-block exclusion in record properties

Users can choose which blocks appear in the overview. The smallest durable model
is a denylist stored in the record's existing `properties` JSONB column:

```
records.properties.overview.excludedBlockIds: string[]   // array of block ids
```

By default, all blocks appear. Users exclude individual blocks by adding their
id to `excludedBlockIds`; re-including removes the id. This approach:

- requires no schema migration — `properties` is already a free-form JSONB
  column with a `'{}'` default;
- does not touch block validation — the flag lives on the record, not on each
  block payload;
- is RLS-enforced through the existing `records_update` policy (workspace
  members may update);
- flows through the existing `trg_change_event_records` AFTER UPDATE trigger,
  which emits a durable `record` change event on every update;
- gets audit actor attribution from the change-event trigger's
  `request.jwt.claims` extraction.

The configuration is updated through a direct PATCH to
`/api/db/records?id=eq.<recordId>` with `{ properties: { …overview, …existing } }`.
The application validates that `excludedBlockIds` is an array of strings
referencing blocks that belong to the record; unknown ids are silently ignored
(not an error) so stale exclusions from deleted blocks do not block the update.

### 4. Locked and historical versions

The overview renders without any live-edit controls (no block insertion, no
drag handles, no edit affordances) in three cases:

1. **Archived** — `record.archivedAt !== null`. The record is read-only until
   restored (decision 0015 §6).
2. **Locked** — `record.status === 'locked'`. The experiment status vocabulary
   (UI-005) includes `locked`; the overview treats it as a read-only state.
3. **Historical revision** — the route accepts a `?revision=<id>` search param.
   When present, the overview loads the immutable `revisions` row and renders
   from its `blockSnapshot` (a JSONB array of `{id, type, payload,
payload_schema_version, order, version}`) and `metadataSnapshot` instead of
   the live `blocks` rows. The revision banner identifies the snapshot by
   `reason`, `created_at` and a short id.

In all three cases, every block renders through its existing preview component
in read-only mode. The block-visibility toggle is hidden; the overview reflects
exactly what was in the notebook at snapshot time (for a revision) or what is in
the locked record.

The full submission/signature workflow (REV-001 through SIGN-002) is a later
phase. SCI-007 only establishes that the overview can render from a revision
snapshot and can detect the locked/archived states.

### 5. Inspector

The overview reuses the shared `Inspector` component (decision 0010) with the
same Properties and Links tabs as the notebook route, plus Files, Checks and
Comments tabs. The Files tab lists file blocks' live `file_objects` status.
Checks and Comments render through the existing `CheckList` and `CommentList`
components with honest empty states — the approval-workflow (UI-007) and
comment backends are later tickets, so the tabs are present and accessible but
show "No checks" / "No comments" rather than fabricated content. The inspector
is route-owned: the overview route passes typed tab content derived from the
same record, links and blocks queries.

### 6. REST and data loading

The overview loads through existing REST resources — no new RPCs or tables:

| Resource                                               | Purpose                          |
| ------------------------------------------------------ | -------------------------------- |
| `GET /api/db/records?id=eq.<id>`                       | experiment metadata + properties |
| `GET /api/db/blocks?record_id=eq.<id>&order=order.asc` | notebook blocks                  |
| `GET /api/db/record_links?source_record_id=eq.<id>`    | outgoing linked records          |
| `GET /api/db/revisions?id=eq.<revisionId>`             | historical revision snapshot     |
| `GET /api/db/file_objects?record_id=eq.<fileRecordId>` | live file status (via preview)   |
| `PATCH /api/db/records?id=eq.<id>`                     | overview configuration update    |

Scientific sheet data, chart data clients and calculation results are loaded by
the existing preview components (`ChartBlockPreview`, `PlateMapBlockPreview`,
etc.) through their own query hooks — the overview does not re-implement data
loading for these resources.

### 7. Change-event trigger accuracy (migration 0030)

The existing `trg_change_event_records` trigger reports `changedMetadata` based
on `title`, `status`, `tags` and `folder_id` — it does not include `properties`.
Migration 0030 adds `properties` to the `changedMetadata` expression so an
overview configuration update accurately reports `changedMetadata: true`. The
event is emitted on every UPDATE regardless; this migration only improves the
payload's accuracy.

## Consequences

- The overview route is additive: no existing route, component or contract
  changes. The notebook editor route remains the authoritative editing surface.
- `records.properties.overview.excludedBlockIds` is the only persisted overview
  state. It is generic (an array of block ids) and does not encode
  overview-specific scientific fields.
- Migration 0030 updates the change-event trigger function; it does not change
  the event name, entity type or operation vocabulary.
- The revision-viewing capability establishes the rendering path for REV-003
  (version diffs) and later review tickets, but does not implement submission,
  approval or signature workflows.
- Unknown block types render in an "Other" section as readable placeholders,
  preserving decision 0015's forward-compatibility guarantee.
