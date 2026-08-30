# Authentication

Users sign in with GitHub through Better Auth. Identity tables live in
`internal` (see decision record 0003). Sessions are database-backed with
signed, HTTP-only cookies.

## GitHub OAuth application setup (manual, once per environment)

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**.
2. Fill in:
   - **Application name:** `Sheetbase (local development)` — use one OAuth
     app per environment. Do not share one app across
     dev/staging/production.
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github`
3. Create the app. Copy the **Client ID** into `GITHUB_CLIENT_ID` in
   `.env.local`. Generate a **Client secret** into `GITHUB_CLIENT_SECRET`.
4. Restart the dev server. The sign-in page shows the GitHub button when both
   values are present.

Until both values are set, auth routes still mount. The sign-in page reports
that GitHub sign-in is not configured. Sign-up stays open while the product
is single-user: the first GitHub account to sign in becomes the initial user
(bootstrap: AUTH-002). No email or GitHub id is hard-coded anywhere.

## Auth-free development surface

The separate `dev.sheetbase.co.uk` environment does not use this OAuth flow.
Its Compose file sets `SHEETBASE_ENV=development` and
`SHEETBASE_DEV_AUTH_FREE=true`. The server then resolves the seeded fixture
owner without a cookie. Deployment validation rejects this flag outside
development. See [Development environment](dev-environment.md) for the
disposable database, storage and manual tunnel setup.

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

The browser never talks to PostgREST directly. Authenticated CRUD goes to the
same-origin `/api/db/*` boundary (`src/routes/api/db/$.ts`). The boundary:

1. verifies the Better Auth session from the cookie,
2. resolves the caller's active workspace,
3. mints a short-lived PostgREST JWT signed with `PGRST_JWT_SECRET`, and
4. forwards the request upstream with validated path and query only.

The same boundary also accepts external bearer tokens (`api_client` JWTs).
Browser sessions and external tokens share one proxy and one error envelope.

The session cookie never leaves the application boundary. The minted JWT
carries the minimal claim set only — `sub`, `workspace_id`, `session_id`,
`role` (`authenticated`), `iat`/`exp` — and expires within ~120s. See
decision record 0005 and `src/lib/postgrest-token.ts`.

The proxy rejects missing sessions (401), users with no workspace (403),
workspace-mismatched requests (403), disallowed paths (400) and upstream
failures (502). All rejections use one non-sensitive
`{ error: { category, message } }` envelope. `src/lib/postgrest-path.ts`
validates that only `table` or `rpc/<name>` resources and bounded PostgREST
query parameters survive. Clients cannot aim the proxy at another origin,
schema or path.

PostgREST verifies the JWT and exposes its claims to SQL as
`request.jwt.claims`. RLS policies (AUTH-004) read those claims. The
diagnostic function `api.claim_probe()` returns the claims for contract
tests. It is defensive: missing, empty or malformed claims yield `NULL`,
never an error.

## Cookie policy

Session cookies are HTTP-only with `SameSite=None` and `Secure` enabled in
every environment. The GitHub OAuth callback is a cross-site top-level
navigation, so the state cookie needs these attributes to survive the
redirect (`src/lib/auth.ts`). The cookie value is the session
token signed with `BETTER_AUTH_SECRET`. The token itself is the credential
looked up in `internal.session`.

## Error recovery

Provider and callback failures redirect to `/sign-in?error=…`. The page maps
the code to an actionable message (`src/lib/auth-errors.ts`): declined
consent (nothing was created; try again), missing GitHub email (make a
verified email visible), expired state (start again), provider errors
(generic retry). Raw provider payloads are never shown.

## Tests

`tests/db/auth-session.test.ts` proves session creation, expiry and
unauthenticated access against a real database without live GitHub calls.
Sessions are written directly to the identity tables; the OAuth callback
writes them the same way after consent. Cookies are signed with the same
HMAC format Better Auth uses.

`tests/db/postgrest-claims.test.ts` proves the AUTH-003 claim contract:
`mintPostgrestToken` mints a token; the server secret verifies it; once it is
placed into `request.jwt.claims` the way PostgREST places it, every claim is
readable through `api.claim_probe()`. It also proves missing or malformed
claims yield `NULL` (no workspace context), that claims are isolated per
session, and that the `anon` role cannot execute the probe.
