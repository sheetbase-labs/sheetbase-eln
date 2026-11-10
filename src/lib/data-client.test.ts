import { describe, expect, it, vi } from 'vitest'

import {
  CHANGE_REASON_HEADER,
  createDataClient,
  DataClientError,
  dropSharedReads,
} from './data-client'
import { forgetChangeReason, registerChangeReasonAsker } from './change-reason'

function mockFetch(response: Response | (() => Response)) {
  const impl = response instanceof Response ? () => response : response

  return vi.fn<typeof fetch>(async () => impl())
}

describe('createDataClient.list', () => {
  it('GETs a resource with the given query and returns parsed rows', async () => {
    const fetchImpl = mockFetch(Response.json([{ id: '1', title: 'A' }]))
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
      Response.json(
        { error: { code: 'unauthenticated', message: 'Sign in.' } },
        { status: 401 },
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
      Response.json(
        {
          code: '42501',
          message: 'permission denied',
          details: null,
          hint: null,
        },
        { status: 403 },
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

  it.each([
    { error: null },
    { error: 42 },
    { error: { category: 42, code: 'legacy', message: 'No.' } },
    { error: { category: 'upstream_unavailable', message: 42 } },
    { code: '502', message: 42 },
  ])(
    'rejects malformed error envelopes with the HTTP fallback: %j',
    async (body) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(body, { status: 502, statusText: 'Bad Gateway' }),
        )

      const failure = createDataClient(fetchImpl).list('projects')

      await expect(failure).rejects.toBeInstanceOf(DataClientError)
      await expect(failure).rejects.toMatchObject({
        name: 'DataClientError',
        code: 'unknown_error',
        status: 502,
        message: 'Bad Gateway',
      })
    },
  )

  it.each(['legacy', 42, null])(
    'prefers a valid proxy category over its ignored legacy code %j',
    async (legacyCode) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              category: 'upstream_unavailable',
              code: legacyCode,
              message: 'Try again.',
            },
          },
          { status: 502 },
        ),
      )

      await expect(
        createDataClient(fetchImpl).list('projects'),
      ).rejects.toMatchObject({
        name: 'DataClientError',
        code: 'upstream_unavailable',
        status: 502,
        message: 'Try again.',
      })
    },
  )
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
      Response.json(
        { id: 'p1', key: 'virus-stability', title: 'Virus' },
        { status: 201 },
      ),
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

    const [path, init] = fetchImpl.mock.calls[0]

    expect(path).toBe('/api/db/rpc/create_project')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ p_title: 'Virus' }))
    const headers = new Headers(init?.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('prefer')).toBe('return=representation')
  })
})

