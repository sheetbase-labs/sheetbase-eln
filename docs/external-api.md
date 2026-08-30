# External API credentials

Two kinds of scoped credential let external integrations read and write
Sheetbase data without a browser session. Both use the same
`sb_<prefix>_<secret>` format. Both exchange their shared secret for a
short-lived PostgREST JWT through `POST /api/token`. Both are constrained by
the same canonical scopes and the same fail-closed external allowlist:

- **Service credentials** — owner-minted in **Administration → API
  credentials**. The JWT carries `role: 'api_client'`. The workspace service
  identity is the actor; writes attribute to `*_credential_id` columns.
- **Personal API tokens** — member-minted in **Settings**. The JWT carries
  `role: 'authenticated'` with the creating member's real `sub`. Member
  permissions and row-level security further constrain every request (a
  viewer's token is read-only). Attribution is human. Removing or suspending
  the creating member makes the token unusable at exchange and at use time.

Neither kind creates a browser or human session. Personal-token JWTs carry
no `session_id` claim, so human attestation stays unavailable to external
credentials of either kind.

The **intended public contract** (resources, scopes, errors, pagination,
idempotency, deprecation) lives in `docs/public-api-contract.md`. The
**OpenAPI 3.1** description of operations an external credential can complete
is `docs/openapi/external-api-v0.json` (see `docs/openapi/README.md`).
This document covers **credential mechanics** and the **currently
implemented** external allowlist.

> **Important:** API-07 maps Core Dataset and Sheet Instance operations onto
> canonical scopes. Schema-authoring RPCs, file RPCs, specialist surfaces,
> and human attestation (submit / sign / amend / revision checks) stay
> fail-closed. The removed scientific-table REST surface is **not
> available**.

## Credential format

A credential string looks like `sb_<prefix>_<secret>`:

- `prefix` — 8 hex chars, stored and shown in the UI. You can identify a
  credential without revealing it.
- `secret` — 32 hex chars, shown **once** at creation, never stored. Only a
  salted SHA-256 hash (`hashSecret(prefix, secret)`) is persisted.

Store the full credential in your integration's secret store immediately.
If you lose it, revoke it and create a new one.

There is a workspace **Administration → API credentials** page. Owners use
it to create, list, rotate, and revoke service credentials. Each member
manages their own personal tokens under **Settings** with the same create,
list, rotate, and revoke surface. Personal-token lifecycle events land in
the workspace activity stream alongside service-credential events. For both
kinds, the full secret is shown once at create or rotate; only a salted hash
and display prefix are stored. Optional credential expiry is enforced at
exchange and rotation.

## Scopes

### Currently effective

| Scope                                | Allows                                                                |
| ------------------------------------ | --------------------------------------------------------------------- |
| `projects:read` / `projects:write`   | Project-domain tables and RPCs                                        |
| `datasets:read` / `datasets:write`   | Dataset query, commit, snapshot, archive. Not schema stewardship      |
| `sheets:read` / `sheets:write`       | Sheet Instance reads and mutations. Does not author Sheet Definitions |
| `models:read` / `models:write`       | `search_sheet_records`, custom-field writes, Sheet→Record write-back  |
| `templates:read` / `templates:write` | Template catalogue reads and instantiation                            |
| `reviews:read`                       | Preview a submission digest. Does not run revision checks             |
| `reviews:write`                      | Mintable. Does not submit, sign or amend                              |
| `schema:read`                        | Catalogue GET only                                                    |

### Still fail-closed

`schema:write`, `schema:publish`, and `files:*` remain mintable but do not
open authoring or file RPCs. `sheets:write` does not author Sheet
Definitions. Dataset **data** scopes stay distinct from `schema:*`.

`scientific:*` scopes are **removed**, not deprecated. A request for them at
`POST /api/token` returns `invalid_scope`.

A request for a scope the credential does not have returns
`insufficient_scope`.

## Currently allowed resources

Verified in `src/lib/external-token.ts`. Anything not listed is **denied**.
The full table is in `docs/public-api-contract.md` §2.1.

### Project-domain tables

`projects`, `folders`, `records`, `blocks`, `record_links`, `revisions`,
`record_field_definitions`.

- GET/HEAD → `projects:read`
- POST/PATCH → `projects:write` on `projects`, `records`, `blocks`,
  `record_links` only
- `folders` and `record_field_definitions` are GET-only (`api_client` has
  SELECT; writes stay on the session path)
- `revisions` are GET only
- DELETE on `projects` is not granted to `api_client` (Phase 1 rule)

### Core catalogue tables

`datasets` (`datasets:read` / `datasets:write` INSERT), `dataset_versions`,
`sheet_instances`, schema catalogues (`schema:read`), notebook templates
(`templates:read`). Instance and schema **writes** go through RPCs.

### RPCs

See contract §2.1 for the Dataset, Sheet Instance, search, and model
mappings. Project-domain RPCs still require `projects:write`.

Direct INSERT/UPDATE/DELETE on `revisions` is not granted. Submit, sign,
amend, and revision checks stay human-session-only. A credential with
`reviews:write` cannot call them.

### Denied examples (fail closed)

- `create_dataset_schema_definition`, `create_sheet_definition`,
  `extract_sheet_definition_draft`, `create_notebook_template`
- `create_scientific_table`, `sheet_*` generated tables, `formula_results`
- `change_events`, file RPCs, admin RPCs, specialist ops RPCs

See `src/lib/external-token.test.ts` for the locked mapping and deny-list.

## Exchange

`POST /api/token` with JSON `{ credential, scopes }` returns `{ token }` — a
short-lived JWT (5 min default). Both kinds carry `workspace_id`,
`credential_id`, and `scopes`. The role differs:

- Service credential → `role: 'api_client'`, no user id. RLS keys on the
  workspace claim. Attribution lands on `*_credential_id` columns.
- Personal token → `role: 'authenticated'` with the creating member's real
  `sub`. Member RLS applies (including GOV-01 viewer read-only), and writes
  attribute to the member.

Use either as a Bearer token against `/api/db/*`.

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
the prefix locks for 15 minutes.

## Revocation

Revoking a credential sets `revoked_at`. Subsequent exchanges fail
immediately with `revoked`. Revocation is permanent; to re-enable, create a
new credential.

Personal tokens have a second stop switch: they are usable only while the
creating member's workspace membership is active. Removing or suspending the
member stops the token at exchange **and** at use time. The credential row
itself is untouched.

Revocation is also enforced **at use time**, not only at exchange time. A
still-valid bearer token minted before revocation is rejected on the next
`/api/db/*` request with `permission_denied` (`revoked`). There is no window
in which a revoked credential can still read or write data.

## Enforcement layers

An external request passes through three checks before any data moves:

1. **Exchange** (`POST /api/token`) — verifies the credential secret,
   revocation, and requested scope. It rate-limits guesses and mints a
   short-lived JWT scoped to the credential's workspace (`api_client` for
   service credentials; `authenticated` + member `sub` for personal tokens,
   after re-checking that membership is active).
