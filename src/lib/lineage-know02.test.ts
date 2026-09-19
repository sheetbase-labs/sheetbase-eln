/**
 * KNOW-02 — per-object lineage unit tests.
 *
 * Covers the seeded BFS scope/depth bound, the revisionId plumbing for
 * submitted/frozen evidence nodes, the evidence-vs-live destination mapping,
 * the `?seed=` param parser, and the PostgREST `in.()` filter syntax used by
 * the seeded fetch path. Pure functions plus a capturing fake client — no
 * network.
 */
import { describe, expect, it } from 'vitest'

import {
  buildLineageGraph,
  fetchLineageDecisions,
  fetchLineageEvents,
  fetchLineageGraph,
  fetchLineageLinks,
  fetchLineageReviews,
  fetchLineageSignatures,
  LINEAGE_MINI_DEPTH,
  lineageNodeDestination,
  parseLineageSeedParam,
} from './lineage-data'
import type { DataClient } from './data-client'
import { sanitizeQuery } from './postgrest-path'
import type {
  ChangeEventWire,
  LineageNode,
  RecordLinkWire,
  RecordWire,
  ReviewDecisionWire,
  ReviewSubmissionWire,
  SignatureWire,
} from './lineage-data'

function makeRecord(
  id: string,
  kind: string,
  identifier: string,
  overrides: Partial<RecordWire> = {},
): RecordWire {
  return {
    id,
    workspace_id: 'ws-1',
    project_id: 'proj-1',
    kind,
    identifier,
    title: identifier,
    status: 'draft',
    properties: {},
    tags: [],
    structure_version: 1,
    metadata_version: 1,
    created_at: '2025-07-14T09:12:00Z',
    updated_at: '2025-07-14T09:12:00Z',
    archived_at: null,
    deleted_at: null,
    created_by_user_id: 'user-1',
    updated_by_user_id: null,
    ...overrides,
  }
}

function makeLink(
  id: string,
  sourceId: string,
  targetId: string | null,
  targetIdentifier: string,
): RecordLinkWire {
  return {
    id,
    source_record_id: sourceId,
    target_record_id: targetId,
    target_kind: 'experiment',
    target_identifier: targetIdentifier,
    link_type: 'general',
    link_metadata: {},
    created_at: '2025-07-14T09:12:00Z',
    created_by_user_id: 'user-1',
  }
}

function makeReview(
  id: string,
  recordId: string,
  revisionId: string,
): ReviewSubmissionWire {
  return {
    id,
    workspace_id: 'ws-1',
    record_id: recordId,
    revision_id: revisionId,
    state: 'submitted',
    workflow_definition_key: 'default-scientific-review',
    workflow_definition_version: 1,
    assigned_reviewer_user_ids: [],
    submitted_by_user_id: 'user-1',
    submitted_at: '2025-07-15T09:12:00Z',
    created_at: '2025-07-15T09:12:00Z',
    updated_at: '2025-07-15T09:12:00Z',
  }
}

