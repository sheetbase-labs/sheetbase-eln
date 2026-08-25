/**
 * Production security headers for Node static-file responses.
 * Keep the CSP string in sync with src/lib/security-headers.ts
 * (`buildContentSecurityPolicy('production')`). The unit test reads this
 * file and asserts the strings match.
 */
export const PRODUCTION_SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; frame-src 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://avatars.githubusercontent.com; font-src 'self' data:; connect-src 'self' wss://*.liveblocks.io https://*.liveblocks.io; worker-src 'self' blob:",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
}

export function applyProductionSecurityHeaders(outgoing) {
  for (const [name, value] of Object.entries(PRODUCTION_SECURITY_HEADERS)) {
    outgoing.setHeader(name, value)
  }
}

export function mergeProductionSecurityHeaders(headers) {
  return { ...PRODUCTION_SECURITY_HEADERS, ...headers }
}