2. **Proxy** (`/api/db/*`) — verifies the bearer token's signature and shape
   (it rejects, for example, personal-token claims presented against a
   service-credential row). It re-checks revocation, expiry, and membership
   against the live rows. It classifies the exact resource and enforces the
   **fail-closed allowlist** identically for both kinds. Unknown external
   resources fail closed.
3. **Row-level security** (PostgreSQL policies) — pins every read and write
   to the `workspace_id` claim for service credentials. It applies full
   member RLS for personal tokens. A leaked or tampered token cannot cross
   workspaces or exceed its actor's permissions, even if the proxy is
   bypassed.

The browser session path skips step 2's allowlist (it uses membership-based
RLS instead) but is not available to external credentials.

## Project CLI example

With a local dev server running (`pnpm dev`):

```bash
scripts/read-project.sh sb_1a2b3c4d_...
```

The script exchanges the credential for a token and reads projects through
`/api/db/projects`. See `scripts/read-project.sh` for the exact calls.

### Manual exchange and read

```bash
TOKEN="$(curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -d '{"credential":"sb_…","scopes":["projects:read"]}' \
  http://localhost:3000/api/token | jq -r .token)"

curl --fail -G -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'select=key,title' \
  --data-urlencode 'order=created_at.desc' \
  http://localhost:3000/api/db/projects
```

### Create a project (requires `projects:write`)

```bash
TOKEN="$(curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -d '{"credential":"sb_…","scopes":["projects:write"]}' \
  http://localhost:3000/api/token | jq -r .token)"

curl --fail -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"p_title":"Integration test project"}' \
  http://localhost:3000/api/db/rpc/create_project
```

For local development, substitute the exposed application portal for
`http://localhost:3000`. External clients never call PostgREST directly.

## Error responses on `/api/db`

Data requests return the stable envelope documented in
`docs/public-api-contract.md` §6:

```json
{
  "error": {
    "category": "permission_denied",
    "message": "External credentials cannot access this resource.",
    "request_id": "…"
  }
}
```

## Tests

| Test file                            | Proves                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `src/lib/external-token.test.ts`     | Allowlist scope mapping; Core grants; still-private deny-list                     |
| `tests/db/api-credentials.test.ts`   | Creation, exchange, wrong secret/scope, revocation, personal tokens, audit events |
| `tests/db/external-api.test.ts`      | End-to-end RLS, use-time revocation/expiry/membership, attribution per kind       |
| `src/lib/public-api-openapi.test.ts` | OpenAPI stays aligned with the live allowlist and both credential kinds           |

Retired scientific-table tests (`tests/db/scientific-rest.test.ts`,
`tests/api/scientific-rest.test.ts`) document **removed** behaviour. They
are not part of the public contract.

## Next steps for integrators

1. Read `docs/public-api-contract.md` for the domain model and scopes.
2. Use canonical Core-domain scopes for Dataset/Sheet automation (API-07).
3. Do **not** depend on `scientific:*` scopes or scientific-table paths.
4. Do **not** use an API key to submit, sign, amend, or run revision checks.
5. Schema-authoring, files, and SDKs remain later API/DATA work.
