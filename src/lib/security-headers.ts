/**
 * PLAT-03 (Low): deliberate Content-Security-Policy and related headers on
 * application responses. The policy is shaped around how this SSR app
 * actually loads code today:
 *
 * - Same-origin TanStack Start / Vite module scripts (`<Scripts />`).
 * - One inline theme/density bootstrap in `src/routes/__root.tsx`.
 * - TanStack `ScriptOnce` may emit additional inline scripts during SSR.
 * - Handsontable and HyperFormula load as same-origin client chunks.
 * - GitHub OAuth is a same-origin POST then a top-level navigation; it does
 *   not need github.com in `connect-src` or `form-action`.
 * - Live events use same-origin `EventSource` (`/api/events`).
 * - Downloads use `blob:` object URLs.
 * - Vite HMR in non-production needs `'unsafe-eval'` and `ws:`/`wss:`.
 *
 * `'unsafe-inline'` remains on `script-src` so those inline scripts keep
 * working. Hash/nonce tightening is queued with the rest of PLAT-03 Medium.
 */

export type SecurityHeaderMode = 'production' | 'development'

export const CONTENT_SECURITY_POLICY = 'content-security-policy'
export const X_CONTENT_TYPE_OPTIONS = 'x-content-type-options'
export const REFERRER_POLICY = 'referrer-policy'
export const X_FRAME_OPTIONS = 'x-frame-options'
export const PERMISSIONS_POLICY = 'permissions-policy'

export function resolveSecurityHeaderMode(
  env: NodeJS.ProcessEnv = process.env,
): SecurityHeaderMode {
  return env.NODE_ENV === 'production' ? 'production' : 'development'
}

export function buildContentSecurityPolicy(
  mode: SecurityHeaderMode = resolveSecurityHeaderMode(),
): string {
  const scriptSrc =
    mode === 'production'
      ? "'self' 'unsafe-inline'"
      : "'self' 'unsafe-inline' 'unsafe-eval'"
  // COLLAB: presence/comments ride Liveblocks websockets and API calls;
  // auth itself is same-origin (/api/collaboration/*). GitHub avatars are
  // rendered from user profiles in collaboration surfaces.
  const liveblocksConnect =
    mode === 'production'
      ? ' wss://*.liveblocks.io https://*.liveblocks.io'
      : ''
  const avatarImg = ' https://avatars.githubusercontent.com'
  const connectSrc =
    mode === 'production'
      ? `'self'${liveblocksConnect}`
      : `'self' ws: wss:${liveblocksConnect}`

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    // SAMEORIGIN / 'self' keeps Storybook's same-origin preview iframe
    // working when it is served from this origin; the app is not meant to
    // be framed by third parties.
    "frame-ancestors 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${avatarImg}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
  ].join('; ')
}

export function securityHeaderEntries(
  mode: SecurityHeaderMode = resolveSecurityHeaderMode(),
): Array<[string, string]> {
  return [
    [CONTENT_SECURITY_POLICY, buildContentSecurityPolicy(mode)],
    [X_CONTENT_TYPE_OPTIONS, 'nosniff'],
    [REFERRER_POLICY, 'strict-origin-when-cross-origin'],
    [X_FRAME_OPTIONS, 'SAMEORIGIN'],
    [
      PERMISSIONS_POLICY,
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    ],
  ]
}

/** Sets the security headers on a Fetch Headers object. Idempotent. */
export function applySecurityHeaders(
  headers: Headers,
  mode: SecurityHeaderMode = resolveSecurityHeaderMode(),
): Headers {
  for (const [name, value] of securityHeaderEntries(mode)) {
    headers.set(name, value)
  }
  return headers
}

/** Stamps security headers onto an existing Response. */
export function stampSecurityHeaders(
  response: Response,
  mode: SecurityHeaderMode = resolveSecurityHeaderMode(),
): Response {
  applySecurityHeaders(response.headers, mode)
  return response
}
