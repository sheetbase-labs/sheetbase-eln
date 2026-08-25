import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { livenessResponse } from './health'
import {
  CONTENT_SECURITY_POLICY,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
  X_CONTENT_TYPE_OPTIONS,
  X_FRAME_OPTIONS,
  applySecurityHeaders,
  buildContentSecurityPolicy,
  securityHeaderEntries,
  stampSecurityHeaders,
} from './security-headers'

const REQUIRED_HEADER_NAMES = [
  CONTENT_SECURITY_POLICY,
  X_CONTENT_TYPE_OPTIONS,
  REFERRER_POLICY,
  X_FRAME_OPTIONS,
  PERMISSIONS_POLICY,
] as const

describe('buildContentSecurityPolicy', () => {
  it('locks production script and connect sources to this origin plus required inline scripts', () => {
    const csp = buildContentSecurityPolicy('production')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toContain('ws:')
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("img-src 'self' data: blob:")
    expect(csp).toContain('wss://*.liveblocks.io')
    expect(csp).toContain('https://*.liveblocks.io')
    expect(csp).toContain('https://avatars.githubusercontent.com')
    expect(csp).toContain("worker-src 'self' blob:")
    // GitHub OAuth needs no github.com endpoints; only the avatar image host
    // is allowed, and only under img-src.
    const connectSrc = csp.split('; ').find((d) => d.startsWith('connect-src'))!
    expect(connectSrc).not.toContain('github.com')
  })

  it('allows Vite HMR eval and websockets outside production', () => {
    const csp = buildContentSecurityPolicy('development')
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'")
    expect(csp).toContain("connect-src 'self' ws: wss:")
  })
})

describe('securityHeaderEntries', () => {
  it('emits the required headers for a representative app response', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, 'production')
    for (const name of REQUIRED_HEADER_NAMES) {
      expect(headers.get(name)).toBeTruthy()
    }
    expect(headers.get(X_CONTENT_TYPE_OPTIONS)).toBe('nosniff')
    expect(headers.get(REFERRER_POLICY)).toBe('strict-origin-when-cross-origin')
    expect(headers.get(X_FRAME_OPTIONS)).toBe('SAMEORIGIN')
    expect(headers.get(PERMISSIONS_POLICY)).toContain('camera=()')
  })

  it('is idempotent', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, 'production')
    applySecurityHeaders(headers, 'production')
    const csp = headers.get(CONTENT_SECURITY_POLICY)
    expect(csp).toBe(buildContentSecurityPolicy('production'))
    expect(
      [...headers.entries()].filter(
        ([name]) => name === CONTENT_SECURITY_POLICY,
      ),
    ).toHaveLength(1)
  })
})

describe('stampSecurityHeaders', () => {
  it('stamps production headers on a liveness health response', async () => {
    const response = stampSecurityHeaders(
      livenessResponse(new Request('http://localhost/api/health/live')),
      'production',
    )
    expect(response.status).toBe(200)
    expect(response.headers.get(X_CONTENT_TYPE_OPTIONS)).toBe('nosniff')
    expect(response.headers.get(CONTENT_SECURITY_POLICY)).toBe(
      buildContentSecurityPolicy('production'),
    )
    expect(await response.json()).toEqual({ status: 'live' })
  })
})

describe('TanStack Start request middleware', () => {
  it('keeps CSRF protection when attaching security headers', () => {
    const source = readFileSync('src/start.ts', 'utf8')
    expect(source).toContain('createCsrfMiddleware')
    expect(source).toContain('applySecurityHeaders')
    expect(source).toContain('requestMiddleware')
  })
})

describe('production static-server helper stays in sync', () => {
  it('embeds the same production CSP string used by the app', () => {
    const source = readFileSync('scripts/lib/security-headers.mjs', 'utf8')
    expect(source).toContain(buildContentSecurityPolicy('production'))
    for (const [name] of securityHeaderEntries('production')) {
      expect(source).toContain(name)
    }
  })
})
