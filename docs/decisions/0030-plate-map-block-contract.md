# ADR 0030: Plate Map Block Contract

- **Status:** Accepted
- **Date:** 2026-07-22
- **Ticket:** SCI-005

## Context

SCI-005 introduces a working PlateMap notebook block so scientists can lay out
96-well microplate assignments (samples, controls, blanks, replicates, volumes)
inside an experiment notebook. ADR 0015 already anticipates `plate_map` as a
notebook block type ("wells + bands; rendered with PlateMap"), and the
presentational `PlateMap` component (UI-006) already renders a semantic grid
with accessible buttons, row/column labels, and a legend.

The existing block infrastructure — versioned JSONB payloads, `update_block_payload`
optimistic-concurrency RPC, blocks RLS, durable change events, audit attribution,
and revision snapshots — is sufficient for plate maps. No owned subtype tables,
new record kinds, or parallel link systems are needed.

## Forces

- 96-well plates first, but the model must extend to 384-well and other approved
  future formats without schema changes.
- Wells need stable, canonical identity (e.g. `A1`) for keyboard navigation,
  selection, and inspector display.
- Sample assignments link to existing SCI-001 sample records through the existing
  `create_record_link` same-workspace machinery — not a parallel link system.
- Archived or renamed sample references must remain historically resolvable.
- Assignment roles (sample, positive control, negative control, blank, empty)
  must be generic and extensible — no biotech-specific assay semantics in global
  infrastructure.
- Replicates, volumes, and units use structured typing consistent with existing
  scientific unit contracts.
- PostgreSQL/RLS remains authoritative: the DB trigger enforces structural
  invariants and reference integrity; application validation improves error
  messages but is not the only boundary.
- Plate edits must persist atomically to avoid partial layouts. Because all
  wells live in a single JSONB payload, ordinary `update_block_payload` with
  expected-version optimistic concurrency is sufficient — no new bulk RPC.
- Durable change events and audit attribution come from existing block triggers;
  no parallel event system.

## Decision

### 1. Domain placement

A plate map is a `blocks.type='plate_map'` notebook block with a versioned JSONB
payload. No owned subtype tables, new record kinds, or separate identity systems.
Plate maps reuse the existing blocks RLS, change events, audit attribution, and
revision snapshots.

### 2. Payload shape

```typescript
interface PlateMapBlockPayload {
  title?: string
  spec?: PlateMapSpec
  provenance?: string
}

interface PlateMapSpec {
  specVersion: number   // PLATE_MAP_SPEC_VERSION = 1
  format: PlateFormat   // '96_well' initially
  rows: number          // 8 for 96-well
  cols: number          // 12 for 96-well
  wells: WellAssignment[]
  validation: PlateValidationConfig
}

type PlateFormat = '96_well'  // extensible to '384_well' etc.

interface WellAssignment {
  wellCode: string     // canonical "A1", "B12"
  row: number          // 0-based row index
  col: number          // 0-based column index
  role: AssignmentRole
  sampleRef?: SampleRef
  replicate?: number   // positive integer
  volume?: Volume
  notes?: string
}

type AssignmentRole = 'sample' | 'positive_control' | 'negative_control' | 'blank' | 'empty'

interface SampleRef {
  recordId: string     // stable UUID of the sample record
  identifier: string   // observed display identifier (honest snapshot)
  title: string        // observed display title
  archived?: boolean   // snapshot of archived state at observation time
}

interface Volume {
  value: number
  unit: string         // e.g. 'µL', 'mL'
}

interface PlateValidationConfig {
  requiredRoles?: AssignmentRole[]
  volumeMin?: number
  volumeMax?: number
  volumeUnit?: string
}
```

An empty draft `{}` is valid, so the editor opens immediately and the user
configures the plate interactively — same pattern as SCI-004 chart blocks.

### 3. Well identity and coordinate rules

- Wells are identified by a canonical well code: uppercase row letter (`A`–`H`
  for 96-well) concatenated with the 1-based column number (`1`–`12`).
- Row index is 0-based; column index is 0-based. The canonical code is derived:
  `String.fromCharCode(65 + row) + (col + 1)`.
- The DB trigger and application validator both cross-check that `wellCode`,
  `row`, and `col` are mutually consistent.
- Well codes are unique within a plate: no duplicate coordinates.

### 4. Plate formats

The initial supported format is `96_well` (8 rows × 12 columns = 96 wells). The
format identifier, rows, and cols are stored explicitly so future formats
(384-well, 1536-well) can be added by extending the approved `PlateFormat` union
and the DB trigger's format guard — no schema migration required for the format
enum itself, only a trigger update to accept the new format and its dimensions.

### 5. Assignment roles

Roles are generic and extensible:
- `sample` — a well assigned to a sample record (requires `sampleRef`).
- `positive_control` — a positive control well (may optionally link a sample).
- `negative_control` — a negative / no-template control well.
- `blank` — a blank / background well.
- `empty` — an explicitly empty well (no assignment).

No biotech-specific assay semantics (e.g. qPCR, ELISA, cell-based) are baked into
the role vocabulary. Assay-specific configuration belongs in configurable fields
or payload-specific data.

### 6. Sample links

- Sample references reuse the existing SCI-001 record-link machinery
  (`create_record_link` RPC / `createScientificLink`), not a parallel link system.
