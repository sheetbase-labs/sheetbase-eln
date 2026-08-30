# 0029. Chart specification and chart block contract

- **Status:** accepted
- **Date:** 2026-07-21
- **Ticket:** SCI-004

## Context

ADR 0015 anticipated `chart` as a notebook block type: "chart specification +
provenance; rendered with `ChartFrame` (UI-006)." The `blocks.type` check and
the application boundary validator already admit `chart` with a placeholder
payload (`title`, `spec` as an opaque string, `provenance`). ADR 0019 fixes
the **scientific table** as the workspace-owned, RLS-enforced, schema-versioned
stable dataset that a sheet block points to. ADR 0015 §7 fixes the revision
boundary: an immutable revision snapshots `{id, type, payload,
payload_schema_version, order, version}` for every block, and the live
`records`/`blocks` rows keep evolving. `ChartFrame` (UI-006) already owns the
figure chrome — title, subtitle, provenance, live/snapshot mode, legend,
accessible alternative and actions — and renders children; it does not itself
render a chart.

SCI-004 brings the first real chart blocks into the notebook. ROADMAP line 88
names "chart blocks driven by saved dataset and transformation specifications";
line 117 names the full Analysis Studio (saved transformations, saved analysis
views, export) as a later phase. SCI-004 therefore delivers the smallest
durable contract that makes a chart block honest and reproducible today,
without building Analysis Studio.

Forces:

- A chart must reference a stable dataset (`scientific_tables`) so the spec
  stays valid when rows are added, and so cross-workspace dataset references
  are rejected at the database, not only in the UI.
- The initial chart catalogue is line, scatter and bar (the Virus Stability
  mockup uses a line chart). The model must not bake chart-type-specific or
  dataset-specific columns into shared infrastructure.
- Statistical overlays and error bars must be explicit, reproducible parts of
  the spec — never magic defaults a reader cannot reconstruct.
- A live chart re-reads current dataset state; a frozen chart included in a
  submitted revision must render exactly what was frozen, even after the
  dataset evolves. Revisions already snapshot block payloads, but a chart
  payload that only references a dataset by id is not reproducible on its own
  because the dataset rows change.
- Every mutation must produce the same durable, attributable change events as
  the rest of the notebook (ADR 0016/0017). No parallel identity, permission,
  event or audit system.
- The application boundary validator (`src/lib/blocks`) and the database
  `validate_scientific_block` trigger are the two validation gates; the DB is
  authoritative for reference integrity and immutability.

## Decision

### 1. A chart is a `chart` notebook block, not a record kind or standalone table

A chart specification lives on a `chart` block's JSONB `payload`, validated at
the application boundary by `(type, payload_schema_version)` and enforced at
the database by the extended `validate_scientific_block` trigger. There is no
new table, no new record kind, and no new identity system. A chart block
belongs to one record in one workspace; workspace isolation, optimistic
concurrency (`blocks.version`), structure versioning, change events, audit
attribution and revision snapshots are inherited from the existing block
machinery without modification.

Reusable saved specifications across notebooks (Analysis Studio) are a later
phase; SCI-004 specs are owned by their block.

### 2. Chart block payload shape (payload_schema_version 1)

```jsonc
{
  "title": "Vector genome copy number (qPCR)",
  "spec": { /* ChartSpec, see §3 */ },
  "provenance": "Source: Stability assay · 2025-07-14",
  "frozen": null | { /* FrozenChart, see §5 */ }
}
```

- `title` (non-empty string): the figure title rendered by `ChartFrame`.
- `spec` (object): the `ChartSpec`. Replaces the placeholder opaque string.
- `provenance` (optional string): human-readable source line.
- `frozen`: `null` for a live chart; a `FrozenChart` object once frozen.

An empty draft `{}` is allowed (a chart block just inserted, before a dataset
is chosen), mirroring the file block draft contract.

### 3. ChartSpec — dataset references, fields, filters, transformations, display, overlays

`ChartSpec` is a versioned, validated JSONB object:

