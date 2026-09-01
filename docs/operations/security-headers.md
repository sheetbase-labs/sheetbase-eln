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
script-src 'self' 'nonce-<per-request>'
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
font-src 'self' data:
connect-src 'self'
worker-src 'self' blob:
```

`frame-ancestors 'self'` (and `X-Frame-Options: SAMEORIGIN`) rather than
`none`/`DENY` so same-origin Storybook preview iframes still work when
Storybook is served from this origin.

### Nonce CSP (PLAT-03)

HTML documents receive a **per-request nonce** (`src/start.ts` middleware +
`injectNonceIntoHtml` in `src/lib/security-headers.ts`): the nonce is
generated per response, stamped into the `Content-Security-Policy`
(`script-src 'self' 'nonce-<n>'`) and injected onto every inline
`<script>`/`<style>` tag in the server-rendered HTML. Inline scripts are
therefore allowlisted by nonce and **`script-src` no longer uses
`'unsafe-inline'`** in production.

The inline scripts that exist today (verified against a production render):

1. the theme/density no-flash bootstrap (`src/routes/__root.tsx`);
2. TanStack Router's history-state restore script;
3. TanStack Start's `$tsr` stream-barrier script;
4. the hydration-completion script.

Hashes were considered and rejected: scripts 2–4 embed response-dependent
values (stream ids, route ids), so hashes would break every render. Nonces
work because the nonce is generated in the same middleware that sets the
header and rewrites the tags.

Implementation trade-off: HTML responses are buffered in the middleware
before the nonce is injected. Pages are tens of kilobytes; the cost is a
small TTFB increase versus streaming, in exchange for the nonce guarantee.
Revisit buffering if streaming latency ever matters on large documents.

`style-src` deliberately keeps `'unsafe-inline'`: React inline `style`
attributes are non-executable data and cannot be nonced; they are not an
injection surface in this application. Development/test keeps `'unsafe-eval'`

- `ws:`/`wss:` for Vite HMR (never enabled in production).

## Remaining PLAT-03 (status after this slice)

Completed in PLAT-03: general API rate limiting (`docs/operations/security.md`),
SAST + dependency-audit pipeline (pre-merge PR audit +
`security.yml` CodeQL on main/weekly + release-gate audit in `deploy.yml`),
nonce CSP (this document), backup permissions/posture (`docs/operations/recovery.md`),
SECURITY DEFINER / RLS / grants audit (`docs/operations/security.md`,
`tests/db/plat-03-security-audit.test.ts`), H1 capability-mask completion
for `api_client`, auth/session review (`docs/operations/security.md`).

Still queued: penetration testing (needs real usage). See
`docs/operations/security.md` §5.
