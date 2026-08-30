# Chart notebook block API

SCI-004 uses the existing authenticated same-origin `/api/db` boundary
(ADR 0029). A chart is a `blocks` row with `type='chart'` and a versioned
JSONB `payload` (`payload_schema_version=1`). UUIDs and credentials in this
document are placeholders.

## Contract summary

- A chart specification:
  - references canonical Datasets (`api.datasets`, decision 0037) by UUID,
  - binds fields by stable `dataset_schema_version_fields.field_id`,
  - keeps filters, transformations, and overlays explicit,
  - confines chart-type-specific logic to the `type` discriminator
    (`line`, `scatter`, `scatter_line`, `connected_scatter`, `bar`,
    `grouped_bar`, `stacked_bar`, `histogram`, `box`, `violin`, `strip`,
    `summary`, `heatmap`). See `docs/visualisations.md`.
- Shared infrastructure holds no chart-type-specific or dataset-specific
  columns. The spec is a validated JSONB payload.
- A **live** chart reads rows through `query_dataset_rows` (keyed by
  field_id). The client caps reads at 5000 rows and shows a true
  over-limit state. A **frozen** chart carries an immutable materialised
  snapshot with provenance (dataset id, schema version number, row count,
  checksum). Submission stamps `frozen.revisionId` automatically.
- Ordinary CRUD rejects frozen-chart mutations. Only the
  `freeze_chart` / `unfreeze_chart` transactional SECURITY DEFINER RPCs may
  write a frozen payload. Each RPC re-validates JWT workspace/actor
  authority.

## Resources

- `GET /api/db/blocks?record_id=eq.<experiment-id>&type=eq.chart&order=order.asc`
  — list chart blocks for a record.
- `GET /api/db/blocks?id=eq.<chart-block-id>&select=id,type,payload` — read
  one chart block.
- `GET /api/db/datasets?lifecycle=eq.active&select=id,name,schema_version_id`
  — list available Datasets. RLS limits results to the active workspace.
- `GET /api/db/dataset_schema_version_fields?schema_version_id=eq.<id>&lifecycle=eq.active`
  — fetch the pinned schema fields for field mapping.
- `POST /api/db/rpc/query_dataset_rows` — read live rows (values keyed by
  field_id; limit ≤1000 per call, page with offset).
- `POST /api/db/rpc/insert_block` — insert a chart block. A draft `{}` is
  valid.
- `POST /api/db/rpc/update_block_payload` — ordinary content edit (title,
  spec, display settings). Rejected when the chart is frozen.

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

An empty draft `{}` is valid, so the editor opens immediately. The response
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
      "datasets": [{ "datasetId": "<dataset-id>" }],
      "fields": {
        "x": { "fieldId": "<time-field-id>" },
        "y": { "fieldId": "<titer-field-id>" },
        "series": { "fieldId": "<condition-field-id>" },
        "color": null,
        "size": null,
        "facet": null
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
          "fieldId": "<error-field-id>",
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

- an invalid chart type;
- a dataset reference to a Dataset in another workspace or a non-active one;
- a field binding that is not a UUID `fieldId` of the referenced Dataset's
  pinned Schema Version.

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
(rows, rendered series, referenced columns, md5 checksum, dataset
provenance) and bumps `blocks.version`. A stale `p_expected_version` returns
`stale_version` (SB001). An empty dataset returns a validation error. The
frozen payload is immutable to ordinary `update_block_payload` edits.

## Revision binding at submission

Submitting the record stamps `frozen.revisionId` on every frozen
chart/analysis block of that record whose revisionId is still null. This
happens inside the canonical submission transaction (`submit_record_revision`
allocates the revision UUID, binds the evidence, then captures the snapshot
and digest). The submitted snapshot, live blocks, and digest all agree.
After binding, `unfreeze_chart` is rejected.

## Unfreeze (before submission)

```http
POST /api/db/rpc/unfreeze_chart
Content-Type: application/json

{
  "p_block_id": "<chart-block-id>",
  "p_expected_version": 3
}
```

The RPC removes the frozen payload. The chart can then be edited live again.
It is rejected once the chart is bound to a submitted revision.

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

REST mutations produce the same durable `change_events` and audit
attribution as UI mutations. `insert_block`, `update_block_payload`, and the
lifecycle RPCs all emit `block.create` / `block.update` events with the JWT
actor.
