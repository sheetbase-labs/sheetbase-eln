/**
 * An indexed search provider is asked what to look up, the index finds the
 * records, and the provider is handed only those to check.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'

import { searchWithPlugins } from './plugin-search.server'

const run = vi.hoisted(() => vi.fn())

vi.mock('./data-runtime.server', () => ({ runExtensionSearch: run }))

vi.mock('./client', () => ({ listExtensions: async () => [] }))

const provider = vi.hoisted(() => ({
  value: {
    extensionKey: 'chemistry',
    extensionName: 'Chemistry',
    id: 'structures',
    declaration: {
      title: 'Structure search',
      types: ['record'],
      indexed: true,
    },
  },
}))

vi.mock('./runner-points', () => ({
  resolveRunnerPoints: () => ({
    data: { 'search-providers': [provider.value] },
  }),
}))

const row = (id: string) => ({
  object_type: 'record',
  object_id: id,
  title: id,
  identifier: id.toUpperCase(),
  kind: 'compound',
  status: 'draft',
  body: '',
  fields: { structure: 'M  END' },
  deep_link: `/records/${id}`,
})

function client() {
  const list = vi.fn(async (_table: string, query: string) =>
    query.includes('object_id=in.')
      ? [row('a'), row('b')]
      : [row('a'), row('b'), row('c')],
  )

  const rpc = vi.fn(async () => [
    { record_id: 'a', entry_key: 'main', score: 0.9, snippet: null },
    { record_id: 'b', entry_key: 'main', score: 0.8, snippet: null },
  ])

  return { list, rpc } as unknown as DataClient & {
    list: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  run.mockReset()
  provider.value.declaration.indexed = true
})

describe('searchWithPlugins with an indexed provider', () => {
  it('plans with no documents, ranks the index, then checks only what it found', async () => {
    run
      .mockResolvedValueOnce({
        hits: [],
        nearest: {
          index: 'structures',
          text: 'p1 p2',
          vector: null,
          limit: 700,
          verify: true,
        },
      })
      .mockResolvedValueOnce({
        hits: [{ id: 'b', score: 1, snippet: 'Contains the structure' }],
        nearest: null,
      })
    const c = client()

    const view = await searchWithPlugins(c, {
      workspaceId: 'w',
      actorUserId: 'u',
      query: 'sub:c1ccccc1',
    })

    expect(run.mock.calls[0][0]).toMatchObject({ documents: [], stage: 'plan' })
    expect(c.rpc).toHaveBeenCalledWith(
      'search_plugin_index',
      expect.objectContaining({ p_query: 'p1 p2', p_limit: 700 }),
    )

    const second = run.mock.calls[1][0] as {
      stage: string
      documents: Array<{ id: string }>
    }

    expect(second.stage).toBe('rank')
    expect(second.documents.map((d) => d.id)).toEqual(['a', 'b'])
    expect(view.hits.map((h) => h.id)).toEqual(['b'])
  })

  it('does not load every document up front', async () => {
    run.mockResolvedValueOnce({ hits: [], nearest: null })
    const c = client()
    await searchWithPlugins(c, {
      workspaceId: 'w',
      actorUserId: 'u',
      query: 'x',
    })
    expect(
      c.list.mock.calls.filter(
        (call) => !String(call[1]).includes('object_id=in.'),
      ),
    ).toHaveLength(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('leaves an ordinary provider as it was: every document, one call', async () => {
    provider.value.declaration.indexed = false
    run.mockResolvedValueOnce({ hits: [], nearest: null })
    await searchWithPlugins(client(), {
      workspaceId: 'w',
      actorUserId: 'u',
      query: 'x',
    })

    const call = run.mock.calls[0][0] as {
      documents: unknown[]
      stage?: string
    }

    expect(call.documents).toHaveLength(3)
    expect(call.stage).toBeUndefined()
  })
})
