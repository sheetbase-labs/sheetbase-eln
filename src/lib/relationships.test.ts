/**
 * KNOW-01 — relationships aggregation tests.
 *
 * Incoming/outgoing reads, typed labels, lifecycle mapping and
 * invisible-target handling against a fake DataClient (no network, no DB).
 */
import { describe, expect, it } from 'vitest'

import type { DataClient } from './data-client'
import type { RecordWire, RecordLinkWire } from './notebook-data'
import {
  buildRelationshipRows,
  fetchIncomingLinksByIdentifier,
  fetchIncomingLinksForRecord,
  fetchRelationshipEndpoints,
  fetchRelationshipLinks,
  lifecycleToRowState,
  relationshipCounterpartyIds,
} from './relationships'
import type { RelationshipEndpoint } from './relationships'

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

function recordWire(
  id: string,
  overrides: Partial<RecordWire> = {},
): RecordWire {
  return {
    id,
    workspace_id: 'ws-1',
    project_id: 'proj-1',
    folder_id: null,
    kind: 'experiment',
    identifier: id.toUpperCase(),
    title: `Title ${id}`,
    status: 'in_progress',
    tags: [],
    structure_version: 1,
    metadata_version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
    archived_at: null,
    deleted_at: null,
    created_by_user_id: 'user-1',
    updated_by_user_id: null,
    properties: {},
    locked_at: null,
    locked_by_revision_id: null,
    ...overrides,
  }
}

function linkWire(
  id: string,
  overrides: Partial<RecordLinkWire> = {},
): RecordLinkWire {
  return {
    id,
    source_record_id: 'rec-1',
    target_record_id: 'rec-2',
    target_kind: 'sample',
    target_identifier: 'SMP-2',
    link_type: 'sample',
    created_at: '2026-08-03T00:00:00Z',
    ...overrides,
  }
}

