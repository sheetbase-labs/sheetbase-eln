# External API credentials

Scoped credentials let external integrations read and write Sheetbase data
without a browser session. They exchange a shared secret for a short-lived
PostgREST JWT through `POST /api/token`, then use that JWT against the
same-origin `/api/db` boundary. The browser session is never involved.

The **intended public contract** (resources, scopes, errors, pagination,
idempotency, deprecation) lives in `docs/public-api-contract.md`. This
document covers **credential mechanics** and the **currently implemented**
external allowlist.

> **Important:** Core Dataset, Sheet, and Notebook Template RPCs are **not**
> yet on the external allowlist. Requests for those paths fail closed with
> `permission_denied` even if the credential carries broad scopes. The
> removed scientific-table REST surface documented in older revisions of this
> file is likewise **not available**.

## Credential format

A credential string looks like `sb_<prefix>_<secret>`:

- `prefix` — 8 hex chars, stored and shown in the UI so you can identify a
  credential without revealing it.
- `secret` — 32 hex chars, shown **once** at creation, never stored. Only a
  salted SHA-256 hash (`hashSecret(prefix, secret)`) is persisted.

Store the full credential in your integration's secret store immediately. If
you lose it, revoke and create a new one.

There is a workspace **Administration → API credentials** page for owners
to create, list, rotate and revoke credentials. The full secret is shown
once at create or rotate; only a salted hash and display prefix are stored.
Members can view prefixes and last-used metadata but cannot mint secrets.
Optional credential expiry is enforced at exchange and rotation.

## Scopes

### Currently effective

| Scope            | Allows                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| `projects:read`  | Read project-domain tables in the credential's workspace (see below).  |
| `projects:write` | Create/update project-domain tables and allowed RPCs in the workspace. |

### Mintable Core-domain scopes (fail-closed until allowlist cut-over)

The admin UI and `createCredential` issue the API-01 vocabulary
(`datasets:*`, `schema:*`, `sheets:*`, `models:*`, `templates:*`, `reviews:*`,
`files:*`). Those scopes are stored and may be requested at `POST /api/token`,
but Core Dataset/Sheet/Notebook RPCs still return `permission_denied` until a
later epic expands `src/lib/external-token.ts`. `sheets:write` does not author
Sheet Definitions. Dataset **data** scopes stay distinct from `schema:*`.

`scientific:*` scopes are **removed**, not deprecated. Requesting them at
`POST /api/token` returns `invalid_scope`.

Requesting a scope the credential does not have returns `insufficient_scope`.

## Currently allowed resources

Verified in `src/lib/external-token.ts`. Anything not listed is **denied**.

### Tables

`projects`, `folders`, `records`, `blocks`, `record_links`, `revisions`,
`record_field_definitions`.

- GET/HEAD → `projects:read`
- POST/PATCH → `projects:write`
- DELETE on `projects` is not granted to `api_client` (Phase 1 rule)

Direct INSERT/UPDATE/DELETE on `revisions` is not granted; use
`submit_record_revision` when that RPC is added to the allowlist.

### RPCs

All require `projects:write`:

`create_project`, `create_record`, `create_record_with_blocks`,
`update_block_payload`, `move_block`, `archive_record`, `restore_record`,
`create_record_link`, `insert_block`, `delete_block`,
`transition_record_status`, `instantiate_template`.

### Denied examples (fail closed)

Core and retired paths return `permission_denied` / `insufficient_scope`:

- `query_dataset_rows`, `commit_dataset_row_batch`, `create_sheet_instance`
- `submit_record_revision`, `search`, `search_sheet_records`
- `create_scientific_table`, `sheet_*` generated tables, `formula_results`
- `change_events`, file RPCs

See `src/lib/external-token.test.ts` for the locked deny-list tests.

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
   shape, re-checks revocation against the live credential row, classifies
   the exact resource and enforces the **project-domain allowlist**. Unknown
   external resources fail closed.
3. **Row-level security** (PostgreSQL `api_client` policies) — pins every
   read and write to the `workspace_id` claim on the token, so a leaked or
   tampered token cannot cross workspaces even if the proxy were bypassed.

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

| Test file                          | Proves                                                                |
| ---------------------------------- | --------------------------------------------------------------------- |
| `src/lib/external-token.test.ts`   | Allowlist scope mapping; fail-closed for Core/retired paths           |
| `tests/db/api-credentials.test.ts` | Creation, exchange, wrong secret/scope, revocation, rate-limit        |
| `tests/db/external-api.test.ts`    | End-to-end RLS, scope enforcement, revocation-at-use, tampered claims |

Retired scientific-table tests (`tests/db/scientific-rest.test.ts`,
`tests/api/scientific-rest.test.ts`) document **removed** behaviour and are
not part of the public contract.

## Next steps for integrators

1. Read `docs/public-api-contract.md` for the full domain model and queued scope vocabulary.
2. Use `projects:read` / `projects:write` for the **current** project-domain API only.
3. Do **not** depend on `scientific:*` scopes or scientific-table paths.
4. Watch for **API-07** (Core external allowlist cut-over) before building Sheet/Dataset/Notebook automation. Credentials UI and service identity are available now (API-02); Core RPCs remain fail-closed.
