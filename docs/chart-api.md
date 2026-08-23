# Chart notebook block API

SCI-004 uses the existing authenticated same-origin `/api/db` boundary
(ADR 0029). A chart is a `blocks` row with `type='chart'` and a versioned
JSONB `payload` (`payload_schema_version=1`). UUIDs and credentials below are
placeholders.

## Contract summary

- A chart specification references one or more stable datasets
  (`scientific_tables`) by UUID, maps fields by `{ columnId, fieldName }`,
  keeps filters/transformations/overlays explicit, and confines
  chart-type-specific logic to the `type` discriminator (`line`, `scatter`,
  `bar`, and — SCI-01 — `histogram`, `box`, `heatmap` with per-type
  parameters on `spec.typeParams`).
- No chart-type-specific or dataset-specific columns live in shared
  infrastructure; the spec is a validated JSONB payload.
- A **live** chart re-reads the current dataset state through the shared
  scientific-sheet-data client. A **frozen** chart carries an immutable
  materialised snapshot with provenance (table id, schema version, row count,
  checksum) and is pinned to a submitted revision via `bind_chart_revision`.
- Frozen-chart mutations are rejected by ordinary CRUD; only the
  `freeze_chart` / `unfreeze_chart` / `bind_chart_revision` transactional
  SECURITY DEFINER RPCs may write a frozen payload, and each re-validates JWT
  workspace/actor authority.

## Resources

- `GET /api/db/blocks?record_id=eq.<experiment-id>&type=eq.chart&order=order.asc`
  — list chart blocks for a record.
- `GET /api/db/blocks?id=eq.<chart-block-id>&select=id,type,payload` — read a
  single chart block.
- `GET /api/db/scientific_tables?select=id,name&lifecycle=eq.active` — list
  available datasets (RLS limits to the active workspace).
- `GET /api/db/rpc/scientific_table_metadata?p_table_id=<table-id>` — fetch a
  dataset's columns and metadata for field mapping.
- `GET /api/db/<resource_name>?select=*&order=created_at.asc,id.asc` — read
  the dataset rows a live chart resolves.
- `POST /api/db/rpc/insert_block` — insert a chart block (draft `{}` is
  valid).
- `POST /api/db/rpc/update_block_payload` — ordinary content edit (title,
  spec, display settings). Rejected when the chart is frozen.

All resources accept normal bounded PostgREST equality, `in`, ordering,
range, and selected-column filters allowed by the shared proxy. RLS limits
every result to the active workspace.

## Insert a chart block

```http
POST /api/db/rpc/insert_block
Content-Type: application/json

{
  "p_record_id": "<experiment-record-id>",
  "p_type": "chart",
  "p_payload": {},
  "p_payload_schema_version": 1,
  "p_expected_structure_version": 4
}
```

An empty draft `{}` is valid so the editor opens immediately. The response
contains the new block and the bumped `structure_version`.

## Update a chart specification

```http
POST /api/db/rpc/update_block_payload
Content-Type: application/json

{
  "p_block_id": "<chart-block-id>",
  "p_payload": {
    "title": "Stability curve",
    "spec": {
      "specVersion": 1,
      "type": "line",
      "datasets": [{ "tableId": "<scientific-table-id>" }],
      "fields": {
        "x": { "columnId": "<time-column-id>", "fieldName": "col_time" },
        "y": { "columnId": "<titer-column-id>", "fieldName": "col_titer" },
        "series": { "columnId": "<condition-column-id>", "fieldName": "col_condition" },
        "color": null,
        "size": null
      },
      "filters": [],
      "transformations": [],
      "display": {
        "axes": {
          "x": { "label": "Time (days)", "scale": "linear", "unit": "d" },
          "y": { "label": "Log titer", "scale": "log", "unit": "log₁₀" }
        },
        "series": [
          { "identifier": "4 °C", "label": "4 °C", "color": "#006EDC" },
          { "identifier": "−20 °C", "label": "−20 °C", "color": "#00A659" }
        ],
        "legend": { "visible": true }
      },
      "overlays": {
        "errorBars": {
          "columnId": "<error-column-id>",
          "fieldName": "col_sd",
          "basis": "sd",
          "multiplier": 1
        }
      }
    },
    "provenance": "Stability readings (qPCR)",
    "frozen": null
  },
  "p_expected_version": 1,
  "p_payload_schema_version": 1
}
```

The DB trigger `validate_scientific_block` rejects:

- an invalid chart type (only `line`, `scatter`, `bar`);
- a dataset reference to a `scientific_table` in another workspace or a
  non-active table;
- a column binding whose `columnId`/`fieldName` does not match the referenced
  table's active columns;
- a series colour outside the approved palette;
- a structurally invalid spec.

## Freeze a chart into an immutable snapshot

```http
POST /api/db/rpc/freeze_chart
Content-Type: application/json

{
  "p_block_id": "<chart-block-id>",
  "p_expected_version": 2
}
```

The RPC transactionally materialises the dataset into the `frozen` payload
(rows, rendered series, referenced columns, md5 checksum, dataset provenance)
and bumps `blocks.version`. A stale `p_expected_version` returns
`stale_version` (SB001). An empty dataset returns a validation error. The
frozen payload is immutable to ordinary `update_block_payload` edits.

## Pin a frozen chart to a submitted revision

```http
POST /api/db/rpc/bind_chart_revision
Content-Type: application/json

{
  "p_block_id": "<chart-block-id>",
  "p_revision_id": "<revision-id>",
  "p_expected_version": 3
}
```

Records `frozen.revisionId` so the chart is traceable to the exact submitted
revision. Once bound, `unfreeze_chart` is rejected.

## Unfreeze (before submission)

```http
POST /api/db/rpc/unfreeze_chart
Content-Type: application/json

{
  "p_block_id": "<chart-block-id>",
  "p_expected_version": 3
}
```

Removes the frozen payload so the chart can be edited live again. Rejected
once the chart is bound to a submitted revision.

## Error shapes

| Condition                 | Proxy category     | Notes                                                                                                                                                             |
| ------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing dataset reference | `validation_error` | The referenced `scientific_table` is absent or not active.                                                                                                        |
| Missing field             | `validation_error` | A bound column is absent from the referenced table.                                                                                                               |
| Empty dataset             | `validation_error` | Freeze rejects an empty filtered dataset.                                                                                                                         |
| Invalid log-scale values  | `validation_error` | A log axis has non-positive values (live renderer surfaces this state).                                                                                           |
| Stale calculation         | `stale_version`    | A stale `p_expected_version` on freeze/unfreeze/bind (SB001). A stale HyperFormula result for a plotted column surfaces as a `stale` render state in the live UI. |
| Frozen immutability       | `validation_error` | Ordinary `update_block_payload` on a frozen chart is rejected.                                                                                                    |
| Cross-workspace dataset   | `validation_error` | A chart cannot reference a dataset in another workspace.                                                                                                          |
| Cross-workspace read      | (empty result)     | RLS returns `[]` for blocks outside the active workspace.                                                                                                         |
| Unauthenticated           | `unauthenticated`  | The proxy rejects before reaching PostgREST.                                                                                                                      |

REST mutations produce the same durable `change_events` and audit attribution
as UI mutations: `insert_block`, `update_block_payload`, and the lifecycle
RPCs all emit `block.create` / `block.update` events with the JWT actor.
