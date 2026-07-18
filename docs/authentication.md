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

## Environment variables

| Variable                                    | Notes                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                        | Signs session cookies. 32+ characters, dev default in `.env.example`; rotate per environment. |
| `BETTER_AUTH_URL`                           | Base URL Better Auth builds callbacks from. `http://localhost:3000` locally.                  |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | From the OAuth app above. Server-only.                                                        |

## Routes

- `/sign-in` — sign-in page and error recovery surface.
- `/api/auth/*` — Better Auth handler: `sign-in/social`, `callback/github`,
  `get-session`, `sign-out`.

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
