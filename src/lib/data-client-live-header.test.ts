import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

import { createDataClient } from './data-client'

// LIVE-003: every /api/db request carries x-sheetbase-client-id so the
// proxy can mint it into the JWT and durable change events record the
// actor's tab. jsdom provides sessionStorage + crypto.randomUUID.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('data-client x-sheetbase-client-id header (LIVE-003)', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })
  afterEach(() => {
    sessionStorage.clear()
  })

  it('stamps a uuid client id on every request', async () => {
    let seen: Headers | null = null
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      seen = new Headers(init.headers)
      return jsonResponse([])
    }) as unknown as typeof fetch
    const client = createDataClient(fetchImpl)

    await client.list('projects')
    await client.rpc('create_project', { p_title: 'X' })

    const first = seen!.get('x-sheetbase-client-id')
    expect(first).toBeTruthy()
    expect(first).toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    )
  })

  it('reuses the same client id across requests in the same tab', async () => {
    const ids: string[] = []
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const h = new Headers(init.headers)
      ids.push(h.get('x-sheetbase-client-id') ?? '')
      return jsonResponse([])
    }) as unknown as typeof fetch
    const client = createDataClient(fetchImpl)

    await client.list('projects')
    await client.list('records')
    await client.rpc('noop', {})

    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(1)
  })
})
