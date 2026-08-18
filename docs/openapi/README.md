# Service-credential OpenAPI (API-03)

Use [`service-credentials-v0.json`](./service-credentials-v0.json) with this
README. You do not need to read application source to integrate.

Regenerate after allowlist or RPC-contract changes:

```bash
pnpm openapi:generate
```

`pnpm generate-routes` is unrelated (TanStack Router). Keep both scripts.

## 1. Authenticate

```http
POST /api/token
Content-Type: application/json

{"credential":"sb_<8 hex>_<32 hex>","scopes":["datasets:read","datasets:write"]}
```

Success: `{"token":"<jwt>"}`. Default TTL 300s. Send
`Authorization: Bearer <jwt>` on every `/api/db/*` call.

Token failures:

```json
{ "error": { "code": "invalid_credential", "message": "Invalid credential." } }
```

`code` is one of `invalid_request`, `invalid_scope`, `invalid_credential`,
`revoked`, `expired`, `insufficient_scope`, `rate_limited`, `server_error`.
There is no `category` or `request_id` on this path.

## 2. Data-path errors

`/api/db/*` failures:

```json
{
  "error": {
    "category": "stale_version",
    "message": "Block version mismatch.",
    "request_id": "01J…"
  }
}
```

Branch on `error.category`. There is no `error.code` on this path. Categories
include `validation_error`, `unauthenticated`, `permission_denied`,
`not_found`, `conflict`, `stale_version`, `missing_link`,
`invalid_transition`, `invalid_properties`, `template_not_instantiable`,
`rate_limited`, `service_unavailable`, `server_error`.

## 3. Table GET: pagination, filters, count

Example — first page of experiments, exact total:

```http
GET /api/db/records?kind=eq.experiment&order=created_at.desc&limit=50&offset=0
Authorization: Bearer <jwt>
Prefer: count=exact
```

| Mechanism | How                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Page      | `limit`, `offset`                                                                                                               |
| Sort      | `order=column.asc` or `column.desc`; repeat `order`                                                                             |
| Filter    | `{column}={op}.{value}` — `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `is`, `cs`, `cd`, `ov`, `fts`, `not`, … |
| Groups    | `and=(…)`, `or=(…)`                                                                                                             |
| Columns   | `select=id,title`                                                                                                               |
| Count     | Header `Prefer: count=exact`. Cheap total: also `Range: 0-0` (or `limit=0`). Read `Content-Range: 0-0/123`.                     |

Dataset INSERT (no create RPC): POST `/api/db/datasets` with
`workspace_id`, `schema_version_id`, `name`. Do not PATCH datasets; commit
rows through the RPC below.

## 4. Dataset commit (idempotency)

```http
POST /api/db/rpc/commit_dataset_row_batch
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "p_dataset_id": "<uuid>",
  "p_expected_dataset_revision": 3,
  "p_idempotency_key": "client-command-01",
  "p_rows": [
    {
      "operation": "create",
      "rowId": "<new-row-uuid>",
      "values": { "<field-uuid>": "measured" }
    }
  ]
}
```

- Field name: **`p_idempotency_key`** (text, 1–128 characters), not a header.
- Digest covers dataset id, expected revision and `p_rows`.
- First success: `{ "ok": true, "datasetId", "datasetRevision", "rows", "idempotent": false }`.
- Retry **the identical body** after a transport failure: same key + same digest → same payload with **`idempotent": true`**.
- Same key, different rows/revision → conflict. On `stale_dataset_revision` / `stale_version`, re-read `datasets.revision` and use a **new** key.
- Validate first with `validate_dataset_row_batch` (same `p_rows` / revision; no idempotency key).

Query live rows with `query_dataset_rows`: `p_limit` 1–1000, `p_offset` ≥ 0,
`p_query.filters` (max 8, operators `eq|gt|gte|lt|lte`) and optional
`p_query.sort`. Limits are **not** inside `p_query`.

## 5. RPC arguments

Every allowlisted RPC is `POST /api/db/rpc/{name}` with a JSON object of
PostgreSQL argument names (`p_*`). The OpenAPI request schema lists types,
required fields, bounds and result shapes. Concurrency fields:

| Surface         | Client sends                                           | Failure                                                                 |
| --------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Block payload   | `p_expected_version`                                   | `stale_version`                                                         |
| Block structure | `p_expected_structure_version`                         | `stale_version`                                                         |
| Record metadata | `p_expected_metadata_version`                          | `stale_version`                                                         |
| Dataset         | `p_expected_dataset_revision` / `p_expected_revision`  | `stale_version` or `{ok:false, errors:[{code:stale_dataset_revision}]}` |
| Sheet Instance  | `p_expected_revision` / `p_expected_instance_revision` | `stale_version`                                                         |

List windows:

| RPC                          | Bounds                                           | Filter fields                                                                             |
| ---------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `query_dataset_rows`         | `p_limit` 1–1000 (default 200), `p_offset` ≥ 0   | `p_query.filters[]` (`fieldId`, `operator`, `value`), `p_query.sort`                      |
| `query_dataset_version_rows` | `p_limit` 1–1000, `p_offset` ≥ 0                 | none                                                                                      |
| `query_sheet_instance_rows`  | `p_limit` 1–200 (default 50), `p_offset` 0–10000 | composition window only                                                                   |
| `search`                     | `p_limit` 1–100 (default 20), `p_offset` ≥ 0     | `p_query`, `p_project_id`, `p_kind`, `p_status`, `p_owner_id`, `p_date_from`, `p_date_to` |
| `search_sheet_records`       | `p_limit` 1–50 (default 25), no offset           | `p_model_key`, `p_query`, `p_include_archived`                                            |

Human-session-only (absent from the spec): `submit_record_revision`,
`run_revision_checks`, `sign_revision`, `create_amendment`.
`reviews:write` is not a submission operation. `reviews:read` is
`preview_submission_digest` only.

## Related docs

- [`../public-api-contract.md`](../public-api-contract.md) — narrative contract
- [`../external-api.md`](../external-api.md) — credential mechanics
- [`../search-api.md`](../search-api.md) — `search` result columns
- [`../notebook-api.md`](../notebook-api.md) — notebook RPC examples (browser session; submit is human-only)