function makeNode(overrides: Partial<LineageNode> = {}): LineageNode {
  return {
    id: 'node-1',
    recordId: 'rec-1',
    revisionId: null,
    kind: 'experiment',
    entityType: 'experiment',
    identifier: 'EXP-1',
    title: 'Experiment',
    status: 'draft',
    depth: 0,
    direction: 'seed',
    accessible: true,
    createdAt: '2025-07-14T09:12:00Z',
    updatedAt: '2025-07-14T09:12:00Z',
    createdByUserId: 'user-1',
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

// A → B → C → D chain for depth assertions.
const chainRecords = [
  makeRecord('a', 'sample', 'SMP-A'),
  makeRecord('b', 'experiment', 'EXP-B'),
  makeRecord('c', 'dataset', 'DS-C'),
  makeRecord('d', 'experiment', 'EXP-D'),
]
const chainLinks = [
  makeLink('l-ab', 'a', 'b', 'EXP-B'),
  makeLink('l-bc', 'b', 'c', 'DS-C'),
  makeLink('l-cd', 'c', 'd', 'EXP-D'),
]
const NONE_REVIEWS: ReviewSubmissionWire[] = []
const NONE_DECISIONS: ReviewDecisionWire[] = []
const NONE_SIGNATURES: SignatureWire[] = []
const NONE_EVENTS: ChangeEventWire[] = []

describe('buildLineageGraph seeded scope', () => {
  it('scopes a seeded traversal to depth 1 in both directions', () => {
    const graph = buildLineageGraph(
      chainRecords,
      chainLinks,
      NONE_REVIEWS,
      NONE_DECISIONS,
      NONE_SIGNATURES,
      NONE_EVENTS,
      'b',
      1,
    )
    const ids = new Set(graph.nodes.map((n) => n.id))
    expect(ids.has('a')).toBe(true)
    expect(ids.has('b')).toBe(true)
    expect(ids.has('c')).toBe(true)
    expect(ids.has('d')).toBe(false)
  })

  it('bounds the per-object miniature at LINEAGE_MINI_DEPTH', () => {
    expect(LINEAGE_MINI_DEPTH).toBe(2)
    const graph = buildLineageGraph(
      chainRecords,
      chainLinks,
      NONE_REVIEWS,
      NONE_DECISIONS,
      NONE_SIGNATURES,
      NONE_EVENTS,
      'a',
      LINEAGE_MINI_DEPTH,
    )
    const ids = new Set(graph.nodes.map((n) => n.id))
    expect(ids.has('a')).toBe(true)
    expect(ids.has('b')).toBe(true)
    expect(ids.has('c')).toBe(true)
    // Depth 3 from the seed stays out of the miniature.
    expect(ids.has('d')).toBe(false)
  })

  it('keeps the unseeded explorer traversal complete', () => {
    const graph = buildLineageGraph(
      chainRecords,
      chainLinks,
      NONE_REVIEWS,
      NONE_DECISIONS,
      NONE_SIGNATURES,
      NONE_EVENTS,
      null,
      4,
    )
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(
      new Set(['a', 'b', 'c', 'd']),
    )
  })
})

describe('buildLineageGraph evidence plumbing', () => {
  it('carries the revision id onto review nodes', () => {
    const graph = buildLineageGraph(
      chainRecords,
      chainLinks,
      [makeReview('sub-1', 'b', 'rev-9')],
      NONE_DECISIONS,
      NONE_SIGNATURES,
      NONE_EVENTS,
      'b',
      1,
    )
    const review = graph.nodes.find((n) => n.id === 'review:sub-1')
    expect(review?.revisionId).toBe('rev-9')
    expect(review?.recordId).toBe('b')
  })
})

describe('lineageNodeDestination', () => {
  it('links live record nodes to their canonical surface', () => {
    expect(lineageNodeDestination(makeNode())).toBe('/records/rec-1')
    expect(
      lineageNodeDestination(
        makeNode({ kind: 'sample', entityType: 'sample', recordId: 's-1' }),
      ),
    ).toBe('/samples?selected=s-1')
  })

  it('links submitted/frozen evidence nodes to the review workspace', () => {
    expect(
      lineageNodeDestination(
        makeNode({
          id: 'review:sub-1',
          kind: 'review',
          entityType: 'review',
          revisionId: 'rev-9',
        }),
      ),
    ).toBe('/reviews/rev-9')
    expect(
      lineageNodeDestination(
        makeNode({
          id: 'decision:dec-1',
          kind: 'decision',
          entityType: 'approval',
          revisionId: 'rev-9',
        }),
      ),
    ).toBe('/reviews/rev-9')
    expect(
      lineageNodeDestination(
        makeNode({
          id: 'signature:sig-1',
          kind: 'signature',
          entityType: 'signature',
          revisionId: 'rev-9',
        }),
      ),
    ).toBe('/reviews/rev-9')
  })

  it('falls back to the live record when an evidence node has no revision', () => {
    expect(
      lineageNodeDestination(
        makeNode({
          id: 'review:sub-1',
          kind: 'review',
          entityType: 'review',
          revisionId: null,
        }),
      ),
    ).toBe('/records/rec-1')
  })

  it('returns null for restricted and missing nodes', () => {
    expect(
      lineageNodeDestination(
        makeNode({ accessible: false, status: 'restricted' }),
      ),
    ).toBeNull()
    expect(
      lineageNodeDestination(
        makeNode({
          id: 'missing:GONE-1',
          recordId: null,
          accessible: false,
          status: 'missing',
        }),
      ),
    ).toBeNull()
  })
})

describe('parseLineageSeedParam', () => {
  it('accepts a stable id from the object form', () => {
    expect(parseLineageSeedParam({ seed: 'rec-1' })).toBe('rec-1')
  })

  it('accepts a stable id from a raw query string', () => {
    expect(parseLineageSeedParam('?seed=rec-1')).toBe('rec-1')
  })

  it('rejects absent, empty and non-string seeds', () => {
    expect(parseLineageSeedParam({})).toBeNull()
    expect(parseLineageSeedParam({ seed: '' })).toBeNull()
    expect(parseLineageSeedParam({ seed: '   ' })).toBeNull()
    expect(parseLineageSeedParam({ seed: 123 })).toBeNull()
    expect(parseLineageSeedParam(null)).toBeNull()
    expect(parseLineageSeedParam('?seed=')).toBeNull()
  })

  it('rejects paths and URLs so a crafted seed cannot escape the route', () => {
    expect(parseLineageSeedParam({ seed: '/records/evil' })).toBeNull()
    expect(parseLineageSeedParam({ seed: 'a b' })).toBeNull()
    expect(parseLineageSeedParam({ seed: 'x?y=1' })).toBeNull()
    expect(parseLineageSeedParam({ seed: 'x#frag' })).toBeNull()
  })
})

function capturingClient(queries: string[]): DataClient {
  const list = async <T>(resource: string, query = ''): Promise<T[]> => {
    queries.push(`${resource}${query}`)
    return [] as T[]
  }
  return {
    list,
    count: async () => 0,
    rpc: async <T>(): Promise<T> => {
      throw new Error('no rpc in filter-syntax tests')
    },
    insert: async <T>(): Promise<T> => {
      throw new Error('no insert in filter-syntax tests')
    },
    patch: async () => [],
    remove: async () => [],
  }
}

describe('seeded fetch filter syntax', () => {
  const SEED = '00000000-0000-4000-8000-000000000121'

  it('issues bare-UUID `in.()` lists in every seeded fetcher', async () => {
    const queries: string[] = []
    const client = capturingClient(queries)
    await fetchLineageLinks(client, [SEED])
    await fetchLineageReviews(client, [SEED])
    await fetchLineageDecisions(client, [SEED])
    await fetchLineageSignatures(client, [SEED])
    await fetchLineageEvents(client, [SEED])
    expect(queries).toHaveLength(5)
    for (const q of queries) {
      expect(q).toContain(`in.(${SEED})`)
      expect(q).not.toContain('eq.')
    }
  })

  it('expands the seeded record set with a bare-UUID `in.()` list', async () => {
    const queries: string[] = []
    const client = capturingClient(queries)
    const seed = makeRecord(SEED, 'experiment', 'EXP-2025-0001')
    const other = '00000000-0000-4000-8000-000000000122'
    const link = makeLink('link-1', SEED, other, 'SMP-2025-0002')
    const routes: Array<{ prefix: string; rows: unknown[] }> = [
      { prefix: 'records?id=eq.', rows: [seed] },
      { prefix: 'record_links', rows: [link] },
      {
        prefix: 'records?id=in.',
        rows: [makeRecord(other, 'sample', 'SMP-2025-0002')],
      },
    ]
    const routed: DataClient = {
      ...client,
      list: <T>(resource: string, query = ''): Promise<T[]> => {
        queries.push(`${resource}${query}`)
        const route = routes.find((r) =>
          `${resource}${query}`.startsWith(r.prefix),
        )
        return Promise.resolve((route ? route.rows : []) as T[])
      },
    }
    const graph = await fetchLineageGraph(routed, SEED, 2)
    const expansion = queries.find((q) => q.startsWith('records?id=in.'))
    expect(expansion).toBe(`records?id=in.(${other})`)
    expect(graph.nodes.some((n) => n.recordId === other)).toBe(true)
  })
})

describe('chunked id-list fetchers (proxy value cap)', () => {
  const uuid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

  /** Every query a fetcher emits must pass the real proxy validator. */
  function expectProxySafe(queries: string[]) {
    for (const q of queries) {
      const search = q.slice(q.indexOf('?'))
      expect(() => sanitizeQuery(search), q).not.toThrow()
    }
  }

  it('chunks fetchLineageLinks so a workspace-sized id set stays under the cap', async () => {
    // 62 records is the observed failing case: one or() value ≈ 2.3 KB.
    const ids = Array.from({ length: 62 }, (_, i) => uuid(i))
    const queries: string[] = []
    await fetchLineageLinks(capturingClient(queries), ids)
    expect(queries.length).toBeGreaterThan(1)
    expectProxySafe(queries)
    for (const q of queries) {
      expect(q).toContain('or=(source_record_id.in.(')
      const or = new URLSearchParams(q.slice(q.indexOf('?'))).get('or')
      expect(or).not.toBeNull()
      expect(or!.length).toBeLessThanOrEqual(500)
    }
  })

  it('dedupes links that match both ends of different chunks', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => uuid(i))
    // A link spanning two chunks: source in chunk 1, target in chunk 2.
    const link = makeLink('link-span', uuid(0), uuid(7), 'EXP-7')
    const queries: string[] = []
    const client: DataClient = {
      ...capturingClient(queries),
      list: <T>(resource: string, query = ''): Promise<T[]> => {
        queries.push(`${resource}${query}`)
        const or = new URLSearchParams(query).get('or') ?? ''
        return Promise.resolve(
          (or.includes(uuid(0)) || or.includes(uuid(7)) ? [link] : []) as T[],
        )
      },
    }
    const links = await fetchLineageLinks(client, ids)
    expect(queries.length).toBeGreaterThan(1)
    expect(links.map((l) => l.id)).toEqual(['link-span'])
  })

  it('chunks the record-scoped fetchers with single-column in.() lists', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => uuid(i))
    const queries: string[] = []
    const client = capturingClient(queries)
    await fetchLineageReviews(client, ids)
    await fetchLineageDecisions(client, ids)
    await fetchLineageSignatures(client, ids)
    await fetchLineageEvents(client, ids)
    // 25 ids ÷ 10 per chunk = 3 requests per fetcher.
    expect(queries).toHaveLength(12)
    expectProxySafe(queries)
    for (const q of queries) {
      expect(q).toContain('record_id=in.(')
    }
  })

  it('keeps merged event pages newest-first across chunks', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => uuid(i))
    const event = (id: string, at: string): ChangeEventWire => ({
      id,
      workspace_id: 'ws-1',
      sequence: '1',
      entity_type: 'record',
      entity_uuid: id,
      operation: 'update',
      record_id: id,
      project_id: null,
      actor_user_id: null,
      actor_credential_id: null,
      client_id: null,
      payload: {},
      created_at: at,
    })
    const queries: string[] = []
    const client: DataClient = {
      ...capturingClient(queries),
      list: <T>(resource: string, query = ''): Promise<T[]> => {
        queries.push(`${resource}${query}`)
        const list = new URLSearchParams(query).get('record_id') ?? ''
        // Older event sits in the first chunk's page, newer in the second.
        if (list.includes(uuid(0))) {
          return Promise.resolve([
            event('e-old', '2025-07-01T00:00:00Z'),
          ] as T[])
        }
        return Promise.resolve([event('e-new', '2025-07-10T00:00:00Z')] as T[])
      },
    }
    const events = await fetchLineageEvents(client, ids)
    expect(events.map((e) => e.id)).toEqual(['e-new', 'e-old'])
  })
})