```jsonc
{
  "specVersion": 1,
  "type": "line" | "scatter" | "bar",
  "datasets": [{ "tableId": "<uuid of a scientific_tables row>" }],
  "fields": {
    "x":      { "columnId": "<uuid>", "fieldName": "col_..." } | null,
    "y":      { "columnId": "<uuid>", "fieldName": "col_..." },
    "series": { "columnId": "<uuid>", "fieldName": "col_..." } | null,
    "color":  { "columnId": "<uuid>", "fieldName": "col_..." } | null,
    "size":   { "columnId": "<uuid>", "fieldName": "col_..." } | null
  },
  "filters": [
    { "columnId": "<uuid>", "fieldName": "col_...", "op": "eq"|"ne"|"gt"|"gte"|"lt"|"lte"|"in"|"between", "value": ... }
  ],
  "transformations": [
    { "kind": "aggregate"|"bin"|"normalise", /* explicit, reproducible params */ }
  ],
  "display": {
    "axes": {
      "x": { "label": "Time (days)", "scale": "linear"|"log", "unit": "d" },
      "y": { "label": "GCN per mL",  "scale": "linear"|"log", "unit": "copies/mL" }
    },
    "series": [
      { "identifier": "LVV-250601 · Rep 1", "label": "Rep 1", "color": "#006edc" }
    ],
    "legend": { "visible": true },
    "annotations": []
  },
  "overlays": {
    "errorBars": {
      "columnId": "<uuid>", "fieldName": "col_...",
      "basis": "sd"|"se"|"range"|"custom",
      "multiplier": 1
    } | null
  }
}
```

Rules:

- `specVersion` is required and fixed at 1 for this ADR; future spec shapes
  widen it and the validators branch on it.
- `type` is one of `line`, `scatter`, `bar`. Unsupported types are rejected.
- `datasets` is a non-empty array of `{ tableId }`. Phase 1 supports one
  dataset; the array shape keeps multi-dataset joins open without a schema
  change. Every `tableId` must reference an active `scientific_tables` row in
  the **same workspace** as the owning block; the DB trigger enforces this.
- `fields.y` is required; `fields.x` is required for `line` and `bar`,
  optional for `scatter` (which can plot y against row order). `series`,
  `color` and `size` are optional field mappings.
- `filters`, `transformations`, `display` and `overlays` are explicit parts of
  the spec. There are no implicit aggregations or hidden error bars: a chart
  that shows error bars must carry an `overlays.errorBars` definition naming
  the source column and the statistical basis, so a reader can reproduce it.
- Series colours in `display.series` must come from the approved palette in
  `DESIGN.md` (Laboratory Blue, Success Green, Analysis Violet, Analysis Cyan,
  Warning Amber). The validator enforces the allow-list.
- A log scale is rejected at validation/render time when the mapped column
  contains non-positive values (`log-scale invalid`). This is checked in the
  renderer against live/frozen data and reported as a render-time state, not
  stored on the spec.

### 4. Dataset reference resolution and stability

A chart references a dataset by the stable `scientific_tables.id` UUID, never
by resource name or row copy. The reference stays valid when rows are added or
columns are reordered because column identity is the UUID
`scientific_columns.id` (ADR 0019), and field mappings use
`{ columnId, fieldName }`. `fieldName` is carried for readability and as a
fallback diagnostic; `columnId` is the authoritative binding. If a referenced
column is retired, the chart reports a `missing_field` state rather than
silently dropping a series.

### 5. Live vs frozen charts

A chart block is **live** when `frozen` is `null`. Rendering re-reads the
current dataset rows through the same PostgREST resources the sheet uses, so a
live chart reflects the latest data, schema version and calculations.

A chart block is **frozen** when `frozen` is a `FrozenChart`:

```jsonc
{
  "revisionId": "<uuid of the revision this freeze belongs to> | null",
  "frozenAt": "<iso timestamp>",
  "frozenByUserId": "<user id>",
  "datasetProvenance": [
    {
      "tableId": "<uuid>",
      "schemaVersion": 3,
      "rowCount": 10,
      "checksum": "<md5 of materialised rows>",
    },
  ],
  "data": {
    "columns": [
      {
        "columnId": "<uuid>",
        "fieldName": "col_...",
        "label": "Time (days)",
        "unit": "d",
        "logicalType": "integer",
      },
    ],
    "rows": [
      {/* materialised, filtered, transformed rows used by the chart */},
    ],
    "series": [
      {
        "identifier": "...",
        "points": [{ "x": 0, "y": 2.31e8, "yError": 1.2e7 }],
      },
    ],
  },
}
```

Freezing is a **transactional RPC** (`freeze_chart`) because it must atomically
re-read the dataset under the block's workspace, validate every dataset
reference is in the same workspace, materialise the filtered/transformed data
and series, record the schema version + row count + checksum, and write the
frozen payload onto the block. `unfreeze_chart` removes `frozen` only when the
chart is not yet locked into a submitted revision (`revisionId` is null or the
revision is not yet submitted); this is the "freeze, unfreeze if not yet
submitted" lifecycle.

Rendering:

- A **live** chart renders from the current dataset and reports `stale` /
  `missing_field` / `empty_dataset` / `log_scale_invalid` states against live
  data.
- A **frozen** chart renders from `frozen.data` only. It never re-reads the
  dataset, so it is reproducible even after the dataset evolves or a column is
  retired. A frozen chart whose `datasetProvenance` no longer matches the live
  dataset is not "stale" — it is intentionally pinned. The UI surfaces the
  frozen provenance so a reader knows the data is not live.

