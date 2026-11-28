import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDataClient,
  dropSharedReads,
  observeReads,
  primeRead,
} from './data-client'
import type { ReadSpec } from './data-client'

const read = (path: string): ReadSpec => ({
  method: 'GET',
  path,
  headers: { accept: 'application/json' },
})

function server() {
  let served = 0

  return vi.fn<typeof fetch>(async (input) => {
    served += 1

    return Response.json([
      { url: input instanceof Request ? input.url : input.toString(), served },
    ])
  })
}

afterEach(() => {
  observeReads(null)
  dropSharedReads()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('primed reads', () => {
  it('gives the first reader the answer that was started ahead, without a second request', async () => {
    const fetchImpl = server()
    const client = createDataClient(fetchImpl)

    client.prime?.(read('/records?id=eq.1'))
    const rows = await client.list('records', '?id=eq.1')

    expect(rows).toEqual([{ url: '/api/db/records?id=eq.1', served: 1 }])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('starts a read once however many times it is primed', async () => {
    const fetchImpl = server()
    const client = createDataClient(fetchImpl)

    client.prime?.(read('/records?id=eq.1'))
    client.prime?.(read('/records?id=eq.1'))
    await client.list('records', '?id=eq.1')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('forgets a guess nobody asked for, so a late reader gets fresh rows', async () => {
    vi.useFakeTimers()
    const fetchImpl = server()
    const client = createDataClient(fetchImpl)

    client.prime?.(read('/records?id=eq.1'))
    await vi.advanceTimersByTimeAsync(11_000)
    const rows = await client.list('records', '?id=eq.1')

    expect(rows).toEqual([{ url: '/api/db/records?id=eq.1', served: 2 }])
  })

  it('forgets everything it started ahead when something is written', async () => {
    const fetchImpl = server()
    const client = createDataClient(fetchImpl)

    client.prime?.(read('/records?id=eq.1'))
    await client.patch('records', '?id=eq.1', { title: 'x' })
    await client.list('records', '?id=eq.1')

    // The prime, the write, and a fresh read after it.
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('lets a failed guess fail quietly and the reader ask again', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ code: '42501', message: 'denied' }, { status: 403 }),
      )
      .mockResolvedValue(Response.json([{ ok: true }]))

    const client = createDataClient(fetchImpl)

    client.prime?.(read('/records?id=eq.1'))
    await Promise.resolve()
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))

    await expect(client.list('records', '?id=eq.1')).resolves.toEqual([
      { ok: true },
    ])
  })

  it('primes through the default client, as the warm start does', async () => {
    const fetchImpl = server()

    vi.stubGlobal('fetch', fetchImpl)
    primeRead(read('/records?id=eq.9'))
    await createDataClient().list('records', '?id=eq.9')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('primes a stable function the same way, arguments and all', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json([1, 2]))
    const client = createDataClient(fetchImpl)
    const body = JSON.stringify({ p_record_id: 'r1' })

    client.prime?.({
      method: 'POST',
      path: '/rpc/record_series',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        prefer: 'return=representation',
      },
      body,
    })
    const result = await client.rpc('record_series', { p_record_id: 'r1' })

    expect(result).toEqual([1, 2])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('observing reads', () => {
  it('tells the observer every read it is asked for, and not the ones it primes', async () => {
    const seen: string[] = []
    const client = createDataClient(server())

    observeReads((spec) => seen.push(spec.path))
    client.prime?.(read('/records?id=eq.1'))
    await client.list('records', '?id=eq.1')
    await client.list('projects')

    expect(seen).toEqual(['/records?id=eq.1', '/projects'])
  })

  it('shares identical calls of a stable function', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json([1]))
    const client = createDataClient(fetchImpl)

    await Promise.all([
      client.rpc('record_gates', { p_record_id: 'r1' }),
      client.rpc('record_gates', { p_record_id: 'r1' }),
    ])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('never shares a call of a function that writes', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json([]))
    const client = createDataClient(fetchImpl)

    await Promise.all([
      client.rpc('create_thing', { p_name: 'a' }),
      client.rpc('create_thing', { p_name: 'a' }),
    ])

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
