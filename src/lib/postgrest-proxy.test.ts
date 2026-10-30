import { describe, expect, it, vi } from 'vitest'

import type { ProxyDeps } from './postgrest-proxy'
import { handleProxyRequest } from './postgrest-proxy'
import { metrics } from './metrics'
import { createRateLimiter } from './rate-limit'
import * as requestLog from './request-log'

function makeDeps(overrides: Partial<ProxyDeps> = {}): ProxyDeps {
  return {
    getSession: async () => ({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    }),
    getWorkspaceForUser: async () => ({ id: 'workspace-1' }),
    mintToken: async () => 'minted-jwt',
    upstreamBaseUrl: 'http://upstream:3001',
    fetchFn: async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ...overrides,
  }
}

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost:3000/api/db/${path}`, init)
}

describe('handleProxyRequest', () => {
  it('rejects disallowed paths before touching the session', async () => {
    let sessionChecked = false
    const response = await handleProxyRequest(
      req('../internal.user'),
      '../internal.user',
      makeDeps({
        getSession: async () => {
          sessionChecked = true
          return null
        },
      }),
    )
    expect(response.status).toBe(400)
    expect(sessionChecked).toBe(false)
    const body = await response.json()
    expect(body.error.category).toBe('validation_error')
  })

  it('rejects unauthenticated requests with a stable envelope', async () => {
    const response = await handleProxyRequest(
      req('projects'),
      'projects',
      makeDeps({ getSession: async () => null }),
    )
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error.category).toBe('unauthenticated')
    expect(JSON.stringify(body)).not.toContain('cookie')
  })

  it('never falls back to a browser session for a malformed bearer header', async () => {
    let sessionChecked = false
    const malformed = await handleProxyRequest(
      req('projects', { headers: { authorization: 'Bearer ' } }),
      'projects',
      makeDeps({
        getSession: async () => {
          sessionChecked = true
          return {
            user: { id: 'user-1' },
            session: { id: 'session-1' },
          }
        },
      }),
    )
    expect(malformed.status).toBe(401)
    expect(sessionChecked).toBe(false)

    const missingResolver = await handleProxyRequest(
      req('projects', { headers: { authorization: 'Bearer external-jwt' } }),
      'projects',
      makeDeps({ resolveExternalToken: undefined }),
    )
    expect(missingResolver.status).toBe(401)
  })

  it('rejects users without a workspace as permission_denied', async () => {
    const response = await handleProxyRequest(
      req('projects'),
      'projects',
      makeDeps({ getWorkspaceForUser: async () => null }),
    )
    expect(response.status).toBe(403)
    expect((await response.json()).error.category).toBe('permission_denied')
  })

  it('rejects workspace-mismatched requests before forwarding', async () => {
    let forwarded = false
    const response = await handleProxyRequest(
      req('projects', { headers: { 'x-sheetbase-workspace': 'workspace-2' } }),
      'projects',
      makeDeps({
        fetchFn: async () => {
          forwarded = true
          return new Response('[]')
        },
      }),
    )
    expect(response.status).toBe(403)
    expect((await response.json()).error.category).toBe('permission_denied')
    expect(forwarded).toBe(false)
  })

  it('forwards with the minted token, method, body and safe query', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const response = await handleProxyRequest(
      req('projects?select=id', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify({ title: 'New project' }),
      }),
      'projects',
      makeDeps({
        fetchFn: async (url, init) => {
          seen = { url: String(url), init: init ?? {} }
          return new Response('[{"id":"p1"}]', {
            status: 201,
            headers: { 'content-type': 'application/json' },
          })
        },
      }),
    )

    expect(response.status).toBe(201)
    expect(await response.text()).toBe('[{"id":"p1"}]')
    expect(seen!.url).toBe('http://upstream:3001/projects?select=id')
    expect(seen!.init.method).toBe('POST')
    expect(new Headers(seen!.init.headers).get('authorization')).toBe(
      'Bearer minted-jwt',
    )
    expect(new Headers(seen!.init.headers).get('prefer')).toBe(
      'return=representation',
    )
    expect(seen!.init.body).toBe(JSON.stringify({ title: 'New project' }))
  })

  it('rejects an unsafe query instead of dropping a filter', async () => {
    let forwarded = false
    const response = await handleProxyRequest(
      req('projects?bad[key]=1'),
      'projects',
      makeDeps({
        fetchFn: async () => {
          forwarded = true
          return new Response('[]')
        },
      }),
    )
    expect(response.status).toBe(400)
    expect(forwarded).toBe(false)
  })

  it('requires id/version for a generated PATCH and controls its Prefer header', async () => {
    const resource = `sheet_${'a'.repeat(26)}`
    const id = '10000000-0000-4000-8000-000000000001'
    const missingVersion = await handleProxyRequest(
      req(`${resource}?id=eq.${id}`, {
        method: 'PATCH',
        body: '{}',
      }),
      resource,
      makeDeps(),
    )
    expect(missingVersion.status).toBe(400)

    let prefer: string | null = null
    const success = await handleProxyRequest(
      req(`${resource}?id=eq.${id}&version=eq.1`, {
        method: 'PATCH',
        headers: {
          prefer: 'return=minimal',
          'content-type': 'application/json',
        },
        body: '{}',
      }),
      resource,
      makeDeps({
        fetchFn: async (_url, init) => {
          prefer = new Headers(init?.headers).get('prefer')
          return Response.json([{ id, version: 2 }])
        },
      }),
    )
    expect(success.status).toBe(200)
    expect(prefer).toBe('handling=strict,max-affected=1,return=representation')
  })

  it('rejects caller-controlled filters and response shaping on mutations', async () => {
    const resource = `sheet_${'a'.repeat(26)}`
    const id = '10000000-0000-4000-8000-000000000001'
    for (const extra of ['select=id', 'limit=0', 'col_value=eq.hidden']) {
      let forwarded = false
      const response = await handleProxyRequest(
        req(`${resource}?id=eq.${id}&version=eq.1&${extra}`, {
          method: 'PATCH',
          body: '{}',
        }),
        resource,
        makeDeps({
          fetchFn: async () => {
            forwarded = true
            return Response.json([])
          },
        }),
      )
      expect(response.status, extra).toBe(400)
      expect(forwarded, extra).toBe(false)
    }
  })

  it('maps an empty generated mutation result to stale_version', async () => {
    const resource = `sheet_${'a'.repeat(26)}`
    const id = '10000000-0000-4000-8000-000000000001'
    const response = await handleProxyRequest(
      req(`${resource}?id=eq.${id}&version=eq.1`, {
        method: 'DELETE',
      }),
      resource,
      makeDeps({ fetchFn: async () => Response.json([]) }),
    )
    expect(response.status).toBe(409)
    expect((await response.json()).error.category).toBe('stale_version')
  })

  it('forwards range pagination headers in both directions', async () => {
    const response = await handleProxyRequest(
      req('projects', { headers: { range: '0-9', 'range-unit': 'items' } }),
      'projects',
      makeDeps({
        fetchFn: async (_url, init) => {
          expect(new Headers(init?.headers).get('range')).toBe('0-9')
          return new Response('[]', {
            headers: {
              'content-type': 'application/json',
              'content-range': '0-9/25',
              'range-unit': 'items',
            },
          })
        },
      }),
    )
    expect(response.headers.get('content-range')).toBe('0-9/25')
    expect(response.headers.get('range-unit')).toBe('items')
  })

  it('does not poll OpenAPI readiness for a still-valid non-schema RPC', async () => {
    let calls = 0
    const response = await handleProxyRequest(
      req('rpc/create_record', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      'rpc/create_record',
      makeDeps({
        fetchFn: async () => {
          calls += 1
          return Response.json({ id: '10000000-0000-4000-8000-000000000001' })
        },
      }),
    )
    expect(response.status).toBe(200)
    expect(calls).toBe(1)
  })

  it('forwards the x-sheetbase-client-id header to the token minter (LIVE-003)', async () => {
    let minted: { clientId?: string | null } | null = null
    const response = await handleProxyRequest(
      req('projects', {
        headers: { 'x-sheetbase-client-id': 'tab-123' },
      }),
      'projects',
      makeDeps({
        mintToken: async (input) => {
          minted = input
          return 'minted-jwt'
        },
      }),
    )
    expect(response.status).toBe(200)
    expect(minted).toMatchObject({ clientId: 'tab-123' })
  })

  it('passes null clientId when the browser did not send the header', async () => {
    let minted: { clientId?: string | null } | null = null
    await handleProxyRequest(
      req('projects'),
      'projects',
      makeDeps({
        mintToken: async (input) => {
          minted = input
          return 'minted-jwt'
        },
      }),
    )
    expect(minted).toMatchObject({ clientId: null })
  })

  it('maps upstream connection failure to a non-sensitive service_unavailable', async () => {
    const response = await handleProxyRequest(
      req('projects'),
      'projects',
      makeDeps({
        fetchFn: async () => {
          throw new Error('ECONNREFUSED 10.0.0.4:5432')
        },
      }),
    )
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body.error.category).toBe('service_unavailable')
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED')
  })

  it('stamps a request id on every response, forwarding it upstream', async () => {
    let upstreamRequestId: string | null = null
    const response = await handleProxyRequest(
      req('projects', { headers: { 'x-request-id': 'req-abc-123' } }),
      'projects',
      makeDeps({
        fetchFn: async (_url, init) => {
          upstreamRequestId = new Headers(init?.headers).get('x-request-id')
          return new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      }),
    )
    expect(response.headers.get('x-request-id')).toBe('req-abc-123')
    expect(upstreamRequestId).toBe('req-abc-123')
  })

  it('generates a request id when the incoming one is missing', async () => {
    const response = await handleProxyRequest(
      req('projects'),
      'projects',
      makeDeps(),
    )
    const id = response.headers.get('x-request-id')
    expect(id).not.toBeNull()
    expect(id).toMatch(/^[a-z0-9-]{1,128}$/i)
    expect(id).toHaveLength(32) // 16 random bytes as hex
  })

  it('re-wraps upstream PostgREST errors into stable categories', async () => {
    const response = await handleProxyRequest(
      req('projects'),
      'projects',
      makeDeps({
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              code: '23505',
              message: 'duplicate key value violates unique constraint',
              details: 'Key (workspace_id, slug)=(ws, dup) already exists.',
              hint: 'Pick another slug.',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
      }),
    )
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error.category).toBe('conflict')
    // The upstream message is preserved; details/hint that leak schema are not.
    expect(body.error.message).toContain('duplicate key')
    expect(JSON.stringify(body)).not.toContain('Pick another slug')
    expect(body.error.request_id).toBeDefined()
  })

  it('classifies permission-denied upstream errors distinctly from server errors', async () => {
    const response = await handleProxyRequest(
      req('projects'),
      'projects',
      makeDeps({
        fetchFn: async () =>
          new Response(JSON.stringify({ code: '42501', message: 'denied' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }),
      }),
    )
    expect(response.status).toBe(403)
    expect((await response.json()).error.category).toBe('permission_denied')
  })

  it('passes through successful upstream bodies unchanged', async () => {
    const response = await handleProxyRequest(
      req('projects'),
      'projects',
      makeDeps({
        fetchFn: async () =>
          new Response('[{"id":"p1","title":"A"}]', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      }),
    )
    expect(await response.json()).toEqual([{ id: 'p1', title: 'A' }])
  })
})

describe('handleProxyRequest — external bearer token path', () => {
  it('forwards the bearer token untouched when the resolver succeeds', async () => {
    let seenAuth: string | null = null
    const response = await handleProxyRequest(
      req('projects', {
        headers: { authorization: 'Bearer external-jwt' },
      }),
      'projects',
      makeDeps({
        resolveExternalToken: async () => ({ workspaceId: 'workspace-1' }),
        fetchFn: async (_url, init) => {
          seenAuth = new Headers(init?.headers).get('authorization')
          return new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      }),
    )
    expect(response.status).toBe(200)
    expect(seenAuth).toBe('Bearer external-jwt')
  })

  it('returns unauthenticated when the resolver rejects with invalid_token', async () => {
    const response = await handleProxyRequest(
      req('projects', { headers: { authorization: 'Bearer bad' } }),
      'projects',
      makeDeps({
        resolveExternalToken: async () => {
          const err = new (class extends Error {
            code = 'invalid_token' as const
          })()
          throw err
        },
      }),
    )
    // ExternalTokenError mapping lives in external-token.ts; the proxy's
    // fallback for a non-ExternalTokenError is the unauthenticated envelope.
    expect(response.status).toBe(401)
    expect((await response.json()).error.category).toBe('unauthenticated')
  })

  it('returns permission_denied when the resolver rejects with insufficient_scope', async () => {
    const { ExternalTokenError } = await import('./external-token')
    const response = await handleProxyRequest(
      req('projects', {
        method: 'POST',
        headers: { authorization: 'Bearer external-jwt' },
      }),
      'projects',
      makeDeps({
        resolveExternalToken: async () => {
          throw new ExternalTokenError(
            'insufficient_scope',
            'Credential lacks scope: projects:write',
          )
        },
      }),
    )
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error.category).toBe('permission_denied')
    expect(body.error.message).toContain('projects:write')
    expect(JSON.stringify(body)).not.toContain('Bearer')
  })

  it('returns permission_denied when the resolver rejects with revoked', async () => {
    const { ExternalTokenError } = await import('./external-token')
    const response = await handleProxyRequest(
      req('projects', { headers: { authorization: 'Bearer external-jwt' } }),
      'projects',
      makeDeps({
        resolveExternalToken: async () => {
          throw new ExternalTokenError(
            'revoked',
            'Credential has been revoked.',
          )
        },
      }),
    )
    expect(response.status).toBe(403)
    expect((await response.json()).error.category).toBe('permission_denied')
  })

  it('falls back to the browser session when no bearer header is present', async () => {
    let resolverCalled = false
    const response = await handleProxyRequest(
      req('projects'),
      'projects',
      makeDeps({
        resolveExternalToken: async () => {
          resolverCalled = true
          return { workspaceId: 'workspace-1' }
        },
      }),
    )
    expect(response.status).toBe(200)
    expect(resolverCalled).toBe(false)
  })
})

describe('PLAT-02 proxy metrics', () => {
  it('counts success with status, category ok and duration', async () => {
    await handleProxyRequest(req('projects'), 'projects', makeDeps())
    const rendered = metrics.render()
    expect(rendered).toMatch(
      /sheetbase_http_requests_total\{route="db_proxy",method="GET",status="200"\} \d+/,
    )
    expect(rendered).toMatch(
      /sheetbase_db_upstream_requests_total\{category="ok"\} \d+/,
    )
    expect(rendered).toContain(
      'sheetbase_db_upstream_duration_seconds_count{method="GET"}',
    )
  })

  it('counts upstream failures by public category', async () => {
    const response = await handleProxyRequest(
      req('projects'),
      'projects',
      makeDeps({
        fetchFn: async () =>
          new Response('boom', {
            status: 503,
            headers: { 'content-type': 'text/plain' },
          }),
      }),
    )
    expect(response.status).toBe(503)
    expect(metrics.render()).toMatch(
      /sheetbase_db_upstream_requests_total\{category="service_unavailable"\} \d+/,
    )
  })

  it('counts route label as the fixed db_proxy bucket, never the path', async () => {
    await handleProxyRequest(
      req('some_table_with_a_long_id'),
      'some_table_with_a_long_id',
      makeDeps(),
    )
    const rendered = metrics.render()
    expect(rendered).not.toContain('some_table_with_a_long_id')
    expect(rendered).toContain('route="db_proxy"')
  })
})

describe('PLAT-02 log correlation', () => {
  it('propagates the request id into the structured request log and redacts sensitive fields', async () => {
    const info = vi
      .spyOn(requestLog, 'annotateRequest')
      .mockImplementation(() => undefined)
    try {
      await handleProxyRequest(
        req('projects', { headers: { 'x-request-id': 'corr-123' } }),
        'projects',
        makeDeps(),
      )
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ request_id: 'corr-123' }),
      )
    } finally {
      info.mockRestore()
    }
  })
})

describe('PLAT-03 proxy rate limiting', () => {
  function limitedDeps(maxRequests: number): ProxyDeps {
    return makeDeps({
      rateLimiter: createRateLimiter({ maxRequests, windowSeconds: 60 }),
    })
  }

  it('blocks the principal with the public rate_limited envelope after the cap', async () => {
    const deps = limitedDeps(2)
    for (let i = 0; i < 2; i += 1) {
      const ok = await handleProxyRequest(req('projects'), 'projects', deps)
      expect(ok.status).toBe(200)
    }
    const blocked = await handleProxyRequest(req('projects'), 'projects', deps)
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
    const body = (await blocked.json()) as { error: { category: string } }
    expect(body.error.category).toBe('rate_limited')
  })

  it('keys sessions independently and counts the rejection in metrics', async () => {
    const deps = limitedDeps(1)
    const first = await handleProxyRequest(req('projects'), 'projects', deps)
    expect(first.status).toBe(200)

    const other = makeDeps({
      getSession: async () => ({
        user: { id: 'user-2' },
        session: { id: 'session-other' },
      }),
      rateLimiter: deps.rateLimiter,
    })
    const different = await handleProxyRequest(
      req('projects'),
      'projects',
      other,
    )
    expect(different.status).toBe(200)

    expect(metrics.render()).toMatch(
      /sheetbase_db_upstream_requests_total\{category="rate_limited"\} \d+/,
    )
  })
})
