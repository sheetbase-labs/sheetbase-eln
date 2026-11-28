import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient, dropSharedReads } from './data-client'
import {
  BATCH_MAX_READS,
  BATCH_URL,
  enableReadBatching,
  resetReadBatching,
} from './read-batch'

const sentBatch = z.object({
  reads: z.array(
    z.object({ path: z.string(), headers: z.record(z.string(), z.string()) }),
  ),
})

/** A fake server: single reads answer with their path, a batch answers each read. */
function fakeServer(options: { batch?: Response | 'missing' } = {}) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)

    if (url === BATCH_URL) {
      if (options.batch === 'missing')
        return new Response('not found', { status: 404 })

      if (options.batch) return options.batch.clone()
      const { reads } = sentBatch.parse(JSON.parse(String(init?.body)))

      return Response.json({
        results: reads.map((read) => ({
          status: 200,
          body: JSON.stringify([{ path: read.path, batched: true }]),
          contentRange: read.headers.prefer ? '0-0/42' : null,
        })),
      })
    }

    return Response.json([{ path: url.replace('/api/db', ''), batched: false }])
  })
}

afterEach(() => {
  resetReadBatching()
  dropSharedReads()
})

describe('read batching', () => {
  it('leaves every read on its own while batching is off', async () => {
    const fetchImpl = fakeServer()
    const client = createDataClient(fetchImpl)

    await Promise.all([client.list('records'), client.list('projects')])

    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/db/records',
      '/api/db/projects',
    ])
  })

  it('sends reads that start together as one request and hands each its own rows', async () => {
    enableReadBatching()
    const fetchImpl = fakeServer()
    const client = createDataClient(fetchImpl)

    const [records, links, projects] = await Promise.all([
      client.list('records', '?id=eq.1'),
      client.list('record_links', '?source_record_id=eq.1'),
      client.list('projects', '?id=eq.9'),
    ])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(BATCH_URL)
    expect(records).toEqual([{ path: '/records?id=eq.1', batched: true }])
    expect(links).toEqual([
      { path: '/record_links?source_record_id=eq.1', batched: true },
    ])
    expect(projects).toEqual([{ path: '/projects?id=eq.9', batched: true }])
  })

  it('sends a read that waits alone as the ordinary request', async () => {
    enableReadBatching()
    const fetchImpl = fakeServer()
    const client = createDataClient(fetchImpl)

    await client.list('records', '?id=eq.1')

    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/db/records?id=eq.1',
    ])
  })

  it('keeps the row count of a counted read', async () => {
    enableReadBatching()
    const client = createDataClient(fakeServer())

    const [total] = await Promise.all([
      client.count('records', '?kind=eq.experiment'),
      client.list('projects'),
    ])

    expect(total).toBe(42)
  })

  it('batches the stable functions and never a write', async () => {
    enableReadBatching()
    const fetchImpl = fakeServer()
    const client = createDataClient(fetchImpl)

    await Promise.all([
      client.rpc('record_series', { p_record_id: '1' }),
      client.rpc('record_gates', { p_record_id: '1' }),
    ])

    const batchCalls = fetchImpl.mock.calls.filter(
      ([url]) => String(url) === BATCH_URL,
    )

    expect(batchCalls).toHaveLength(1)

    fetchImpl.mockClear()
    await Promise.all([
      client.rpc('create_experiment', { p_title: 'x' }),
      client.rpc('update_record', { p_id: '1' }),
    ])

    expect(fetchImpl.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      '/api/db/rpc/create_experiment',
      '/api/db/rpc/update_record',
    ])
  })

  it('splits a very large wave into batches the server accepts', async () => {
    enableReadBatching()
    const fetchImpl = fakeServer()
    const client = createDataClient(fetchImpl)
    const total = BATCH_MAX_READS + 5

    await Promise.all(
      Array.from({ length: total }, (_, index) =>
        client.list('records', `?n=${index}`),
      ),
    )

    const sizes = fetchImpl.mock.calls.map(
      ([, init]) =>
        sentBatch.parse(JSON.parse(String(init?.body))).reads.length,
    )

    expect(sizes).toEqual([BATCH_MAX_READS, 5])
  })

  it('falls back to separate requests when the server has no batch route', async () => {
    enableReadBatching()
    const fetchImpl = fakeServer({ batch: 'missing' })
    const client = createDataClient(fetchImpl)

    const [records, projects] = await Promise.all([
      client.list('records'),
      client.list('projects'),
    ])

    expect(records).toEqual([{ path: '/records', batched: false }])
    expect(projects).toEqual([{ path: '/projects', batched: false }])
  })

  it('gives every read the same refusal when the whole batch is refused', async () => {
    enableReadBatching()

    const client = createDataClient(
      fakeServer({
        batch: Response.json(
          { error: { code: 'unauthenticated', message: 'Sign in.' } },
          { status: 401 },
        ),
      }),
    )

    const results = await Promise.allSettled([
      client.list('records'),
      client.list('projects'),
    ])

    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
    ])
    expect(results[0]).toMatchObject({ reason: { status: 401 } })
  })

  it('reports one read that failed without failing the others', async () => {
    enableReadBatching()

    const client = createDataClient(
      fakeServer({
        batch: Response.json({
          results: [
            { status: 200, body: '[{"id":"1"}]', contentRange: null },
            {
              status: 403,
              body: JSON.stringify({ code: '42501', message: 'denied' }),
              contentRange: null,
            },
          ],
        }),
      }),
    )

    const [records, projects] = await Promise.allSettled([
      client.list('records'),
      client.list('projects'),
    ])

    expect(records).toMatchObject({ status: 'fulfilled', value: [{ id: '1' }] })
    expect(projects).toMatchObject({
      status: 'rejected',
      reason: { status: 403 },
    })
  })
})
