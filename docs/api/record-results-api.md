# Results on a record API

Every record page has a **Results** tab: each dataset row whose link column
holds the record, grouped by the measurement table it follows. The same read is
on the API, MCP, the assistant, the Python and TypeScript SDKs and in pipelines
(see [lab-api.md](lab-api.md) for scopes and how tokens work). It only reads, so
it sends no webhook events: a new result arrives as the dataset's own row
events.

A result is a dataset row with a **link column** (a measurement table column
that points at a record, see [datasets-api.md](datasets-api.md)). Add a link
column to a measurement table, write rows whose link column holds the record's
id, and those rows show on that record, whatever its type: a sample, a
material, an experiment or a record type your lab defined.

Needs the `datasets:read` scope. You see the datasets you may see and nothing
else; a record you cannot read is refused.

## `record_results`

`POST /api/db/rpc/record_results`, `sheetbase.lab.act` over MCP, or the
assistant's `sheetbase.record_results.read` tool ("results for SMP-2231").

| Argument              | Type | Notes                                                        |
| --------------------- | ---- | ------------------------------------------------------------ |
| `p_record_id` \*      | uuid | The record.                                                  |
| `p_include_snapshots` | bool | Also return rows kept in dataset snapshots. Default `false`. |
| `p_limit`             | int  | Rows to return, 1 to 1000. Default 500.                      |
| `p_offset`            | int  | Rows to skip. Default 0.                                     |

Returns `{ total, rows }`, newest first. `total` counts every matching row, so
a page past `p_limit` is `p_offset` plus `p_limit`. Each row:

```json
{
  "rowId": "…",
  "datasetId": "…",
  "datasetDisplayId": "DS-0311",
  "datasetName": "Growth curve run 4",
  "tableId": "…",
  "tableKey": "growth_curve",
  "tableName": "Growth curve",
  "tableVersion": 2,
  "source": "live",
  "snapshotId": null,
  "snapshotLabel": null,
  "status": "recorded",
  "recordedAt": "2026-11-20T09:12:00Z",
  "values": [
    {
      "fieldId": "…",
      "key": "sample",
      "label": "Sample",
      "type": "reference",
      "unit": null,
      "linksHere": true,
      "value": "<record id>"
    },
    {
      "fieldId": "…",
      "key": "od",
      "label": "OD600",
      "type": "decimal",
      "unit": "AU",
      "linksHere": false,
      "value": 0.42
    }
  ]
}
```

- `source` is `live` for the row as it is now, or `snapshot` (with
  `snapshotId` and `snapshotLabel`) for a copy kept in a snapshot.
- `status` is `recorded`, or `planned` for a row still waiting for its
  measurement.
- `linksHere` marks the link column that holds this record. Another link
  column's value is the id of the record it points at.
- A category value is its label; a many-valued field is a list.

To read one table's rows across every dataset rather than one record's, use the
dataset reads in [datasets-api.md](datasets-api.md). The raw cells are on
`dataset_row_values` (live) and `dataset_version_values` (snapshots), where the
link value is `reference_id`.

## Python

```python
results = client.rpc.record_results(p_record_id=sample_id, p_include_snapshots=False)
for row in results["rows"]:
    print(row["tableName"], row["datasetDisplayId"], row["source"])
```
