# Security headers

PLAT-03 Low slice. Application responses now set a deliberate
Content-Security-Policy and related browser security headers. This document
does not cover the rest of PLAT-03.

## What the app sets

Every TanStack Start response (HTML, `/api/health/*`, `/api/db/*`, auth, SSE)
goes through the request middleware in `src/start.ts`. The middleware stamps:

| Header                    | Value                                              | Why                                            |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `Content-Security-Policy` | see below                                          | Limit script, connect, frame and embed sources |
| `X-Content-Type-Options`  | `nosniff`                                          | Stop MIME sniffing                             |
| `Referrer-Policy`         | `strict-origin-when-cross-origin`                  | Do not leak full URLs to other origins         |
| `X-Frame-Options`         | `SAMEORIGIN`                                       | Clickjacking control for older browsers        |
| `Permissions-Policy`      | camera/microphone/geolocation/payment/usb disabled | No ambient device access                       |

Health handlers also stamp the same headers. Probes are then covered when
tested as functions. The production static-file servers
(`scripts/serve-production.mjs` and `scripts/start-prod.mjs`) apply the
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
img-src 'self' data: blob: https://avatars.githubusercontent.com
font-src 'self' data:
connect-src 'self' wss://*.liveblocks.io https://*.liveblocks.io
worker-src 'self' blob:
```

`img-src` allows GitHub avatar hosts for collaboration profiles.
`connect-src` allows Liveblocks websockets and API calls for the
collaboration feature. The static-file CSP in
`scripts/lib/security-headers.mjs` must match this policy. A unit test
asserts the match.

The policy uses `frame-ancestors 'self'` (and `X-Frame-Options: SAMEORIGIN`),
not `none`/`DENY`. Same-origin Storybook preview iframes then still work when
Storybook is served from this origin.

### Nonce CSP (PLAT-03)

HTML documents receive a **per-request nonce**. The middleware in
`src/start.ts` and `injectNonceIntoHtml` in `src/lib/security-headers.ts`
generate the nonce per response, stamp it into the `Content-Security-Policy`
(`script-src 'self' 'nonce-<n>'`), and inject it onto every inline
`<script>`/`<style>` tag in the server-rendered HTML. Inline scripts are then
allowlisted by nonce. **`script-src` no longer uses `'unsafe-inline'`** in
production.

These inline scripts exist today (verified against a production render):

1. the theme/density no-flash bootstrap (`src/routes/__root.tsx`);
2. TanStack Router's history-state restore script;
3. TanStack Start's `$tsr` stream-barrier script;
4. the hydration-completion script.

Hashes were considered and rejected. Scripts 2–4 embed response-dependent
values (stream ids, route ids). Hashes would break every render. Nonces work
because the same middleware generates the nonce, sets the header, and
rewrites the tags.

Trade-off: the middleware buffers HTML responses before it injects the
nonce. Pages are tens of kilobytes. The cost is a small TTFB increase versus
streaming. The gain is the nonce guarantee. Revisit buffering if streaming
latency matters on large documents.

`style-src` deliberately keeps `'unsafe-inline'`. React inline `style`
attributes are non-executable data and cannot be nonced. They are not an
injection surface in this application. Development and test keep
`'unsafe-eval'`:

- `ws:`/`wss:` for Vite HMR (never enabled in production).

## Remaining PLAT-03 work

Completed in PLAT-03: general API rate limiting (`docs/security.md`), SAST
and dependency-audit pipeline (pre-merge PR audit + `security.yml` CodeQL on
main/weekly + release-gate audit in `deploy.yml`), nonce CSP (this document),
backup permissions and posture (`docs/recovery.md`), SECURITY DEFINER / RLS /
grants audit (`docs/security.md`,
`tests/db/plat-03-security-audit.test.ts`), H1 capability-mask completion for
`api_client`, auth/session review (`docs/security.md`).

Still queued: penetration testing (needs real usage). See
`docs/security.md` §5.
