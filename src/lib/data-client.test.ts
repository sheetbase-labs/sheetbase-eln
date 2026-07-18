import { describe, expect, it, vi } from 'vitest'

import { createDataClient, DataClientError } from './data-client'

function mockFetch(response: Response | (() => Response)): typeof fetch {
  const impl = response instanceof Response ? () => response : response
  return vi.fn(impl) as unknown as typeof fetch
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('createDataClient.list', () => {
  it('GETs a resource with the given query and returns parsed rows', async () => {
    const fetchImpl = mockFetch(jsonResponse([{ id: '1', title: 'A' }]))
    const client = createDataClient(fetchImpl)

    const rows = await client.list<{ id: string; title: string }>(
      'projects',
      '?select=id,title',
    )

    expect(rows).toEqual([{ id: '1', title: 'A' }])
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/db/projects?select=id,title',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('throws DataClientError for a proxy auth failure', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        { error: { code: 'unauthenticated', message: 'Sign in.' } },
        401,
      ),
    )
    const client = createDataClient(fetchImpl)

    await expect(client.list('projects')).rejects.toMatchObject({
      name: 'DataClientError',
      code: 'unauthenticated',
      status: 401,
      message: 'Sign in.',
    })
  })

  it('normalises a PostgREST error body into DataClientError', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        {
          code: '42501',
          message: 'permission denied',
          details: null,
          hint: null,
        },
        403,
      ),
    )
    const client = createDataClient(fetchImpl)

    await expect(client.list('projects')).rejects.toMatchObject({
      code: '42501',
      status: 403,
      message: 'permission denied',
    })
  })

  it('falls back to status text for a non-JSON error body', async () => {
    const fetchImpl = mockFetch(
      new Response('upstream broken', {
        status: 502,
        statusText: 'Bad Gateway',
      }),
    )
    const client = createDataClient(fetchImpl)

    await expect(client.list('projects')).rejects.toMatchObject({
      code: 'unknown_error',
      status: 502,
      message: 'Bad Gateway',
    })
  })
})

describe('createDataClient.rpc', () => {
  it('POSTs the args and returns the representation', async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ id: 'p1', key: 'virus-stability', title: 'Virus' }, 201),
    )
    const client = createDataClient(fetchImpl)

    const row = await client.rpc<{ id: string; key: string }>(
      'create_project',
      { p_title: 'Virus' },
    )

    expect(row).toEqual({ id: 'p1', key: 'virus-stability', title: 'Virus' })
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/db/rpc/create_project',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          prefer: 'return=representation',
        }),
        body: JSON.stringify({ p_title: 'Virus' }),
      }),
    )
  })
})

describe('DataClientError', () => {
  it('preserves code, message and status', () => {
    const error = new DataClientError('upstream_unavailable', 'down', 502)
    expect(error.code).toBe('upstream_unavailable')
    expect(error.message).toBe('down')
    expect(error.status).toBe(502)
    expect(error.name).toBe('DataClientError')
  })
})
