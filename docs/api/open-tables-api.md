# Open tables API

Open tables write a workspace's model views, measurement tables and dataset
versions as Parquet files on the workspace's own file store, with DuckLake
catalogue tables beside them. Analysts then read the data in DuckDB, Polars or
Spark without going through Sheetbase. For what it means and how to set it up,
see [`../operations/open-tables.md`](../operations/open-tables.md).

## Reading

`GET /api/db/lake_tables` (scope `datasets:read`; only people with data access
see rows). One row per table: `table_name`, `source_kind` (`model_view` or
`dataset`), `status` (`pending`, `ready`, `failed`), `row_count`, `byte_size`,
`file_count`, `columns`, `snapshots` (the snapshots a time-travel query can use),
`last_snapshot_at` and `last_error`.

Each dataset version is its own snapshot, so `lab.main.ds_<display id>` at
version _n_ matches what the app shows for that version.

## Calls

| Call                                      | Scope         | What it does                                                        |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------- |
| `POST /api/db/rpc/lake_settings`          | `admin:read`  | Whether open tables are on, and how the last pass went              |
| `POST /api/db/rpc/set_lake_settings`      | `admin:write` | Turn them on or off. The tables follow the person who turns them on |
| `POST /api/db/rpc/request_lake_refresh`   | `admin:write` | Ask for a pass now                                                  |
| `POST /api/db/rpc/list_lake_credentials`  | `admin:read`  | The logins that can read the tables (never their passwords)         |
| `POST /api/db/rpc/revoke_lake_credential` | `admin:write` | Stop a login straight away                                          |

Making a login hands out a password that is shown once, so it is done at
Settings > Open data. Turning tables on needs a personal token and the
caller's own data access.

## Reading the tables

A login is a read-only database user that can see the catalogue and nothing
else, plus a bearer token for the file endpoint
`/api/lake/files/<workspace id>/main/<table>/<file>.parquet` (HTTP range
requests are supported). The settings page shows ready-made DuckDB, Polars
and Spark snippets; the DuckDB form is:

```sql
INSTALL ducklake; INSTALL postgres; INSTALL httpfs;
CREATE SECRET lab_files (TYPE http, BEARER_TOKEN '<login password>');
ATTACH 'ducklake:postgres:dbname=<db> host=<host> port=<port> user=<login> password=<login password>' AS lab (
  DATA_PATH 'https://<app>/api/lake/files/<workspace id>/',
  OVERRIDE_DATA_PATH true,
  METADATA_SCHEMA 'lake_<workspace id without dashes>',
  READ_ONLY
);
SELECT * FROM lab.main.<table> LIMIT 10;
```

## Who sees what

Row-level security does not follow a Parquet file. Instead the tables are
written **as the person who turned them on**, through the same views and
row-level rules that person is subject to, and a login can read the result.
So the tables hold what that person can see, and anyone with a login reads all
of it. Logins therefore need data access and stop working when their owner
loses it. A lab that wants per-person filtering keeps using SQL logins on the
reporting views (see [`../operations/data-access.md`](../operations/data-access.md)).

## Events

`lake.table.updated` and `lake.settings.updated`; see
[`event-catalogue.md`](event-catalogue.md).
