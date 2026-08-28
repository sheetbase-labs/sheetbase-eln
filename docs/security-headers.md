# Security headers

PLAT-03 Low slice. Application responses now set a deliberate Content-Security-Policy
and related browser security headers. This is not the rest of PLAT-03.

## What is set

Every TanStack Start response (HTML, `/api/health/*`, `/api/db/*`, auth, SSE)
goes through `src/start.ts` request middleware, which stamps:

| Header                    | Value                                              | Why                                            |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `Content-Security-Policy` | see below                                          | Limit script, connect, frame and embed sources |
| `X-Content-Type-Options`  | `nosniff`                                          | Stop MIME sniffing                             |
| `Referrer-Policy`         | `strict-origin-when-cross-origin`                  | Do not leak full URLs to other origins         |
| `X-Frame-Options`         | `SAMEORIGIN`                                       | Clickjacking control for older browsers        |
| `Permissions-Policy`      | camera/microphone/geolocation/payment/usb disabled | No ambient device access                       |

Health handlers also stamp the same headers so probes are covered even when
tested as functions. Production static-file servers
(`scripts/serve-production.mjs`, `scripts/start-prod.mjs`) apply the
production set to `/assets` and Storybook files.

### CSP (production)

```
default-src 'self'
base-uri 'self'
form-action 'self'
frame-ancestors 'self'
frame-src 'self'
object-src 'none'
script-src 'self' 'unsafe-inline'
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
font-src 'self' data:
connect-src 'self'
worker-src 'self' blob:
```

`frame-ancestors 'self'` (and `X-Frame-Options: SAMEORIGIN`) rather than
`none`/`DENY` so same-origin Storybook preview iframes still work when
Storybook is served from this origin.

### CSP (development / test)

Adds `'unsafe-eval'` on `script-src` and `ws:` / `wss:` on `connect-src` for
Vite HMR. Do not enable that pair in production.

## Why `'unsafe-inline'` is still required

Inspected loading before locking the policy:

- `src/routes/__root.tsx` injects an inline theme/density bootstrap in
  `<head>` so the first paint matches the saved theme.
- TanStack Start / Router may emit inline `ScriptOnce` tags during SSR.
- Handsontable is a dynamically imported **same-origin** client chunk
  (`src/components/sheet/sheetbase-grid.tsx`); it does not load from a CDN.
- Fonts come from `@fontsource-variable/*` bundled into app CSS.
- GitHub OAuth POSTs to `/api/auth/sign-in/social` then does a top-level
  navigation to GitHub. `connect-src` and `form-action` stay `'self'`.
- Live events use same-origin `EventSource` at `/api/events`.
- Report/CSV downloads use `blob:` URLs (`img-src` / `worker-src`).

Tightening `script-src` to hashes or nonces is a follow-up once those inline
scripts have a nonce pipeline.

## Remaining PLAT-03 (status after this slice)

Completed elsewhere in PLAT-03: general API rate limiting
(`docs/security.md`), SAST + dependency-audit pipeline (`security.yml` +
release gate), backup permissions/posture (`docs/recovery.md`),
SECURITY DEFINER / RLS / grants audit (`docs/security.md`,
`tests/db/plat-03-security-audit.test.ts`), H1 capability-mask completion
for `api_client`, auth/session review (`docs/security.md`).

Still queued: nonce/hash CSP, penetration testing (needs real usage). See
`docs/security.md` §5.
