# 0020. Scientific REST scope, concurrency and bulk-edit contract

- Status: Accepted
- Date: 2026-07-19
- Ticket: DATA-003
- Builds on: 0005, 0006, 0016, 0019

## Context

DATA-002 creates one generated PostgreSQL relation per scientific table. The
browser and external clients now need to discover those relations, query and
mutate their rows through the shared PostgREST boundary, and evolve their
schemas without weakening workspace isolation. Generated resources also make
two existing defaults unsafe: classifying every external resource as a project,
and treating a zero-row PostgREST mutation as success.

## Decision

### Capability vocabulary

External credentials use three independent scientific capabilities:

| Capability          | Permits                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `scientific:read`   | Scientific metadata, generated-row reads, filters and pagination.                                       |
| `scientific:write`  | Literal row insertion. Canonical update/delete and bulk editing additionally require `scientific:read`. |
| `scientific:schema` | Controlled table and column management RPCs. It does not imply row access.                              |

The proxy classifies generated resources only by the exact
`sheet_[a-z2-7]{26}` contract and scientific RPCs by an explicit allowlist.
Unknown resources fail closed. PostgreSQL independently checks the claim role,
workspace, actor shape and scopes in RLS or the `SECURITY DEFINER` entrypoint;
the proxy check improves errors but is not the authority.

Browser claims remain membership-based. API-client policies pin the claim,
metadata owner and generated row to the same workspace. Request roles get
table-level `SELECT` and permitted `DELETE`, but only active literal columns get
`INSERT`/`UPDATE`; reserved, retired and formula-marker fields remain
unwritable. The generated-row trigger remains the final authority preventing
deletion of formula-owned rows.

### Discovery and raw rows

`scientific_table_metadata(p_table_id default null)` is the stable discovery
RPC. It returns active table metadata, active columns in display order, nested
active category options and a `relationships` array. Phase 4 initially returns
an empty relationship array; CALC-002 adds stable source relationships without
changing the response shape. Raw scientific values are never included.

The metadata response publishes each immutable `resource_name` and each
column's immutable `field_name`. Clients then use ordinary PostgREST requests
against `/api/db/<resource_name>` for projection, filters, ordering,
`limit`/`offset`, range pagination and direct literal CRUD.

### Optimistic concurrency and safe writes

Generated PATCH and DELETE requests must contain exactly one
`id=eq.<uuid>` and one `version=eq.<positive integer>`. The same-origin proxy
replaces caller preferences with
`handling=strict,max-affected=1,return=representation`. A successful empty
result is a `409 stale_version`, not a `204` success. The row trigger increments
`version` and `updated_at` once for a successful update.

One PostgREST POST may insert one row or an array of independent rows; the
request is one PostgreSQL transaction. Atomic paste/fill uses
`apply_scientific_row_edits(table_id, expected_schema_version, edits)`. Edits
are keyed by stable row and column UUIDs, include every expected row version,
lock metadata then rows in stable order, validate the entire batch, and update
each row once. A validation report writes nothing. Schema or row version
mismatch uses `SB001` and the stable stale-version envelope.

### Schema-cache readiness

Management RPCs return additive generated `resourceName` and, where relevant,
`fieldName` values. After create/add/convert commits, the proxy polls the
authenticated PostgREST OpenAPI cache with bounded backoff until that generated
shape appears. If the DDL committed but the cache remains stale, the response is
`503 service_unavailable` with retry guidance; the committed schema is not
reported as rolled back.

Unsafe query keys or oversized values reject the whole proxy request. They are
never silently removed, because dropping a mutation predicate would fail open.
Range request and response headers are passed through.

## Consequences

- A credential can inspect data without gaining DDL, or manage schema without
  gaining scientific values.
- Canonical external row mutations normally request both read and write scopes.
- Labels remain data; only generated identifiers reach dynamic SQL and every
  value remains a bound parameter or typed JSON value.
- Clients can distinguish a stale row from a successful no-op without parsing
  PostgREST internals.
- Bulk edits are slower than unconstrained dynamic SQL because they preflight
  every target, but they preserve atomicity, attribution and structured errors.
- Adding an external PostgREST resource requires an explicit scope-classifier
  decision rather than inheriting an unrelated capability.
