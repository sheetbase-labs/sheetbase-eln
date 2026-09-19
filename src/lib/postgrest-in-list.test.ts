/**
 * Chunked `in.()` id-list helper tests.
 *
 * The /api/db proxy rejects query-param values over 500 chars
 * (MAX_QUERY_VALUE_LENGTH, postgrest-path.ts). These tests prove chunked
 * requests stay under that cap — by running every emitted query through the
 * real `sanitizeQuery` validator — and that merged pages preserve order and
 * dedupe rows a multi-column filter can match twice.
 */
import { describe, expect, it } from 'vitest'

import {
  chunkIds,
  IN_LIST_CHUNK_SIZE,
  IN_LIST_OR_CHUNK_SIZE,
  listInIdChunks,
} from './postgrest-in-list'
import { sanitizeQuery } from './postgrest-path'
import type { DataClient } from './data-client'

const UUID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function capturingClient(
  queries: string[],
  rowsByPrefix: Array<{ prefix: string; rows: unknown[] }> = [],
): DataClient {
  return {
    list: async <T>(resource: string, query = ''): Promise<T[]> => {
      queries.push(`${resource}${query}`)
      const route = rowsByPrefix.find((r) =>
        `${resource}${query}`.startsWith(r.prefix),
      )
      return (route ? route.rows : []) as T[]
    },
    count: async () => 0,
    rpc: async <T>(): Promise<T> => {
      throw new Error('no rpc in in-list tests')
    },
    insert: async <T>(): Promise<T> => {
      throw new Error('no insert in in-list tests')
    },
    patch: async () => [],
    remove: async () => [],
  }
}

describe('chunkIds', () => {
  it('splits an id set into bounded chunks', () => {
    const chunks = chunkIds(Array.from({ length: 23 }, (_, i) => `id-${i}`))
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 3])
    expect(chunks.flat().map(String)).toEqual(
      Array.from({ length: 23 }, (_, i) => `id-${i}`),
    )
  })

  it('returns no chunks for an empty set and honours a custom size', () => {
    expect(chunkIds([])).toEqual([])
    expect(chunkIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
  })
})

describe('listInIdChunks', () => {
  it('issues one request per chunk and merges the pages in order', async () => {
    const queries: string[] = []
    const client = capturingClient(queries, [
      { prefix: 'records?id=in.(id-0,', rows: [{ id: 'row-0' }] },
      { prefix: 'records?id=in.(id-10,', rows: [{ id: 'row-10' }] },
      { prefix: 'records?id=in.(id-20,', rows: [{ id: 'row-20' }] },
    ])
    const rows = await listInIdChunks<{ id: string }>(
      client,
      'records',
      Array.from({ length: 25 }, (_, i) => `id-${i}`),
      (idFilter) => `?id=in.(${idFilter})&select=id`,
    )
    expect(queries).toHaveLength(3)
    expect(rows.map((r) => r.id)).toEqual(['row-0', 'row-10', 'row-20'])
  })

  it('keeps every query-param value under the proxy cap', async () => {
    // 62 real-shaped UUIDs — the observed failing case from /lineage.
    const ids = Array.from({ length: 62 }, (_, i) => UUID(i))
    const queries: string[] = []
    const client = capturingClient(queries)
    await listInIdChunks(
      client,
      'records',
      ids,
      (idFilter) => `?id=in.(${idFilter})&select=id`,
    )
    expect(queries.length).toBe(Math.ceil(62 / IN_LIST_CHUNK_SIZE))
    for (const q of queries) {
      const search = q.slice(q.indexOf('?'))
      // The actual proxy validator must accept the query.
      expect(() => sanitizeQuery(search)).not.toThrow()
      for (const value of new URLSearchParams(search).values()) {
        expect(value.length).toBeLessThanOrEqual(500)
      }
    }
  })

  it('keeps an or() filter that repeats the id list under the cap', async () => {
    const ids = Array.from({ length: 62 }, (_, i) => UUID(i))
    const queries: string[] = []
    const client = capturingClient(queries)
    await listInIdChunks(
      client,
      'record_links',
      ids,
      (idFilter) =>
        `?or=(source_record_id.in.(${idFilter}),target_record_id.in.(${idFilter}))&select=id`,
      { chunkSize: IN_LIST_OR_CHUNK_SIZE },
    )
    expect(queries.length).toBe(Math.ceil(62 / IN_LIST_OR_CHUNK_SIZE))
    for (const q of queries) {
      const search = q.slice(q.indexOf('?'))
      expect(() => sanitizeQuery(search)).not.toThrow()
    }
  })

  it('dedupes rows a multi-column filter returns from several chunks', async () => {
    const shared = { id: 'link-1' }
    const queries: string[] = []
    // Chunks are disjoint id sets; the fake returns the same link for the
    // first two chunk requests, simulating an or() match on both sides.
    const client: DataClient = {
      ...capturingClient(queries),
      list: async <T>(resource: string, query = ''): Promise<T[]> => {
        queries.push(`${resource}${query}`)
        const list = new URLSearchParams(query).get('or') ?? ''
        return (
          list.includes('id-0') || list.includes('id-1') ? [shared] : []
        ) as T[]
      },
    }
    const rows = await listInIdChunks<{ id: string }>(
      client,
      'record_links',
      ['id-0', 'id-1', 'id-2', 'id-3'],
      (idFilter) => `?or=(a.in.(${idFilter}),b.in.(${idFilter}))`,
      { chunkSize: 2, dedupeBy: (row) => row.id },
    )
    expect(queries).toHaveLength(2)
    expect(rows).toEqual([shared])
  })

  it('does not dedupe single-column chunks (disjoint by construction)', async () => {
    const queries: string[] = []
    // Same row returned from two chunk pages is kept — a caller that needs
    // dedupe must opt in via dedupeBy.
    const client: DataClient = {
      ...capturingClient(queries),
      list: async <T>(): Promise<T[]> => [{ id: 'row-1' }] as T[],
    }
    const rows = await listInIdChunks<{ id: string }>(
      client,
      'records',
      ['a', 'b'],
      (idFilter) => `?id=in.(${idFilter})`,
      { chunkSize: 1 },
    )
    expect(rows).toHaveLength(2)
  })

  it('URL-encodes ids inside the in.() list', async () => {
    const queries: string[] = []
    const client = capturingClient(queries)
    await listInIdChunks(
      client,
      'records',
      ['weird id/1'],
      (idFilter) => `?id=in.(${idFilter})`,
    )
    expect(queries).toEqual(['records?id=in.(weird%20id%2F1)'])
  })
})
