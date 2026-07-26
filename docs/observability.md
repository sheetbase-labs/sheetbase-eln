# Observability and troubleshooting

API-006 establishes the first layer of operational visibility: health probes,
request correlation, structured logging and stable public error categories.
This document is the reference for both — what the endpoints and log fields
mean, and where to look when local startup or authentication fails.

## Health endpoints

| Endpoint                | Purpose                                             | Dependencies probed                  | Status on failure                     |
| ----------------------- | --------------------------------------------------- | ------------------------------------ | ------------------------------------- |
| `GET /api/health/live`  | Liveness — the application process is running.      | none                                 | always 200 if the process can answer  |
| `GET /api/health/ready` | Readiness — the app and its dependencies can serve. | PostgreSQL, PostgREST admin `/ready` | 503 if either dependency is not ready |

`/ready` runs the database and PostgREST probes in parallel and reports each
dependency separately in the body:

```json
{
  "status": "ready",
  "artifact": { "version": "2026.07.26", "digest": "sha256:<digest>" },
  "database": {
    "ok": true,
    "latencyMs": 3,
    "migration": {
      "status": "compatible",
      "expected": "<journal-version>",
      "applied": "<journal-version>"
    }
  },
  "postgrest": { "ok": true, "latencyMs": 8 }
}
```

Staging and production set an expected migration version in the immutable
artifact contract. Readiness returns 503 when the latest applied Drizzle
migration differs, preventing traffic from reaching an incompatible database.
Development reports `not_checked` while using the explicit `untracked` default.

The `error` field is intentionally absent from the public body — connection
strings and hostnames can leak through raw driver errors, so the detail is
written to logs only. An operator reads the detail there, not from the probe
response.

Both endpoints honour the `x-request-id` header: if present and well-formed
(`[a-z0-9-]{1,128}`, case-insensitive) it is echoed back; otherwise a fresh
32-hex id is generated and stamped on the response.

## Request correlation

Every request through the same-origin data proxy (`/api/db/*`) carries a
correlation id:

1. Resolved from the incoming `x-request-id` header (or generated).
2. Forwarded to PostgREST as `x-request-id`, so upstream logs share the
   correlation.
3. Stamped on the response as `x-request-id`, so a user can quote it in a
   bug report.
4. Included in every structured log line for the request and in the
   `error.request_id` field of the public error envelope.

## Structured logging

The logger (`src/lib/logger.ts`) emits one JSON object per line. Info and
debug go to stdout; warn and error go to stderr, so operators can split
streams. Severity conventions:

| Level   | Use                                                                             |
| ------- | ------------------------------------------------------------------------------- |
| `debug` | Local dev only; never on in production.                                         |
| `info`  | Request lifecycle, successful operations.                                       |
| `warn`  | Recoverable problems — bad client input, rate limit hit, expected 4xx upstream. |
| `error` | Failures a developer must investigate — upstream 5xx, connection failure.       |

`LOG_LEVEL` selects the minimum severity emitted (default `info`).

### Redaction

Sensitive keys are recursively redacted before any field is logged:
`password`, `token`, `authorization`, `cookie`, `set-cookie`, `secret`,
`accessToken`, `refreshToken`, `idToken`, `pgrst_jwt_secret`,
`better_auth_secret`, `github_client_secret`, `postgres_password`. The check
is case-insensitive and recurses into nested objects and arrays. Formula
contents and scientific payloads are never logged by the proxy: it logs only
the validated resource name (e.g. `projects` or `rpc/create_project`), the
HTTP method, the status, the duration and the request id — never the query
string, body, headers or row filters.

When in doubt, log less, not more.

## Stable public error categories

Proxy failures and upstream PostgREST errors are returned as:

```json
{ "error": { "category": "conflict", "message": "...", "request_id": "..." } }
```

Clients should branch on `category`, never on string messages or
PostgREST-internal codes. The category set:

| Category              | HTTP | Meaning                                            |
| --------------------- | ---- | -------------------------------------------------- |
| `validation_error`    | 400  | Bad input, constraint check, malformed path.       |
| `unauthenticated`     | 401  | No valid session or credential.                    |
| `permission_denied`   | 403  | RLS, scope, or no active workspace.                |
| `not_found`           | 404  | Resource does not exist.                           |
| `conflict`            | 409  | Unique violation, serialization failure, deadlock. |
| `rate_limited`        | 429  | Too many attempts.                                 |
| `service_unavailable` | 500+ | Upstream down or schema not loaded.                |
| `server_error`        | 500  | Unclassified — a developer must investigate.       |

PostgREST error `details` and `hint` fields are dropped before the public
envelope is built because they can leak schema internals; the `message` is
preserved when present because it is intended for clients.

## Troubleshooting common local failures

### `pnpm dev` starts but `/api/health/ready` returns 503

- Check the response body: it names which dependency is `not_ready`.
- **Database `not_ready`:** is PostgreSQL running? `pg_isready -h localhost -p
5432 -U sheetbase`. Does `DATABASE_URL` in `.env.local` point at the right
  database and role? Has the migration set been applied (`pnpm db:migrate`)?
- **PostgREST `not_ready`:** is the PostgREST container running
  (`docker compose ps postgrest`)? Is `POSTGREST_ADMIN_URL` correct
  (default `http://localhost:3002`)? PostgREST will not become ready until
  PostgreSQL is ready and the `api` schema is loaded, so fix the database
  first.

### `/api/db/projects` returns `unauthenticated`

- The same-origin proxy requires a Better Auth browser session. Sign in at
  `/` first. If sign-in loops, see `docs/authentication.md`.
- The external bearer-token path (API-005) is separate; do not send an
  `Authorization: Bearer ...` token to `/api/db` expecting the browser
  session to be bypassed.

### `/api/db/projects` returns `permission_denied` with `no_workspace`

- The signed-in user has no workspace membership. The first sign-up should
  bootstrap one (AUTH-002); if it did not, check the auth callback logs and
  the `workspace_memberships` table.

### A 4xx user error appears in logs as `error` level

- It should not. Expected 4xx (validation, permission, conflict, not found,
  rate limited) are logged at `warn`; only 5xx is `error`. If you see a 4xx
  at `error` level, the proxy's `categorisePostgrestError` mapping is
  probably missing a SQLSTATE — add it in `src/lib/errors.ts` and add a
  test.

### Logs contain a value that looks like a secret

- It should not. Add the key to `REDACTED_KEYS` in `src/lib/logger.ts` and
  add a redaction test. Never log raw request bodies, query strings, cookies
  or authorization headers — the proxy deliberately logs only safe
  resource labels.
