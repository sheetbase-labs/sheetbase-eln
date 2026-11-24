# Results across datasets API

A **measurement table** says what one kind of result looks like (ViCell
viability, ddPCR titre). Many datasets are built on it. These two reads return
the rows of one measurement table across every dataset you can open, live or
pinned to snapshots, with the dataset and snapshot each row came from. They are
the same call the **Results** tab of a measurement table makes, and they are
available with a token, over MCP (`sheetbase.lab.act`), to the assistant (which
can also analyse the rows), as pipeline actions and from the Python SDK.

Both run as the person (or personal token) that calls them, and only read
datasets that person can open: a dataset in a project they cannot see is never
read or listed, and naming one is refused exactly as if it were not on the
table. Webhook events: none, they only read. Scope: `datasets:read`.

## How rows line up

- A **column** is a field of the table's latest published version. Each field
  keeps its id across versions, so a dataset still on an older version lines up
  under the same column; a column it did not have yet reads as `null`.
- A dataset on a **subtype** of the table counts, because a subtype holds every
  column of its parent. Pass `includeSubtypes: false` to leave them out.
- **Live** rows are the dataset as it is now. A **snapshot** row is the frozen
  copy, so a result read from a snapshot never changes. `mode` is `live` (the
  default) or `latest_snapshot` (each dataset's newest snapshot; a dataset with
  none is left out and listed under `skipped`). `pins` reads a named snapshot of
  a named dataset whatever the mode says.
- Planned rows (waiting for a reading) hold no values and are left out.
- Every row says where it came from: `datasetId`, `datasetDisplayId`,
  `datasetName`, `datasetVersionId` and `snapshotLabel` (both `null` for live),
  `live`, `datasetRevision` and `schemaVersion`.

```bash
# What holds this kind of result, and which snapshots exist
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://app.example/api/db/rpc/measurement_table_sources \
  -d '{"p_schema_definition_id":"<measurement table id>"}'

# Viability of 90 or more across every dataset, newest snapshots, best first
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://app.example/api/db/rpc/query_measurement_table_rows \
  -d '{"p_schema_definition_id":"<measurement table id>","p_query":{"mode":"latest_snapshot","filters":[{"field":"viability","operator":"gte","value":90}],"sort":{"field":"viability","direction":"desc"}},"p_limit":50}'
```

```python
from sheetbase import Client

client = Client(...)
page = client.datasets.query_measurement_table(
    "<measurement table id>",
    mode="latest_snapshot",
    record_id="<sample record id>",   # only rows that link to this record
)
for row in page.rows:
    print(row["datasetDisplayId"], row["snapshotLabel"], row["values"])
```

## As an analysis input

- **Assistant.** `sheetbase.analysis.run` takes `table` (a measurement table by
  name or key) in place of `dataset`. Every dataset that holds the table is read
  together and each row carries `source_dataset` and `source_snapshot`, so a
  comparison can group by dataset. `tableDatasets` and `tableRecord` narrow it,
  and `snapshot: "latest"` reads newest snapshots instead of live rows. Nothing
  is stored.
- **API and pipelines.** `query_measurement_table_rows` is a pipeline action, so
  a step can read the rows and a later step (or a code cell, or the results
  analysis plugin) can work on them. To keep a reproducible input, read from
  snapshots (`latest_snapshot` or `pins`): the rows never change.

## Actions and lookups

### `measurement_table_sources`

The datasets, and their snapshots, that hold a measurement table. Every dataset
you can open that is built on a measurement table (and, unless
`p_include_subtypes` is false, on a table that extends it), with its row count
and the snapshots it has, so you can choose what `query_measurement_table_rows`
reads. A dataset you cannot open is not listed.

Scope: `datasets:read`. Returns a list of `{ datasetId, displayId, name,
tableId, tableKey, schemaVersion, revision, rowCount, snapshots }`; each snapshot
is `{ datasetVersionId, label, createdAt, sourceRevision, rowCount }`.

| Parameter                | Type | Required | Notes                                                              |
| ------------------------ | ---- | -------- | ------------------------------------------------------------------ |
| `p_schema_definition_id` | uuid | yes      | The measurement table.                                             |
| `p_include_subtypes`     | bool | no       | Count datasets on a table that extends this one. True if left out. |

### `query_measurement_table_rows`

Rows of a measurement table across every dataset that holds it. `p_query` may
hold `mode`, `datasets` (only these dataset ids), `pins` (`{ dataset id: dataset
version id }`), `includeSubtypes`, `recordId` (only rows that link to this
record in any link column), `filters` (up to eight `{ field, operator, value }`;
`field` is a column key or field id and `operator` is `eq`, `gt`, `gte`, `lt` or
`lte`) and `sort` (`{ field, direction }`). `p_limit` is 1 to 1000 (default 200);
page with `p_offset` while `hasMore` is true.

Scope: `datasets:read`. Also a pipeline action. Returns `{ tableId, tableKey,
tableName, schemaVersionId, schemaVersion, mode, columns, sources, skipped,
offset, limit, totalCount, hasMore, rows }`. `sources` lists each dataset (and
snapshot, or live) that was read; `skipped` lists datasets left out and why.

| Parameter                | Type | Required | Notes                                                      |
| ------------------------ | ---- | -------- | ---------------------------------------------------------- |
| `p_schema_definition_id` | uuid | yes      | The measurement table.                                     |
| `p_query`                | json | no       | What to read. `{}` reads every dataset you can open, live. |
| `p_limit`                | int  | no       | Page size, 1 to 1000. 200 if left out.                     |
| `p_offset`               | int  | no       | Rows to skip. 0 if left out.                               |

An unknown column, operator or value of the wrong type is refused with
`22023`; a dataset you cannot open, or one not on this table, with `42501`.