The existing revision snapshot machinery captures the frozen payload verbatim
when a record is submitted, so a chart frozen before submission is reproduced
exactly from the revision's `block_snapshot`. A chart that is live at
submission time is snapshotted as live; the revision captures the spec but not
the data, and reviewing a live-chart revision re-resolves against the dataset
version at review time (Analysis Studio adds explicit dataset-version pinning
for live charts; SCI-004 requires freezing for reproducible review).

### 6. Immutability and permissions at the database

The extended `validate_scientific_block` trigger enforces for `chart` blocks:

- A non-draft payload must have a valid `spec` object with `specVersion`,
  `type`, `datasets`, `fields.y`, and palette colours.
- Every `datasets[].tableId` must reference an active `scientific_tables` row
  in the same workspace as the owning record. Cross-workspace references raise
  `invalid_dataset_reference` (23514).
- A **frozen** chart payload is immutable: any UPDATE that would change a
  frozen chart's `payload` is rejected (23514). The freeze/unfreeze RPCs are
  the only path that mutates `frozen`; they run as SECURITY DEFINER and toggle
  a session guard the trigger honours for the atomic freeze/unfreeze write.
- `api_client` (credential) authored writes are rejected for chart payloads,
  matching the materials/protocol policy that scientific block content is
  user-authored.

Workspace isolation comes from the existing `blocks` RLS; the dataset
reference check adds the cross-workspace dataset boundary on top.

### 7. REST and lifecycle operations

Through the same-origin `/api/db` PostgREST proxy:

- **CRUD**: chart blocks are read/written with the existing `blocks` resource
  and `insert_block` / `update_block_payload` / `move_block` / `delete_block`
  RPCs. A chart block is inserted with `type='chart'` and a draft `{}` or
  initial `spec` payload; payload edits go through `update_block_payload` and
  are subject to the validation trigger.
- **freeze_chart** (`POST /api/db/rpc/freeze_chart`): args `p_block_id`,
  `p_expected_version`. Materialises and freezes. Returns the updated block.
- **unfreeze_chart** (`POST /api/db/rpc/unfreeze_chart`): args `p_block_id`,
  `p_expected_version`. Removes `frozen` if not locked to a submitted
  revision. Returns the updated block.

Both RPCs bump `blocks.version` and emit the standard `block.update` change
event with audit attribution via the existing block trigger — no new event
type. Error shapes follow the stable envelope: `stale_version` (SB001),
`invalid_dataset_reference`, `missing_field`, `frozen_chart_immutable`,
`invalid_chart_spec`.

REST mutations produce the same durable events and audit attribution as UI
mutations because they mutate the same `blocks` rows through the same trigger.

### 8. Rendering and accessibility

The chart renderer is a dependency-free SVG component that consumes a
`ChartSpec` plus materialised rows (live or frozen) and renders line, scatter
and bar charts inside `ChartFrame` using the approved palette and scientific
number formatting (significant digits / SI-prefixed exponents per `DESIGN.md`).
It supports linear and log axes, statistical error bars from `overlays`, and
the explicit transformations in the spec.

Accessibility:

- `ChartFrame`'s `alt` carries a text alternative describing the chart type,
  axes, series and trend.
- A visually-hidden tabular alternative renders the exact data the chart
  renders (the materialised rows/series), so the chart is never the only
  representation. The table is the accessible alternative the ticket requires.
- The legend uses colour-plus-text (palette swatch + label), never colour
  alone.
- Missing-field, empty-dataset, log-scale-invalid and stale-calculation
  states render honest messages rather than blank axes.

### 9. Naming

No new event types. Chart block mutations emit the existing `block.create`,
`block.update`, `block.move`, `block.delete` events. Freeze/unfreeze are
`block.update` operations.

## Consequences

- SCI-004 adds one migration extending `validate_scientific_block` for `chart`
  and adding `freeze_chart` / `unfreeze_chart` RPCs; no new tables, record
  kinds or identity systems.
- The placeholder `chart` validator in `src/lib/blocks` is replaced by the
  real `ChartSpec` validator; the demo seed's placeholder chart payload is
  migrated to the new shape (pre-production, no compatibility shim).
- The Virus Stability demo gains a scientific table (stability assay data) and
  a chart block referencing it, exercising both a live and a frozen chart.
- Analysis Studio (ROADMAP line 117) later adds reusable saved specs,
  multi-dataset joins, additional chart types, export and saved analysis views
  on top of this contract without rewriting it.
- Full dataset-version pinning for _live_ charts in submitted revisions is
  deferred to Analysis Studio / REV-008; SCI-004 requires freezing for
  reproducible review.