function endpoint(
  id: string,
  overrides: Partial<RelationshipEndpoint> = {},
): RelationshipEndpoint {
  return {
    id,
    kind: 'experiment',
    identifier: id.toUpperCase(),
    title: `Title ${id}`,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

/** Fake DataClient routing on (resource, query-substring) matchers. */
function fakeClient(
  routes: {
    match: (resource: string, query: string) => boolean
    rows: unknown[]
  }[],
  calls: string[] = [],
): DataClient {
  const list = async <T>(resource: string, query = ''): Promise<T[]> => {
    calls.push(`${resource} ${query}`)
    const route = routes.find((r) => r.match(resource, query))
    if (!route) throw new Error(`unexpected query: ${resource} ${query}`)
    return route.rows as T[]
  }
  return {
    list,
    count: async () => 0,
    rpc: async <T>(): Promise<T> => {
      throw new Error('no rpc in relationships tests')
    },
    insert: async <T>(): Promise<T> => {
      throw new Error('no insert in relationships tests')
    },
    patch: async () => [],
    remove: async () => [],
  }
}

const on = (
  resource: string,
  part: string,
  rows: unknown[],
): { match: (r: string, q: string) => boolean; rows: unknown[] } => ({
  match: (r, q) => r === resource && q.includes(part),
  rows,
})

// ---------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------

describe('fetchIncomingLinksForRecord', () => {
  it('queries by target_record_id and maps through the shared toLink', async () => {
    const client = fakeClient([
      on('record_links', 'target_record_id=eq.rec-1', [
        linkWire('in-1', {
          source_record_id: 'rec-9',
          target_record_id: 'rec-1',
          link_type: 'general',
        }),
      ]),
    ])
    const links = await fetchIncomingLinksForRecord(client, 'rec-1')
    expect(links).toEqual([
      {
        id: 'in-1',
        sourceRecordId: 'rec-9',
        targetRecordId: 'rec-1',
        targetKind: 'sample',
        targetIdentifier: 'SMP-2',
        linkType: 'general',
        createdAt: '2026-08-03T00:00:00Z',
        createdByUserId: null,
      },
    ])
  })
})

describe('fetchIncomingLinksByIdentifier', () => {
  it('keeps only identifier-addressed rows with no target id', async () => {
    const client = fakeClient([
      on('record_links', 'target_identifier=eq.EXP-1', [
        linkWire('by-id-1', {
          source_record_id: 'rec-7',
          target_record_id: null,
          target_identifier: 'EXP-1',
          link_type: 'material',
        }),
        linkWire('by-id-2', {
          source_record_id: 'rec-8',
          target_record_id: 'rec-other',
          target_identifier: 'EXP-1',
          link_type: 'material',
        }),
      ]),
    ])
    const links = await fetchIncomingLinksByIdentifier(client, 'EXP-1')
    expect(links.map((l) => l.id)).toEqual(['by-id-1'])
  })
})

describe('fetchRelationshipLinks', () => {
  function routes() {
    return [
      on('record_links', 'source_record_id=eq.rec-1', [
        linkWire('out-1', { link_type: 'sample' }),
        linkWire('self', {
          source_record_id: 'rec-1',
          target_record_id: 'rec-1',
          link_type: 'general',
        }),
      ]),
      on('record_links', 'target_record_id=eq.rec-1', [
        linkWire('in-1', {
          source_record_id: 'rec-9',
          target_record_id: 'rec-1',
          link_type: 'general',
        }),
        // Same link id as an outgoing row: deduped to the outgoing side.
        linkWire('out-1', {
          source_record_id: 'rec-1',
          target_record_id: 'rec-2',
          link_type: 'sample',
        }),
        // Self-loop: already counted as outgoing, dropped here.
        linkWire('self', {
          source_record_id: 'rec-1',
          target_record_id: 'rec-1',
          link_type: 'general',
        }),
      ]),
      on('records', 'id=eq.rec-1', [
        recordWire('rec-1', { identifier: 'EXP-1' }),
      ]),
      on('record_links', 'target_identifier=eq.EXP-1', [
        linkWire('in-ident', {
          source_record_id: 'rec-7',
          target_record_id: null,
          target_identifier: 'EXP-1',
          link_type: 'material',
        }),
      ]),
    ]
  }

  it('fans out outgoing, incoming and the by-identifier fallback with dedupe', async () => {
    const client = fakeClient(routes())
    const { outgoing, incoming } = await fetchRelationshipLinks(client, 'rec-1')
    expect(outgoing.map((l) => l.id)).toEqual(['out-1', 'self'])
    expect(incoming.map((l) => l.id)).toEqual(['in-1', 'in-ident'])
  })

  it('skips the by-identifier fallback when the seed is unreadable', async () => {
    const calls: string[] = []
    const client = fakeClient(
      [
        on('record_links', 'source_record_id=eq.rec-1', []),
        on('record_links', 'target_record_id=eq.rec-1', []),
        on('records', 'id=eq.rec-1', []),
        on('record_links', 'target_identifier=eq.', []),
      ],
      calls,
    )
    const { outgoing, incoming } = await fetchRelationshipLinks(client, 'rec-1')
    expect(outgoing).toEqual([])
    expect(incoming).toEqual([])
    expect(calls.some((c) => c.includes('target_identifier=eq.'))).toBe(false)
  })

  it('never throws when every source fails', async () => {
    const client = fakeClient([])
    await expect(fetchRelationshipLinks(client, 'rec-1')).resolves.toEqual({
      outgoing: [],
      incoming: [],
    })
  })
})

describe('fetchRelationshipEndpoints', () => {
  it('keeps archived and deleted rows with lifecycle fields', async () => {
    const client = fakeClient([
      on('records', 'id=in.', [
        recordWire('rec-2'),
        recordWire('rec-3', { archived_at: '2026-08-04T00:00:00Z' }),
        recordWire('rec-4', { deleted_at: '2026-08-05T00:00:00Z' }),
      ]),
    ])
    const byId = await fetchRelationshipEndpoints(client, [
      'rec-2',
      'rec-3',
      'rec-4',
      'rec-missing',
    ])
    expect(byId.get('rec-2')).toMatchObject({
      archivedAt: null,
      deletedAt: null,
    })
    expect(byId.get('rec-3')).toMatchObject({
      archivedAt: '2026-08-04T00:00:00Z',
    })
    expect(byId.get('rec-4')).toMatchObject({
      deletedAt: '2026-08-05T00:00:00Z',
    })
    expect(byId.has('rec-missing')).toBe(false)
  })

  it('returns an empty map without querying when there are no ids', async () => {
    const calls: string[] = []
    const client = fakeClient([], calls)
    await expect(fetchRelationshipEndpoints(client, [])).resolves.toEqual(
      new Map(),
    )
    expect(calls).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Aggregation.
// ---------------------------------------------------------------------------

describe('lifecycleToRowState', () => {
  it('maps endpoints and absence to the honest row states', () => {
    expect(lifecycleToRowState(endpoint('a'), true)).toBe('available')
    expect(
      lifecycleToRowState(
        endpoint('a', { archivedAt: '2026-01-01T00:00:00Z' }),
        true,
      ),
    ).toBe('archived')
    expect(
      lifecycleToRowState(
        endpoint('a', { deletedAt: '2026-01-01T00:00:00Z' }),
        true,
      ),
    ).toBe('deleted')
    expect(lifecycleToRowState(null, true)).toBe('permission-restricted')
    expect(lifecycleToRowState(null, false)).toBe('missing')
    // Deleted outranks archived when both are set.
    expect(
      lifecycleToRowState(
        endpoint('a', {
          archivedAt: '2026-01-01T00:00:00Z',
          deletedAt: '2026-01-02T00:00:00Z',
        }),
        true,
      ),
    ).toBe('deleted')
  })
})

describe('buildRelationshipRows', () => {
  const endpoints = new Map<string, RelationshipEndpoint>([
    [
      'rec-2',
      endpoint('rec-2', {
        kind: 'sample',
        identifier: 'SMP-2',
        title: 'Cell line',
      }),
    ],
    [
      'rec-3',
      endpoint('rec-3', {
        identifier: 'EXP-3',
        title: 'Old run',
        archivedAt: '2026-08-04T00:00:00Z',
      }),
    ],
    [
      'rec-4',
      endpoint('rec-4', {
        identifier: 'EXP-4',
        title: 'Bad run',
        deletedAt: '2026-08-05T00:00:00Z',
      }),
    ],
    ['rec-t', endpoint('rec-t', { identifier: 'PRT-1', title: 'Assay' })],
  ])

  it('labels rows with the typed relationship vocabulary', () => {
    const { outgoing } = buildRelationshipRows(
      'rec-1',
      {
        outgoing: [
          {
            id: 'out-t',
            createdAt: '2026-08-03T00:00:00Z',
            createdByUserId: null,
            sourceRecordId: 'rec-1',
            targetRecordId: 'rec-t',
            targetKind: 'protocol_template',
            targetIdentifier: 'PRT-1',
            linkType: 'template',
          },
        ],
        incoming: [],
      },
      endpoints,
    )
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0]).toMatchObject({
      direction: 'outgoing',
      linkType: 'template',
      label: 'created from',
      state: 'available',
    })
  })

  it('prefers model-declared type names over the canonical vocabulary', () => {
    const links = {
      outgoing: [
        {
          id: 'out-t',
          createdAt: '2026-08-03T00:00:00Z',
          createdByUserId: null,
          sourceRecordId: 'rec-1',
          targetRecordId: 'rec-t',
          targetKind: 'protocol_template',
          targetIdentifier: 'PRT-1',
          linkType: 'template',
        },
      ],
      incoming: [],
    }
    const declared = buildRelationshipRows('rec-1', links, endpoints, {
      template: 'instantiated from',
    })
    expect(declared.outgoing[0]).toMatchObject({ label: 'instantiated from' })
    const canonical = buildRelationshipRows('rec-1', links, endpoints)
    expect(canonical.outgoing[0]).toMatchObject({ label: 'created from' })
  })

  it('gates destinations to available rows via stable-ID paths', () => {
    const { outgoing, incoming } = buildRelationshipRows(
      'rec-1',
      {
        outgoing: [
          {
            id: 'out-1',
            createdAt: '2026-08-03T00:00:00Z',
            createdByUserId: null,
            sourceRecordId: 'rec-1',
            targetRecordId: 'rec-2',
            targetKind: 'sample',
            targetIdentifier: 'SMP-2',
            linkType: 'sample',
          },
          {
            id: 'out-arch',
            createdAt: '2026-08-03T00:00:00Z',
            createdByUserId: null,
            sourceRecordId: 'rec-1',
            targetRecordId: 'rec-3',
            targetKind: 'experiment',
            targetIdentifier: 'EXP-3',
            linkType: 'general',
          },
          {
            id: 'out-del',
            createdAt: '2026-08-03T00:00:00Z',
            createdByUserId: null,
            sourceRecordId: 'rec-1',
            targetRecordId: 'rec-4',
            targetKind: 'experiment',
            targetIdentifier: 'EXP-4',
            linkType: 'general',
          },
          {
            id: 'out-name',
            createdAt: '2026-08-03T00:00:00Z',
            createdByUserId: null,
            sourceRecordId: 'rec-1',
            targetRecordId: null,
            targetKind: 'dataset',
            targetIdentifier: 'Assay data',
            linkType: 'dataset',
          },
        ],
        incoming: [
          {
            id: 'in-restricted',
            createdAt: '2026-08-03T00:00:00Z',
            createdByUserId: null,
            sourceRecordId: 'rec-hidden',
            targetRecordId: 'rec-1',
            targetKind: 'experiment',
            targetIdentifier: 'EXP-1',
            linkType: 'general',
          },
        ],
      },
      endpoints,
    )
    const byId = new Map(outgoing.map((r) => [r.linkId, r]))
    // Sample counterparty resolves through the samples surface.
    expect(byId.get('out-1')).toMatchObject({
      title: 'Cell line',
      identifier: 'SMP-2',
      state: 'available',
      destination: '/samples/rec-2',
    })
    expect(byId.get('out-arch')).toMatchObject({
      state: 'archived',
      destination: null,
      title: 'Old run',
      identifier: 'EXP-3',
    })
    expect(byId.get('out-del')).toMatchObject({
      state: 'deleted',
      destination: null,
    })
    expect(byId.get('out-name')).toMatchObject({
      state: 'missing',
      title: 'Assay data',
      destination: null,
    })
    expect(incoming).toHaveLength(1)
    // Invisible counterparty: generic title, no identifier, no destination.
    expect(incoming[0]).toMatchObject({
      direction: 'incoming',
      otherRecordId: 'rec-hidden',
      state: 'permission-restricted',
      title: 'Restricted record',
      identifier: null,
      destination: null,
    })
  })

  it('drops self-loops from both directions', () => {
    const loop = {
      id: 'self',
      createdAt: '2026-08-03T00:00:00Z',
      createdByUserId: null,
      sourceRecordId: 'rec-1',
      targetRecordId: 'rec-1',
      targetKind: 'experiment',
      targetIdentifier: 'EXP-1',
      linkType: 'general',
    }
    const { outgoing, incoming } = buildRelationshipRows(
      'rec-1',
      { outgoing: [loop], incoming: [{ ...loop, id: 'self-in' }] },
      endpoints,
    )
    expect(outgoing).toEqual([])
    expect(incoming).toEqual([])
  })
})

describe('relationshipCounterpartyIds', () => {
  it('collects unique counterparty ids excluding the seed', () => {
    expect(
      relationshipCounterpartyIds('rec-1', {
        outgoing: [
          {
            id: 'o1',
            createdAt: '2026-08-03T00:00:00Z',
            createdByUserId: null,
            sourceRecordId: 'rec-1',
            targetRecordId: 'rec-2',
            targetKind: 'sample',
            targetIdentifier: 'SMP-2',
            linkType: 'sample',
          },
          {
            id: 'o2',
            createdAt: '2026-08-03T00:00:00Z',
            createdByUserId: null,
            sourceRecordId: 'rec-1',
            targetRecordId: null,
            targetKind: 'dataset',
            targetIdentifier: 'D',
            linkType: 'dataset',
          },
        ],
        incoming: [
          {
            id: 'i1',
            createdAt: '2026-08-03T00:00:00Z',
            createdByUserId: null,
            sourceRecordId: 'rec-2',
            targetRecordId: 'rec-1',
            targetKind: 'experiment',
            targetIdentifier: 'EXP-1',
            linkType: 'general',
          },
          {
            id: 'i2',
            createdAt: '2026-08-03T00:00:00Z',
            createdByUserId: null,
            sourceRecordId: 'rec-9',
            targetRecordId: 'rec-1',
            targetKind: 'experiment',
            targetIdentifier: 'EXP-1',
            linkType: 'general',
          },
        ],
      }),
    ).toEqual(['rec-2', 'rec-9'])
  })
})

describe('buildRelationshipRows duplicates and metadata', () => {
  const endpoints = new Map<string, RelationshipEndpoint>([
    ['rec-2', endpoint('rec-2', { identifier: 'SMP-2', title: 'Cell line' })],
  ])

  function dupeLinks() {
    return {
      outgoing: [
        {
          id: 'dup-1',
          sourceRecordId: 'rec-1',
          targetRecordId: 'rec-2',
          targetKind: 'sample',
          targetIdentifier: 'SMP-2',
          linkType: 'sample',
          createdAt: '2026-08-03T00:00:00Z',
          createdByUserId: 'user-1',
        },
        {
          id: 'dup-2',
          sourceRecordId: 'rec-1',
          targetRecordId: 'rec-2',
          targetKind: 'sample',
          targetIdentifier: 'SMP-2',
          linkType: 'sample',
          createdAt: '2026-08-04T00:00:00Z',
          createdByUserId: 'user-1',
        },
        // Same counterparty, different link type: a distinct edge.
        {
          id: 'other-type',
          sourceRecordId: 'rec-1',
          targetRecordId: 'rec-2',
          targetKind: 'sample',
          targetIdentifier: 'SMP-2',
          linkType: 'general',
          createdAt: '2026-08-05T00:00:00Z',
          createdByUserId: null,
        },
      ],
      incoming: [],
    }
  }

  it('collapses exact-duplicate edges into one row with a count', () => {
    const { outgoing } = buildRelationshipRows('rec-1', dupeLinks(), endpoints)
    expect(outgoing).toHaveLength(2)
    // Oldest-first: the surviving row is the earliest edge.
    expect(outgoing[0]).toMatchObject({
      linkId: 'dup-1',
      duplicateCount: 2,
      createdAt: '2026-08-03T00:00:00Z',
      createdByUserId: 'user-1',
    })
    expect(outgoing[1]).toMatchObject({
      linkId: 'other-type',
      duplicateCount: 1,
    })
  })

  it('collapses identifier-only outgoing dupes on the stable identifier', () => {
    const links = {
      outgoing: [1, 2].map((n) => ({
        id: `ident-${n}`,
        sourceRecordId: 'rec-1',
        targetRecordId: null,
        targetKind: 'dataset',
        targetIdentifier: 'Assay data',
        linkType: 'dataset',
        createdAt: '2026-08-03T00:00:00Z',
        createdByUserId: null,
      })),
      incoming: [],
    }
    const { outgoing } = buildRelationshipRows('rec-1', links, endpoints)
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0]).toMatchObject({
      linkId: 'ident-1',
      duplicateCount: 2,
      state: 'missing',
    })
  })

  it('collapses incoming dupes per source and link type', () => {
    const links = {
      outgoing: [],
      incoming: [1, 2].map((n) => ({
        id: `in-${n}`,
        sourceRecordId: 'rec-9',
        targetRecordId: 'rec-1',
        targetKind: 'experiment',
        targetIdentifier: 'EXP-1',
        linkType: 'general',
        createdAt: '2026-08-03T00:00:00Z',
        createdByUserId: null,
      })),
    }
    const { incoming } = buildRelationshipRows('rec-1', links, endpoints)
    expect(incoming).toHaveLength(1)
    expect(incoming[0]).toMatchObject({
      linkId: 'in-1',
      direction: 'incoming',
      duplicateCount: 2,
    })
  })
})
