# 0005. PostgREST claim set and same-origin proxy

- **Status:** accepted
- **Date:** 2026-07-18
- **Ticket:** AUTH-003

## Context

Browser CRUD needs to reach PostgREST, but PostgREST speaks JWT, not Better
Auth cookies. Two durable questions had to be settled together: which claims
PostgREST receives, and how the browser reaches PostgREST without the
application session ever crossing origins.

## Decision

- Browser CRUD goes through a same-origin `/api/db/*` boundary
  (`src/routes/api/db/$.ts`), never directly to PostgREST. The server
  verifies the Better Auth session, mints a short-lived PostgREST JWT and
  forwards the request upstream. The session cookie never leaves the
  application boundary.
- The JWT carries the minimal claim set only: `sub` (Better Auth user id),
  `workspace_id` (active workspace), `session_id` (revocation handle),
  `role` (`authenticated`), `iat`/`exp`. No payloads, no scopes, no secrets.
  Tokens are minted per proxied request and expire within ~120s.
- The signing secret (`PGRST_JWT_SECRET`) and token creation stay
  server-side. The browser only ever sees its own same-origin responses.
- The proxy rejects missing sessions (401), users with no workspace (403),
  workspace-mismatched requests (403), disallowed paths (400) and upstream
  failures (502), all through one non-sensitive error envelope
  (`{ error: { code, message } }`) that never echoes secrets, cookies or
  upstream connection detail.
- Path and query are validated server-side: only `table` or `rpc/<name>`
  resources and bounded PostgREST query parameters survive; anything else
  fails closed. Clients cannot aim the proxy at another origin, schema or
  path.
- `api.claim_probe()` is the diagnostic contract for the claim to session
  setting path. It is defensive: missing, empty or malformed
  `request.jwt.claims` yield `NULL`, never an error. AUTH-004's RLS policies
  read the same setting with the same defensiveness.

## Consequences

- PostgREST stays the only CRUD engine; the application adds auth, not
  query logic. RLS (AUTH-004) remains the authoritative access boundary.
- `session_id` in the claim gives a revocation handle: invalidating the
  Better Auth session invalidates future proxied requests even within the
  token's short life.
- Adding a new PostgREST resource needs no proxy change unless it requires a
  new path shape; tables and RPCs under the existing shapes work
  automatically.
- External API clients (API-005) will mint the same claim shape through a
  different exchange (credential to token), so the claim set is shared
  surface and must change deliberately.
- The probe is `authenticated`-only; `anon` is denied. RLS helpers in
  AUTH-004 must replicate the missing-claims-to-NULL defensiveness rather
  than trusting the setting to be present and valid.
