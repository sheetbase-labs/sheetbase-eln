# 0039. Application security headers

- **Status:** accepted
- **Date:** 2026-08-17
- **Ticket:** PLAT-03 (Low — headers slice)

## Context

PC-00 found no Content-Security-Policy or related security-header
implementation in application code. The SSR app uses an inline theme
bootstrap, same-origin Handsontable chunks, GitHub OAuth via top-level
redirect, and Vite HMR in development. A strict hash-only CSP would break
those paths.

## Decision

Stamp a documented CSP and related headers on every TanStack Start response
and on production static-file responses. Production CSP allows `'unsafe-inline'`
scripts/styles and same-origin framing. Development additionally allows
`'unsafe-eval'` and WebSocket schemes for Vite. GitHub is not added to
`connect-src` or `form-action`.

## Consequences

Clickjacking of third-party origins is blocked. MIME sniffing is disabled.
Further PLAT-03 work (rate limits, SAST, backup encryption, RLS audits) is
explicitly out of this slice. Hash/nonce CSP tightening needs a Start nonce
pipeline before `'unsafe-inline'` can be removed.
