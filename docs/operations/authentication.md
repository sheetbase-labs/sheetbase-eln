# Authentication

GitHub sign-in via Better Auth. Identity tables live in `internal` (see
decision record 0003); sessions are database-backed with signed, HTTP-only
cookies.

## GitHub OAuth application setup (manual, once per environment)

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**.
2. Fill in:
   - **Application name:** `Sheetbase (local development)` — one OAuth app
     per environment; never share one across dev/staging/production.
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github`
3. Create the app, copy the **Client ID** into `GITHUB_CLIENT_ID` in
   `.env.local`, and generate a **Client secret** into
   `GITHUB_CLIENT_SECRET`.
4. Restart the dev server. The sign-in page shows the GitHub button once
   both values are present.

Until both values are set, auth routes still mount but the sign-in page
reports that GitHub sign-in is not configured. Sign-up is open while the
product is single-user: the first GitHub account to sign in becomes the
initial user (bootstrap: AUTH-002). No email or GitHub id is hard-coded
anywhere.

## Auth-free development surface

The separate `dev.sheetbase.co.uk` environment does not use this OAuth flow.
Its Compose file sets `SHEETBASE_ENV=development` and
`SHEETBASE_DEV_AUTH_FREE=true`, so the server resolves the seeded fixture owner
without a cookie. This flag is explicitly rejected by deployment validation
outside development. See [Development environment](../development/dev-environment.md) for
the disposable database, storage and manual tunnel setup.

## Environment variables

| Variable                                    | Notes                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                        | Signs session cookies. 32+ characters, dev default in `.env.example`; rotate per environment. |
| `BETTER_AUTH_URL`                           | Base URL Better Auth builds callbacks from. `http://localhost:3000` locally.                  |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | From the OAuth app above. Server-only.                                                        |
| `POSTGREST_URL`                             | Server-only upstream for the same-origin data proxy. Never exposed to the browser.            |
| `PGRST_JWT_SECRET`                          | Signs short-lived PostgREST JWTs minted by the proxy. 32+ characters, server-only.            |

## Routes

- `/sign-in` — sign-in page and error recovery surface.
- `/api/auth/*` — Better Auth handler: `sign-in/social`, `callback/github`,
  `get-session`, `sign-out`.
- `/api/db/*` — same-origin PostgREST proxy (see [Data API boundary](#data-api-boundary)).

## Data API boundary

The browser never talks to PostgREST directly. Authenticated CRUD goes to
the same-origin `/api/db/*` boundary (`src/routes/api/db/$.ts`), which:

1. verifies the Better Auth session from the cookie,
2. resolves the caller's active workspace,
3. mints a short-lived PostgREST JWT signed with `PGRST_JWT_SECRET`, and
4. forwards the request upstream with validated path and query only.

The session cookie never leaves the application boundary. The minted JWT
carries the minimal claim set only — `sub`, `workspace_id`, `session_id`,
`role` (`authenticated`), `iat`/`exp` — and expires within ~120s. See
decision record 0005 and `src/lib/postgrest-token.ts`.

The proxy rejects missing sessions (401), users with no workspace (403),
workspace-mismatched requests (403), disallowed paths (400) and upstream
failures (502) through one non-sensitive `{ error: { code, message } }`
envelope. `src/lib/postgrest-path.ts` validates that only `table` or
`rpc/<name>` resources and bounded PostgREST query parameters survive, so
clients cannot aim the proxy at another origin, schema or path.

PostgREST verifies the JWT and exposes its claims to SQL as
`request.jwt.claims`, which RLS policies (AUTH-004) read. The diagnostic
function `api.claim_probe()` returns those claims for contract tests; it is
defensive — missing, empty or malformed claims yield `NULL`, never an error.

## Cookie policy

Session cookies are HTTP-only and `SameSite=Lax` (Lax permits the OAuth
callback round-trip while blocking cross-site POSTs). `Secure` is enabled
only in production, where HTTPS exists. The cookie value is the session
token signed with `BETTER_AUTH_SECRET`; the token itself is the credential
looked up in `internal.session`.

## Error recovery

Provider and callback failures redirect to `/sign-in?error=…`, which maps
the code to an actionable message (`src/lib/auth-errors.ts`): declined
consent (nothing was created, try again), missing GitHub email (make a
verified email visible), expired state (start again), provider errors
(generic retry). Raw provider payloads are never shown.

## Tests

`tests/db/auth-session.test.ts` proves session creation, expiry and
unauthenticated access against a real database without live GitHub calls:
sessions are written directly to the identity tables, exactly what the OAuth
callback does after consent, and cookies are signed with the same HMAC
format Better Auth uses.

`tests/db/postgrest-claims.test.ts` proves the AUTH-003 claim contract: a
token minted by `mintPostgrestToken` is verified with the server secret and,
once placed into `request.jwt.claims` the way PostgREST places it, every
claim is readable through `api.claim_probe()`. It also proves missing or
malformed claims yield `NULL` (no workspace context), that claims are
isolated per session, and that the `anon` role cannot execute the probe.
