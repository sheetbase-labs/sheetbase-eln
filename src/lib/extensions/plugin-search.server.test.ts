/**
 * An indexed search provider is asked what to look up, the index finds the
 * records, and the provider is handed only those to check.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'

import { searchWithPlugins } from './plugin-search.server'

const run = vi.hoisted(() => vi.fn())

// A search provider is Python running in the isolated runner process, which a
// unit test cannot start: this call is the transport seam to that process.
// oxlint-disable-next-line anti-slop/no-module-mocking -- The provider itself runs in the isolated Python runner; substituting this one runtime call is how the suite sees what each provider stage is handed.
vi.mock('./data-runtime.server', () => ({ runExtensionSearch: run }))

/** The install the fake database answers with: one chemistry search provider. */
const install = {
  id: 'ext-1',
  workspace_id: 'w',
  key: 'chemistry',
  name: 'Chemistry',
  version: '1.0.0',
  source: 'https://extensions.example.com/chemistry.tgz',
  manifest: {
    id: 'acme.chemistry',
    name: 'Chemistry',
    version: '1.0.0',
    source: 'https://extensions.example.com/chemistry.tgz',
    capabilities: [],
    scopes: ['schema:read'],
    contributions: {
      'search-providers': [
        {
          id: 'structures',
          title: 'Structure search',
          description: 'Find records by their structure',
          types: ['record'],
          runner: { kind: 'python', entry: 'main:search' },
          indexed: true,
        },
      ],
    },
  },
  status: 'enabled',
  disabled_points: [],
  credential_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

/** What the runtime was asked for at one stage, as this suite inspects it. */
interface SearchCall {
  stage?: string
  documents: Array<{ id: string }>
}

/** The provider this install declares, as the manifest holds it. */
function provider() {
  return install.manifest.contributions['search-providers'][0]
}

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
  const list = vi.fn(async (table: string, query: string) => {
    if (table === 'extensions') return [install]

    return query.includes('object_id=in.')
      ? [row('a'), row('b')]
      : [row('a'), row('b'), row('c')]
  })

  const rpc = vi.fn(async () => [
    { record_id: 'a', entry_key: 'main', score: 0.9, snippet: null },
    { record_id: 'b', entry_key: 'main', score: 0.8, snippet: null },
  ])

  const fake = { list, rpc }

  // SAFETY: searchWithPlugins reads installs and documents through `list` and
  // ranks through `rpc`; no other data-client method is reached.
  return fake as typeof fake & DataClient
}

beforeEach(() => {
  run.mockReset()
  provider().indexed = true
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

    const second: SearchCall = run.mock.calls[1][0]

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
        ([table, query]) =>
          table === 'search_documents' &&
          !String(query).includes('object_id=in.'),
      ),
    ).toHaveLength(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('leaves an ordinary provider as it was: every document, one call', async () => {
    provider().indexed = false
    run.mockResolvedValueOnce({ hits: [], nearest: null })
    await searchWithPlugins(client(), {
      workspaceId: 'w',
      actorUserId: 'u',
      query: 'x',
    })

    const call: SearchCall = run.mock.calls[0][0]

    expect(call.documents).toHaveLength(3)
    expect(call.stage).toBeUndefined()
  })
})
