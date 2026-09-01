# Sheetbase Python SDK

A typed Python client for the [Sheetbase ELN](https://github.com/phlohouse/sheetbase-eln) public API.

Scientific Python users can query datasets, commit rows, manage projects/records and search the workspace without hand-writing HTTP.

## Install

```bash
pip install sheetbase
```

Dependencies: `httpx`, `pandas` (Python ≥ 3.10).

This package targets public API contract `0.1.0`. The complete Python /
TypeScript operation inventory and shared wire-semantics decisions live in the
[SDK support matrix](../SUPPORT_MATRIX.md).

### Versioning & compatibility

- Package versions follow SemVer; the package version and the supported
  public API contract version (`API_VERSION`) are separate numbers, and each
  release documents which contract version it supports in the
  [compatibility table](../SUPPORT_MATRIX.md#package-compatibility).
- `API_VERSION` is machine-checked against the committed OpenAPI contract
  (`docs/openapi/external-api-v0.json` `info.version`) and the support
  matrix by the test suite, so taxonomy or version drift fails CI.
- The exception taxonomy (`TOKEN_ERROR_CODES`, `ERROR_CATEGORIES` and the
  typed exception classes) is stable public surface: additions go through the
  support matrix in both SDKs; removals or renames are breaking changes.
- Release procedure, change policy and reproducibility notes:
  [`sdks/RELEASE.md`](../RELEASE.md).

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

# Version access — frozen-evidence entry points
versions = client.datasets.list_versions(dataset_id="...")
frozen_df = client.datasets.version_to_dataframe(str(versions[0].id))

# Analysis ergonomics — field labels from the schema version
labels = client.datasets.field_label_map(str(dataset.schema_version_id))
df = client.datasets.to_dataframe(dataset_id="...", field_labels=labels)

# Provenance — immutable record revision trail
history = client.records.history(record_id="...")

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

| Resource                  | Operations                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.projects`         | List, get, get_by_key, create, update, iter                                                                                                                                                                                                                                     |
| `client.records`          | Record, block, custom-field, template, submission-preview and revision-history operations                                                                                                                                                                                       |
| `client.datasets`         | List, get, create, query_rows, query_version_rows, iter_rows, iter_version_rows, validate_rows, commit_rows, snapshot, archive, restore, list_versions, iter_versions, schema_fields, field_label_map, to_dataframe, upload_dataframe, download_dataframe, version_to_dataframe |
| `client.sheets`           | Sheet-instance queries/mutations, calculation results, composition/definition upgrades, materialization, notebook blocks and model write-back                                                                                                                                   |
| `client.search`           | search, search_sheet_records, iter                                                                                                                                                                                                                                              |
| `client.catalogues`       | Schema/sheet-definition/template reads and notebook-template instantiate/upgrade RPCs                                                                                                                                                                                           |
| `client.agent_operations` | Agent proposal and workflow create/advance/usage/cancel RPCs plus audit-table reads                                                                                                                                                                                             |
| `client.webhooks`         | Subscription create/update/delete/secret rotation, delivery pagination/replay and table reads                                                                                                                                                                                   |

Agent operation, workflow, provenance and budget dictionaries remain in the
canonical contract shape and are validated by the server. The SDK deliberately
does not reproduce policy, transition, budget or scientific business rules.

All public table operations are also available through `table_get`,
`table_head`, `table_post` and `table_patch`. `table_head` returns
`Content-Range`, a parsed total count when present, and the request id. Use
`headers={"Prefer": "count=exact"}` when an exact total is required.

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
pytest   # contract parity, smoke path, resources, async client
```

The package installs and builds standalone (`uv build` → wheel + sdist); it
depends only on `httpx` and `pandas`, never on the application source tree.