describe('createDataClient.rpc void responses', () => {
  it('accepts a native PostgREST 204 without trying to parse JSON', async () => {
    const response = new Response(null, { status: 204 })
    const parse = vi.spyOn(response, 'json')
    const client = createDataClient(mockFetch(response))
    await expect(
      client.rpc<void>('set_workspace_group_member', {
        p_group_id: 'group',
        p_user_id: 'person',
        p_is_member: true,
      }),
    ).resolves.toBeUndefined()
    expect(parse).not.toHaveBeenCalled()
  })

  it('does not turn malformed 200 responses into successful void mutations', async () => {
    const client = createDataClient(mockFetch(new Response('not json')))
    await expect(client.rpc<void>('mutation', {})).rejects.toBeInstanceOf(
      SyntaxError,
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

describe('createDataClient.rpc', () => {
  it('serializes arguments before validating the reason header', async () => {
    const fetchImpl = mockFetch(Response.json({ ok: true }))
    const events: string[] = []
    const failure = new Error('payload getter refused')

    await expect(
      createDataClient(fetchImpl).rpc(
        'update_block_payload',
        {
          get payload() {
            events.push('payload')
            throw failure
          },
        },
        {
          get changeReason() {
            events.push('reason')

            return 'invalid\nheader'
          },
        },
      ),
    ).rejects.toBe(failure)
    expect(events).toEqual(['reason', 'reason', 'payload'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends the change reason header only when a reason is given', async () => {
    const withReason = mockFetch(Response.json({ ok: true }))
    await createDataClient(withReason).rpc(
      'update_block_payload',
      { p_block_id: 'b1' },
      { changeReason: 'Corrected against the bench sheet' },
    )

    const [, init] = withReason.mock.calls[0]

    const headers = new Headers(init?.headers)
    expect(headers.get('x-sheetbase-change-reason')).toBe(
      'Corrected against the bench sheet',
    )

    const without = mockFetch(Response.json({ ok: true }))
    await createDataClient(without).rpc('update_block_payload', {
      p_block_id: 'b1',
    })

    const [, plain] = without.mock.calls[0]

    expect(
      new Headers(plain?.headers).get('x-sheetbase-change-reason'),
    ).toBeNull()
  })
})

describe('createDataClient change reasons', () => {
  const refusal = () =>
    Response.json(
      {
        code: 'SB114',
        message: 'a reason is required to change a saved value',
      },
      { status: 400 },
    )

  it('asks for a reason when the database wants one, then sends the write again with it', async () => {
    forgetChangeReason()
    registerChangeReasonAsker(async () => 'Corrected against the bench sheet')

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => refusal())
      .mockImplementationOnce(async () => Response.json([{ id: 'b1' }]))

    const client = createDataClient(fetchImpl)

    const rows = await client.patch('blocks', '?id=eq.b1', { payload: {} })

    expect(rows).toEqual([{ id: 'b1' }])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const retried = fetchImpl.mock.calls[1][1]
    expect(new Headers(retried?.headers).get(CHANGE_REASON_HEADER)).toBe(
      'Corrected against the bench sheet',
    )
    // The answer covers the next write without another question.
    fetchImpl.mockImplementationOnce(async () => Response.json([]))
    await client.patch('blocks', '?id=eq.b1', { payload: {} })
    const next = fetchImpl.mock.calls[2][1]
    expect(new Headers(next?.headers).get(CHANGE_REASON_HEADER)).toBe(
      'Corrected against the bench sheet',
    )
    registerChangeReasonAsker(null)
    forgetChangeReason()
  })

  it('surfaces the refusal when the person declines to give a reason', async () => {
    forgetChangeReason()
    registerChangeReasonAsker(async () => null)
    const fetchImpl = vi.fn<typeof fetch>(async () => refusal())
    const client = createDataClient(fetchImpl)

    await expect(
      client.patch('blocks', '?id=eq.b1', { payload: {} }),
    ).rejects.toMatchObject({ code: 'SB114' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    registerChangeReasonAsker(null)
  })

  it('never asks about a read', async () => {
    forgetChangeReason()
    const asker = vi.fn(async () => 'x')
    registerChangeReasonAsker(asker)
    const fetchImpl = vi.fn<typeof fetch>(async () => refusal())
    const client = createDataClient(fetchImpl)

    await expect(client.list('blocks')).rejects.toBeInstanceOf(DataClientError)
    expect(asker).not.toHaveBeenCalled()
    registerChangeReasonAsker(null)
  })
})

describe('createDataClient shared reads', () => {
  const rows = () => Response.json([{ id: '1' }])

  it('answers an identical read that is already in flight with one request', async () => {
    const fetchImpl = mockFetch(rows)
    const client = createDataClient(fetchImpl)
    const other = createDataClient(fetchImpl)

    const [a, b, c] = await Promise.all([
      client.list<{ id: string }>('records', '?id=eq.1'),
      other.list<{ id: string }>('records', '?id=eq.1'),
      client.list<{ id: string }>('records', '?id=eq.2'),
    ])

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(a).toEqual([{ id: '1' }])
    // Every caller gets its own copy to change.
    expect(b).not.toBe(a)
    expect(c).toEqual([{ id: '1' }])
  })

  it('shares a read that finished a moment ago', async () => {
    const fetchImpl = mockFetch(rows)
    const client = createDataClient(fetchImpl)

    await client.list('records', '?id=eq.1')
    await client.list('records', '?id=eq.1')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reads again after a write', async () => {
    const fetchImpl = mockFetch(rows)
    const client = createDataClient(fetchImpl)

    await client.list('records', '?id=eq.1')
    await client.patch('records', '?id=eq.1', { title: 'New' })
    await client.list('records', '?id=eq.1')

    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('keeps reads across a lookup function but not across a changing one', async () => {
    const fetchImpl = mockFetch(rows)
    const client = createDataClient(fetchImpl)

    await client.list('records', '?id=eq.1')
    await client.rpc('is_workspace_writer', {})
    await client.list('records', '?id=eq.1')
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    await client.rpc('archive_record', {})
    await client.list('records', '?id=eq.1')
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('reads again after the app hears of a change', async () => {
    const fetchImpl = mockFetch(rows)
    const client = createDataClient(fetchImpl)

    await client.list('records', '?id=eq.1')
    dropSharedReads()
    await client.list('records', '?id=eq.1')

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not keep a failed read', async () => {
    const fetchImpl = mockFetch(() =>
      Response.json(
        { error: { code: 'boom', message: 'No.' } },
        { status: 500 },
      ),
    )

    const client = createDataClient(fetchImpl)

    await expect(client.list('records', '?id=eq.1')).rejects.toBeDefined()
    await expect(client.list('records', '?id=eq.1')).rejects.toBeDefined()

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