- The payload stores a `SampleRef` with `recordId` (stable UUID), `identifier`
  (observed display identifier), `title` (observed display title), and `archived`
  (snapshot of archived state). This honest snapshot ensures archived, renamed,
  or soft-deleted samples remain historically resolvable even if the
  `record_links` target later changes.
- The DB trigger validates that any `sampleRef.recordId` points to a record in
  the same workspace with kind `sample`. Cross-workspace references are rejected
  at the database boundary.
- The DB trigger creates or updates deduplicated `record_links` for sample
  references (one link per unique sample per source record, using `ON CONFLICT`
  upsert) — same pattern as materials blocks.

### 7. Replicates, volumes, and units

- `replicate` is an optional positive integer (1-based replicate index).
- `volume` is an optional structured value with a numeric `value` and string
  `unit` (e.g. `µL`, `mL`). Uses the same structured-unit pattern as materials
  blocks.
- Volume constraints (`volumeMin`, `volumeMax`, `volumeUnit`) are optional
  configuration in `PlateValidationConfig`. When configured, the application
  validator and DB trigger enforce that assigned volumes fall within bounds.

### 8. Validation

**Application-enforced (detailed error messages):**
- Duplicate assignment: same sample record linked to multiple wells with the
  same role and replicate number (controls are not incorrectly flagged as
  duplicates when no sample is linked).
- Required controls: if `validation.requiredRoles` lists roles, check at least
  one well of each required role exists.
- Volume constraints: if `validation.volumeMin`/`volumeMax` are configured,
  check all assigned volumes are within range.
- Well-count vs dimensions: wells array length does not exceed rows × cols.

**DB-enforced (authoritative invariants):**
- Payload is a JSON object with schema version 1.
- Draft `{}` is allowed.
- `title` is a non-empty string when payload is populated.
- `spec` is an object with `specVersion = 1`.
- `format` is an approved format identifier (`96_well`).
- `rows` and `cols` match the format (8 × 12 for 96-well).
- `wells` is an array; each well has a valid canonical `wellCode` matching
  `row`/`col`, within bounds.
- No duplicate `wellCode` values.
- `role` is in the approved set.
- Any `sampleRef.recordId` is a UUID pointing to an active or archived record
  in the same workspace with kind `sample`.
- `sampleRef.identifier` and `sampleRef.title` match the referenced record's
  current `identifier` and `title` (honest snapshot — prevents stale or
  fabricated references).
- Volume `value` is a positive number when present.
- `replicate` is a positive integer when present.

### 9. Atomicity

All wells live in a single JSONB payload. Ordinary `update_block_payload` with
expected-version optimistic concurrency is sufficient for atomic whole-layout
writes. No new bulk-assignment RPC is needed.

### 10. Lifecycle and revision snapshots

SCI-005 does not introduce a freeze/unfreeze lifecycle for plate maps. Plate
maps are live assignments — the payload always reflects the current layout.
Revision binding and content freezing follow the existing block revision
snapshot patterns: when a revision is submitted, block payloads are snapshotted
into the revision's `block_snapshot` array. No SCI-005-specific freeze RPC.

### 11. REST and RPC operations

- **Resource paths:** `/api/db/blocks` filtered by `type=eq.plate_map`.
- **CRUD:** Create, read, update, delete through the same PostgREST proxy as
  all block types. RLS enforces workspace isolation.
- **Payload updates:** `rpc/update_block_payload` with expected version for
  optimistic concurrency.
- **Filters:** `?type=eq.plate_map&record_id=eq.<uuid>` to list plate map blocks
  for a record. Standard PostgREST filters apply.
- **Validation errors:** The DB trigger raises `SQLSTATE 23514` for invalid
  payloads (bad dimensions, bad well code, duplicate assignment, invalid role,
  invalid sample reference). The proxy maps this to the `validation_error`
  category with a stable error code.
- **Archived-sample behavior:** `sampleRef.archived` is an honest snapshot;
  `fetchRecordById` resolves the live record state. Archived samples remain
  readable and their links remain durable.
- **Stable link representations:** `sampleRef.recordId` (UUID) is authoritative;
  `sampleRef.identifier` and `sampleRef.title` are observed display values for
  historical resolution.

### 12. Rendering and accessibility

- The existing presentational `PlateMap` (`src/components/viz/plate-map.tsx`) is
  extended with optional assignment-role colours and per-well assignment labels.
  The existing API and tests are preserved.
- Row (A–H) and column (1–12) labels render accessibly.
- A legend explains assignment-role colours.
- Wells are real buttons with keyboard navigation (arrow keys, Enter/Space).
- Missing wells are distinct from empty wells (per ADR 0012).
- The selected well shows in the shared inspector pattern.
- Honest loading, error, empty, and permission states.

### 13. Event naming

Plate map mutations produce the same durable `block.update` / `block.insert` /
`block.delete` events as all block types, through the existing block triggers.
No plate-map-specific event names.

## Consequences

- The plate map contract is fully contained in the block payload — no new tables,
  record kinds, RPCs (beyond the existing `update_block_payload`), or event systems.
- Adding 384-well or other formats requires extending the `PlateFormat` union,
  updating the application validator, and updating the DB trigger's format guard.
  No data migration.
- Sample links are durable through `record_links` and historically resolvable
  through the payload's honest snapshot.
- The DB trigger's structural validation is the authoritative boundary; the
  application validator provides friendlier error messages for the same rules
  plus computed checks (duplicate assignments, required controls, volume
  constraints).
