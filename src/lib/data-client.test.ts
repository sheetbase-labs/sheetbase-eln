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

describe('createDataClient.count', () => {
  it.each([
    ['0-0/200017', 200017],
    ['*/0', 0],
  ])(
    'reads the exact total from %s, not the one-row body',
    async (header, total) => {
      const response = new Response(
        JSON.stringify([{ id: 'only-returned-row' }]),
        {
          headers: { 'content-range': header },
        },
      )
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response)
      expect(
        await createDataClient(fetchImpl).count('records', '?kind=eq.sample'),
      ).toBe(total)
      const [path, init] = fetchImpl.mock.calls[0]
      expect(path).toBe('/api/db/records?kind=eq.sample')
      expect(init?.method).toBe('GET')
      const headers = new Headers(init?.headers)
      expect(headers.get('prefer')).toBe('count=exact')
      expect(headers.get('range')).toBe('0-0')
      expect(response.bodyUsed).toBe(true)
    },
  )

  it.each([
    null,
    '',
    '0-0/*',
    '*/*',
    'garbage/17',
    '0-0/-1',
    '0-0/1.5',
    '0-0/9007199254740992',
    '1-0/17',
    '0-17/17',
    '0-0/0',
  ])(
    'rejects an unavailable exact total (%s) and drains the response',
    async (header) => {
      const response = new Response('[{"id":"one-row-is-not-the-total"}]', {
        headers: header === null ? {} : { 'content-range': header },
      })
      await expect(
        createDataClient(mockFetch(response)).count('records'),
      ).rejects.toMatchObject({
        name: 'DataClientError',
        code: 'invalid_count',
      })
      expect(response.bodyUsed).toBe(true)
    },
  )

  it('does not turn a missing count and a non-JSON body into zero', async () => {
    const response = new Response('not a JSON count')
    await expect(
      createDataClient(mockFetch(response)).count('records'),
    ).rejects.toMatchObject({
      code: 'invalid_count',
    })
    expect(response.bodyUsed).toBe(true)
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
    // LIVE-003: data-client now stamps headers via a Headers instance
    // (so x-sheetbase-client-id is added); assert against the call args
    // directly rather than objectContaining, which can't see Headers entries.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [path, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(path).toBe('/api/db/rpc/create_project')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ p_title: 'Virus' }))
    const headers = new Headers(init.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('prefer')).toBe('return=representation')
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
