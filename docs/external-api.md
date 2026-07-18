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

The initial vocabulary (API-005):

| Scope            | Allows                                                |
| ---------------- | ----------------------------------------------------- |
| `projects:read`  | Read projects in the credential's workspace.          |
| `projects:write` | Create/update projects in the credential's workspace. |

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
   enforces `projects:read` / `projects:write` against the HTTP method
   and resource (GET/HEAD → `projects:read`; POST/PATCH/DELETE on tables
   and any RPC → `projects:write`).
3. **Row-level security** (PostgreSQL `api_client` policies) — pins every
   read and write to the `workspace_id` claim on the token, so a leaked or
   tampered token cannot cross workspaces even if the proxy were bypassed.

`api_client` has no DELETE privilege on projects in Phase 1: external
credentials cannot destroy projects, regardless of scope.

## CLI example

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
