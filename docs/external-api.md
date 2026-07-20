# External API credentials

Scoped credentials let external integrations read and write Sheetbase data
without a browser session. They exchange a shared secret for a short-lived
PostgREST JWT through `POST /api/token`, then use that JWT against the
same-origin `/api/db` boundary. The browser session is never involved.

## Credential format

A credential string looks like `sb_<prefix>_<secret>`:

- `prefix` — 8 hex chars, stored and shown in the UI so you can identify a
  credential without revealing it.
- `secret` — 32 hex chars, shown **once** at creation, never stored. Only a
  salted SHA-256 hash (`hashSecret(prefix, secret)`) is persisted.

Store the full credential in your integration's secret store immediately. If
you lose it, revoke and create a new one.

## Scopes

| Scope               | Allows                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `projects:read`     | Read projects in the credential's workspace.                                                |
| `projects:write`    | Create/update projects in the credential's workspace.                                       |
| `scientific:read`   | Discover scientific/formula metadata, generated rows, and status-aware calculated results.  |
| `scientific:write`  | Insert literal rows; use with `scientific:read` for canonical update/delete and bulk edits. |
| `scientific:schema` | Call controlled scientific table/column management RPCs; does not imply row access.         |

Future tickets extend the vocabulary. Requesting a scope the credential does
not have returns `insufficient_scope`.

## Exchange

`POST /api/token` with JSON `{ credential, scopes }` returns
`{ token }` — a short-lived JWT (5 min default) carrying `workspace_id`,
`credential_id`, `scopes` and `role: 'api_client'`. Use it as a Bearer
token against `/api/db/*`.

| Response | Code                 | Meaning                               |
| -------- | -------------------- | ------------------------------------- |
| 200      | —                    | Token minted.                         |
| 400      | `invalid_request`    | Missing credential or scopes.         |
| 401      | `invalid_credential` | Wrong secret or malformed credential. |
| 403      | `revoked`            | Credential has been revoked.          |
| 403      | `insufficient_scope` | Credential lacks a requested scope.   |
| 429      | `rate_limited`       | Too many failed attempts; try later.  |

Errors never echo the credential or hint which part was wrong. Failed
attempts are rate-limited per prefix: after 5 failures within 15 minutes,
the prefix is locked for 15 minutes.

## Revocation

Revoking a credential sets `revoked_at`; subsequent exchanges fail
immediately with `revoked`. Revocation is permanent — re-enable by creating
a new credential.

Revocation is also enforced **at use time**, not only at exchange time: a
still-valid bearer token minted before revocation is rejected on the next
`/api/db/*` request with `permission_denied` (`revoked`). There is no window
in which a revoked credential can still read or write data.

## Enforcement layers

An external request passes through three checks before any data moves:

1. **Exchange** (`POST /api/token`) — verifies the credential secret,
   revocation and requested scope, rate-limits guesses, and mints a
   short-lived `api_client` JWT scoped to the credential's workspace.
2. **Proxy** (`/api/db/*`) — verifies the bearer token's signature and
   shape, re-checks revocation against the live credential row, and
   classifies the exact resource and enforces its project or scientific
   capability set. Unknown external resources fail closed.
3. **Row-level security** (PostgreSQL `api_client` policies) — pins every
   read and write to the `workspace_id` claim on the token, so a leaked or
   tampered token cannot cross workspaces even if the proxy were bypassed.

`api_client` has no DELETE privilege on projects in Phase 1: external
credentials cannot destroy projects, regardless of scope.

## Scientific-table CLI examples

Exchange the credential for the capabilities needed by this workflow. Keep the
credential and returned token in a secret store; they are abbreviated here:

```bash
TOKEN="$({ curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -d '{"credential":"sb_…","scopes":["scientific:read","scientific:write","scientific:schema"]}' \
  http://localhost:3000/api/token; } | jq -r .token)"
```

Create a managed table for an existing sheet block, then discover its generated
resource and stable fields. User labels never appear in the REST path:

```bash
curl --fail -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"p_block_id":"<sheet-block-uuid>","p_name":"Measurements","p_columns":[{"label":"Sample","logical_type":"text"},{"label":"Result","logical_type":"decimal","unit":{"code":"mg/L","symbol":"mg/L"}}]}' \
  http://localhost:3000/api/db/rpc/create_scientific_table

curl --fail -G -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'p_table_id=<table-uuid>' \
  http://localhost:3000/api/db/rpc/scientific_table_metadata
```

Use the returned `sheet_…` resource and `col_…` fields for direct row CRUD,
filtering and ordering:

```bash
# Insert one row (an array performs one atomic independent-row bulk insert).
curl --fail -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d '{"col_<sample>":"A-01","col_<result>":1.25}' \
  http://localhost:3000/api/db/sheet_<resource>

# Read/filter/order/page.
curl --fail -G -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'select=id,version,col_<sample>,col_<result>' \
  --data-urlencode 'col_<result>=gte.1' \
  --data-urlencode 'order=col_<sample>.asc' --data-urlencode 'limit=50' \
  http://localhost:3000/api/db/sheet_<resource>

# Update only if the row is still version 1. An empty match is returned as a
# stable 409 stale_version conflict by the Sheetbase boundary.
curl --fail -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"col_<result>":1.5}' \
  'http://localhost:3000/api/db/sheet_<resource>?id=eq.<row-uuid>&version=eq.1'

# Delete only the expected version. Formula-owned rows are rejected.
curl --fail -X DELETE -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3000/api/db/sheet_<resource>?id=eq.<row-uuid>&version=eq.2'

# Atomic multi-row update keyed by stable column UUIDs, not field names.
curl --fail -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"p_table_id":"<table-uuid>","p_expected_schema_version":1,"p_edits":[{"rowId":"<row-uuid>","expectedVersion":2,"values":{"<column-uuid>":2.0}}]}' \
  http://localhost:3000/api/db/rpc/apply_scientific_row_edits

# Read formula definitions and trusted result states for one sheet. A
# calculated_value is returned only when calculation_status=current.
curl --fail -G -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'select=formula_id,target_row_id,target_column_id,source_expression,calculation_status,calculated_value,calculation_error_code,current_input_revision,cache_input_revision' \
  --data-urlencode 'target_table_id=eq.<table-uuid>' \
  http://localhost:3000/api/db/formula_results
```

`formula_definitions` and `formula_dependencies` expose durable provenance.
`formula_results` is the safe calculated-result projection: `pending`, `stale`,
`failed`, and `unavailable` rows never expose a cached scalar as current source
data. Generated `sheet_…` resources remain the authoritative literal surface.

For local development, substitute the exposed application portal for
`http://localhost:3000`. External clients never call PostgREST directly.

## Project CLI example

With a local dev server running (`pnpm dev`):

```bash
scripts/read-project.sh sb_1a2b3c4d_...
```

The script exchanges the credential for a token and reads projects through
`/api/db/projects`. See `scripts/read-project.sh` for the exact calls.

## Tests

`tests/db/api-credentials.test.ts` proves creation, successful exchange,
wrong secret, wrong scope, revocation (including cross-workspace revocation
failure) and rate-limiting.

`tests/db/external-api.test.ts` proves the full external path end to end:
`api_client` RLS workspace isolation, scope enforcement at the proxy,
revocation-at-use with a still-valid token, and a tampered workspace_id
claim being rejected.

`tests/db/scientific-rest.test.ts` proves database-authoritative scientific
scope, workspace, metadata, CRUD, concurrency and bulk-edit behavior.
`tests/api/scientific-rest.test.ts` runs create/read/update/delete/filter and
stale-conflict requests through the same-origin proxy against real PostgREST.
