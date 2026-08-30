# Sheetbase Python SDK

A typed Python client for the [Sheetbase ELN](https://github.com/phlohouse/sheetbase-eln) public API.

Scientific Python users can query datasets, commit rows, manage projects/records and search the workspace without hand-writing HTTP.

## Install

```bash
pip install sheetbase
```

Dependencies: `httpx`, `pandas` (Python ≥ 3.10).

## Quick start

```python
from sheetbase import SheetbaseClient

client = SheetbaseClient(
    base_url="https://app.sheetbase.co.uk",
    credential="sb_01234567_...",
    scopes=["datasets:read", "datasets:write"],
)

# List projects
projects = client.projects.list()

# Query dataset rows and convert to pandas
page = client.datasets.query_rows(dataset_id="...")
df = page.to_dataframe()

# Iterate all rows with auto-pagination
for row in client.datasets.iter_rows(dataset_id="..."):
    print(row["values"])

# Commit rows with automatic idempotency and stale-version retry
from sheetbase.resources.datasets import DatasetRowBatch
import uuid

batch = DatasetRowBatch()
batch.create(values={"field-uuid-1": 1.2e9, "field-uuid-2": "HEK293T"})
batch.create(values={"field-uuid-1": 8.5e8, "field-uuid-2": "Vero"})

result = client.datasets.commit_rows(
    dataset_id="...",
    expected_revision=3,
    rows=batch,
)

# Upload a DataFrame directly
df = client.datasets.download_dataframe(dataset_id="...")
client.datasets.upload_dataframe(
    dataset_id="...",
    expected_revision=3,
    df=df,
)

# Context manager closes the HTTP connection pool
with SheetbaseClient(...) as client:
    ...
```

## Async

```python
import asyncio
from sheetbase import AsyncSheetbaseClient

async def main():
    async with AsyncSheetbaseClient(
        base_url="https://app.sheetbase.co.uk",
        credential="sb_...",
        scopes=["datasets:read"],
    ) as client:
        projects = await client.projects.list()
        page = await client.datasets.query_rows(dataset_id="...")
        df = page.to_dataframe()

asyncio.run(main())
```

## Authentication

Both credential kinds (workspace service credentials and personal API tokens) use the same `sb_<prefix>_<secret>` format. The SDK exchanges the credential for a short-lived JWT at `POST /api/token` and automatically refreshes it before expiry.

```python
client = SheetbaseClient(
    base_url="https://app.sheetbase.co.uk",
    credential="sb_01234567_0123456789abcdef0123456789abcdef",
    scopes=["datasets:read", "datasets:write", "projects:read"],
)
```

## Error handling

Errors map to stable categories from the [public API contract](https://github.com/phlohouse/sheetbase-eln/blob/main/docs/public-api-contract.md):

```python
from sheetbase.errors import StaleVersionError, PermissionDeniedError, NotFoundError

try:
    client.datasets.commit_rows(...)
except StaleVersionError:
    # Optimistic concurrency mismatch — re-read and retry
    ...
except PermissionDeniedError as e:
    print(f"Denied: {e.category} (request_id={e.request_id})")
except NotFoundError:
    ...
```

Token-path errors use `TokenError` with a `.code` attribute (`invalid_credential`, `revoked`, `insufficient_scope`, etc.).

## Resources

| Resource | Operations |
|----------|-----------|
| `client.projects` | List, get, get_by_key, create, update, iter |
| `client.records` | List, get, create, update, archive, restore, transition_status, create_link, iter |
| `client.datasets` | List, get, create, query_rows, query_version_rows, iter_rows, iter_version_rows, validate_rows, commit_rows, snapshot, archive, restore, to_dataframe, upload_dataframe, download_dataframe |
| `client.sheets` | List, get, create, create_from_definition, update, query_rows, iter_rows, archive, restore, duplicate, materialize, preview_materialize, mutate_local_state, mutate_calculations |
| `client.search` | search, search_sheet_records, iter |
| `client.catalogues` | Schema definitions, schema versions, schema version fields, sheet definitions, templates, instantiate_template |

## Pagination

All list/query methods support `limit`/`offset` for manual paging. For auto-pagination, use the `iter_*` methods which return generators:

```python
for project in client.projects.iter():
    print(project.key)

for row in client.datasets.iter_rows(dataset_id="..."):
    print(row["values"])
```

## Development

```bash
cd sdks/python
pip install -e ".[dev]"
pytest
```
