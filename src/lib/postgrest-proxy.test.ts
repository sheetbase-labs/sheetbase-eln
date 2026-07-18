import { describe, expect, it } from 'vitest'

import type { ProxyDeps } from './postgrest-proxy'
import { handleProxyRequest } from './postgrest-proxy'

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

  it('forwards with the minted token, method, body and sanitized query', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const response = await handleProxyRequest(
      req('projects?select=id&bad[key]=1', {
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
