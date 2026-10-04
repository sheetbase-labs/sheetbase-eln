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

## Signing credential routes

The following Better Auth HTTP paths return 404: `verify-password`,
`change-password`, `request-password-reset`, `reset-password`, `sign-in/email`,
and `sign-up/email`. These paths are disabled in `src/lib/auth.ts`. Better Auth's
`setPassword` API is server-only and has no HTTP route.
The application HTTP catchall also blocks the `reset-password/` token subtree.
Better Auth's `disabledPaths` matches exact pathnames, not wildcard or parameter
patterns. Trusted server calls to `auth.api.resetPassword` remain available.

Disabling email sign-in alone does not close password verification, password
changes, or redemption of an existing reset token. Those HTTP operations must
not bypass the signing lockout or first-password enrolment authorisation.
Better Auth's trusted server APIs remain available for the governed flow.
GitHub sign-in and session lookup remain unchanged.

### Identity, enrolment and recovery

In **Settings → Electronic signatures**, the target requests verification with
`request_signature_identity_verification()`. A different active owner/admin
independently checks identity and email, then calls
`verify_signature_identity(p_user_id, p_email)`. The email must exactly match
the target's current account email. An initial workspace owner receives no
self-verification exemption: invite another administrator first.

Verification authorises that target's requested live session for 15 minutes.
The target requests an enrolment or recovery secret from
`POST /api/signatures/step-up`. The secret is delivered immediately to the
independently verified email, expires in five minutes, and is bound to the
user, session, workspace, purpose and independent authorisation. Only its
SHA-256 hash is stored. Reissue invalidates older secrets, including when
delivery fails. No secret belongs in the notification outbox, browser/admin
responses or logs.

First enrolment uses Better Auth's server-only `setPassword` and refuses an
existing credential. Recovery repeats independent verification and spends the
authorisation before calling Better Auth's trusted `requestPasswordReset` and
`resetPassword` APIs. The configured reset callback redeems the library-owned
token only inside that server-only recovery scope; it does not send a public
reset link. Recovery revokes outstanding signing grants, certifications and
old sessions. Sign in again and recertify afterwards.

A credential-operation failure does not restore the spent authorisation.
Request fresh independent verification before retrying. Better Auth may fail
after changing credentials (for example, during session revocation); a failed
response is not proof that the old password remains valid.

### Password evidence and certification

The step-up endpoint accepts same-origin POST requests with a real Better Auth
session. It never uses the auth-free demo identity. Passwords are verified by
Better Auth, not by application-owned hashes or a second credential engine.
Three consecutive failures create a durable, user-wide 15-minute lockout and
an audit entry, invalidate outstanding grants, and commit even on denial.
Successful verification resets the consecutive-failure count.

`purpose: "certify"` returns a five-minute single-use token. The database
`certify_signature(p_workspace_id, 1, p_signing_token)` requires independent
identity verification, the current verified email and that password evidence.
The user agrees to the displayed statement before certification. Historical
self-certifications do not meet the new gate; their stored evidence is not
rewritten.

`purpose: "sign"` additionally requires `submissionId` and `revisionDigest`.
`sign_revision` requires its fifth `p_signing_token` argument, exact
submission/digest binding, current certification and the existing reviewer,
writer, approval, checks, name-confirmation and revision guards. Consumption
and immutable signature insertion are atomic; the new evidence records
`auth_method: "password"`. Historical signature rows remain unchanged.
`purpose: "practice"` is consumed by `practice_signature(p_signing_token)` and
records an authentication event, not a real record signature.

The endpoint returns `{token, expiresAt, authMethod: "password"}` only for
password evidence. Secret requests return `{delivered: true, expiresAt}`;
credential completion returns `{completed: true, signInAgain}`. Enrolment and
recovery never return the email secret or Better Auth reset token.

The SMTP transport in `src/lib/email-delivery.server.ts` uses implicit TLS on
port 465 and requires STARTTLS on other ports. It requires TLS 1.2 or later,
validates certificates, and refuses plaintext fallback. The local handshake
tests prove these controls, not production SMTP delivery or provider step-up.
Missing SMTP configuration, a missing transport, or failed delivery must deny
enrolment. GitHub OAuth is sign-in only, not fresh provider assurance. No IdP
step-up is configured; unsupported provider requests fail closed. Live SMTP and
IdP acceptance remain separate from the local password/transport proof.

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

Session cookies are HTTP-only, `SameSite=None` and `Secure`, matching the current
Better Auth configuration for the cross-site OAuth callback. Signing POSTs
additionally require the request's Origin to match its URL origin. The cookie value is the session
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

The same suite checks the restricted HTTP password routes and verifies local
passwords through Better Auth's server API without creating another session.
Its `setPassword` call provisions a test fixture, not a product enrolment flow.
It does not prove GitHub provider step-up or live SMTP delivery.

`tests/db/postgrest-claims.test.ts` proves the AUTH-003 claim contract: a
token minted by `mintPostgrestToken` is verified with the server secret and,
once placed into `request.jwt.claims` the way PostgREST places it, every
claim is readable through `api.claim_probe()`. It also proves missing or
malformed claims yield `NULL` (no workspace context), that claims are
isolated per session, and that the `anon` role cannot execute the probe.
