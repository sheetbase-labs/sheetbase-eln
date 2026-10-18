/**
 * FIND-03 — related-work aggregation tests.
 *
 * Pure ordering/dedupe/cap/reason coverage plus end-to-end aggregation
 * against a fake DataClient (no network, no DB).
 */
import { describe, expect, it } from 'vitest'

import type { DataClient } from './data-client'
import type { RecordWire } from './notebook-data'
import {
  assembleRelatedWork,
  fetchRelatedWork,
  incomingLinkReason,
  outgoingLinkReason,
  relatedDestination,
  relatedKindLabel,
  RELATED_WORK_LIMIT,
  searchResultToRelatedKind,
} from './related-work'
import type { RelatedWorkCandidate } from './related-work'

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

/** Fake DataClient routing on (resource, query-substring) matchers. */
function fakeClient(
  routes: {
    match: (resource: string, query: string) => boolean
    rows: unknown[]
  }[],
): DataClient {
  const list = async <T>(resource: string, query = ''): Promise<T[]> => {
    const route = routes.find((r) => r.match(resource, query))
    if (!route) throw new Error(`unexpected query: ${resource} ${query}`)
    return route.rows as T[]
  }
  return {
    list,
    count: async () => 0,
    rpc: async <T>(): Promise<T> => {
      throw new Error('no rpc in related-work tests')
    },
    insert: async <T>(): Promise<T> => {
      throw new Error('no insert in related-work tests')
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
// Reason vocabulary.
// ---------------------------------------------------------------------------

describe('link reasons', () => {
  it('labels outgoing links by relationship', () => {
    expect(outgoingLinkReason('general', 'EXP-2')).toBe('Linked to EXP-2')
    expect(outgoingLinkReason('template', 'T-1')).toBe(
      'Created from template T-1',
    )
    expect(outgoingLinkReason('dataset', 'D-1')).toBe(
      'Derived from dataset D-1',
    )
    expect(outgoingLinkReason('analysis', 'D-1')).toBe(
      'Derived from dataset D-1',
    )
    expect(outgoingLinkReason('sample', 'S-1')).toBe('Uses sample S-1')
    expect(outgoingLinkReason('material', 'R-1')).toBe('Uses material R-1')
    expect(outgoingLinkReason('protocol', 'P-1')).toBe('Uses protocol P-1')
    expect(outgoingLinkReason('file', 'F-1')).toBe('Has file F-1')
  })

  it('labels incoming links by usage', () => {
    expect(incomingLinkReason('general', 'EXP-9')).toBe('Linked by EXP-9')
    expect(incomingLinkReason('template', 'EXP-9')).toBe(
      'Used as template in EXP-9',
    )
    expect(incomingLinkReason('sample', 'EXP-9')).toBe(
      'Used as sample in EXP-9',
    )
    expect(incomingLinkReason('material', 'EXP-9')).toBe(
      'Used as material in EXP-9',
    )
    expect(incomingLinkReason('dataset', 'EXP-9')).toBe(
      'Used as dataset in EXP-9',
    )
    // Unknown link types stay honest instead of inventing a relationship.
    expect(incomingLinkReason('mystery', 'EXP-9')).toBe('Linked by EXP-9')
  })
})

describe('searchResultToRelatedKind', () => {
  it('maps result classes onto related kinds', () => {
    expect(searchResultToRelatedKind('record')).toBe('record')
    expect(searchResultToRelatedKind('file')).toBe('record')
    expect(searchResultToRelatedKind('dataset')).toBe('dataset')
    expect(searchResultToRelatedKind('sheet')).toBe('sheet')
    expect(searchResultToRelatedKind('template')).toBe('template')
    expect(searchResultToRelatedKind('comment')).toBeNull()
  })
})

describe('relatedDestination / relatedKindLabel', () => {
  it('resolves destinations exclusively through navigation helpers', () => {
    expect(relatedDestination('record', 'r-1', 'experiment')).toBe(
      '/records/r-1',
    )
    expect(relatedDestination('record', 's-1', 'sample')).toBe(
      '/samples/s-1',
    )
    expect(relatedDestination('dataset', 'd-1')).toBe('/datasets?dataset=d-1')
    expect(relatedDestination('sheet', 'sh-1')).toBe('/sheets/sh-1')
    expect(relatedDestination('template', 't-1')).toBe(
      '/templates?template=t-1',
    )
    expect(relatedDestination('project', 'p-1')).toBe('/projects/p-1')
  })

  it('labels kinds through the canonical record-kind map', () => {
    expect(relatedKindLabel('record', 'experiment')).toBe('Experiment')
    expect(relatedKindLabel('record', 'sample')).toBe('Sample')
    expect(relatedKindLabel('dataset')).toBe('Dataset')
    expect(relatedKindLabel('sheet')).toBe('Sheet')
    expect(relatedKindLabel('template')).toBe('Template')
    expect(relatedKindLabel('project')).toBe('Project')
  })
})

// ---------------------------------------------------------------------------
// Pure aggregation.
// ---------------------------------------------------------------------------

const candidate = (
  overrides: Partial<RelatedWorkCandidate> & { id: string },
): RelatedWorkCandidate => ({
  kind: 'record',
  label: `Title ${overrides.id}`,
  reason: 'Linked',
  rank: 0,
  ...overrides,
})

describe('assembleRelatedWork', () => {
  it('dedupes by kind+id keeping the strongest (lowest-rank) reason', () => {
    const items = assembleRelatedWork('record', 'seed', [
      candidate({ id: 'r-1', reason: 'Same project', rank: 2 }),
      candidate({ id: 'r-1', reason: 'Linked by EXP-9', rank: 0 }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]?.reason).toBe('Linked by EXP-9')
  })

  it('keeps the same id under different kinds as distinct items', () => {
    const items = assembleRelatedWork('record', 'seed', [
      candidate({ kind: 'record', id: 'x', label: 'Record X' }),
      candidate({ kind: 'dataset', id: 'x', label: 'Dataset X' }),
    ])
    expect(items.map((i) => i.kind)).toEqual(['dataset', 'record'])
  })

  it('drops the seed itself and unlabelled candidates', () => {
    const items = assembleRelatedWork('record', 'seed', [
      candidate({ id: 'seed', label: 'Seed' }),
      candidate({ id: 'r-1', label: '' }),
      candidate({ id: 'r-2', label: 'Kept' }),
    ])
    expect(items.map((i) => i.id)).toEqual(['r-2'])
  })

  it('orders deterministically by rank, kind, label, id', () => {
    const input = [
      candidate({ kind: 'sheet', id: 's-b', label: 'Beta', rank: 1 }),
      candidate({ kind: 'record', id: 'r-2', label: 'Same', rank: 0 }),
      candidate({ kind: 'record', id: 'r-1', label: 'Same', rank: 0 }),
      candidate({ kind: 'dataset', id: 'd-1', label: 'Alpha', rank: 1 }),
      candidate({ kind: 'record', id: 'r-3', label: 'Apex', rank: 0 }),
    ]
    const forward = assembleRelatedWork('record', 'seed', input).map(
      (i) => i.id,
    )
    const reversed = assembleRelatedWork(
      'record',
      'seed',
      [...input].reverse(),
    ).map((i) => i.id)
    expect(forward).toEqual(reversed)
    expect(forward).toEqual(['r-3', 'r-1', 'r-2', 'd-1', 's-b'])
  })

  it(`caps the list at ${RELATED_WORK_LIMIT}`, () => {
    const input = Array.from({ length: RELATED_WORK_LIMIT + 5 }, (_, i) =>
      candidate({ id: `r-${i}`, label: `Title ${i}` }),
    )
    expect(assembleRelatedWork('record', 'seed', input)).toHaveLength(
      RELATED_WORK_LIMIT,
    )
  })
})

// ---------------------------------------------------------------------------
// Live aggregation against a fake client.
// ---------------------------------------------------------------------------

function recordSeedClient(): DataClient {
  const seed = recordWire('rec-1', {
    kind: 'experiment',
    identifier: 'EXP-1',
    title: 'Seed experiment',
  })
  const outgoing = [
    {
      id: 'link-out-1',
      source_record_id: 'rec-1',
      target_record_id: 'rec-2',
      target_kind: 'experiment',
      target_identifier: 'EXP-2',
      link_type: 'general',
      created_at: '2026-08-03T00:00:00Z',
    },
    {
      id: 'link-out-2',
      source_record_id: 'rec-1',
      target_record_id: null,
      target_kind: 'dataset',
      target_identifier: 'Assay data',
      link_type: 'dataset',
      created_at: '2026-08-04T00:00:00Z',
    },
  ]
  const incoming = [
    {
      id: 'link-in-1',
      source_record_id: 'rec-3',
      target_kind: 'experiment',
      target_identifier: 'EXP-1',
      link_type: 'template',
      created_at: '2026-08-05T00:00:00Z',
    },
    // Invisible under RLS: absent from the label batch, must be dropped.
    {
      id: 'link-in-2',
      source_record_id: 'rec-hidden',
      target_kind: 'experiment',
      target_identifier: 'EXP-H',
      link_type: 'general',
      created_at: '2026-08-06T00:00:00Z',
    },
    // Archived: resolvable but not openable, must be dropped.
    {
      id: 'link-in-3',
      source_record_id: 'rec-old',
      target_kind: 'experiment',
      target_identifier: 'EXP-O',
      link_type: 'general',
      created_at: '2026-08-07T00:00:00Z',
    },
  ]
  return fakeClient([
    on('records', 'id=eq.rec-1', [seed]),
    on('record_links', 'source_record_id=eq.rec-1', outgoing),
    on('record_links', 'target_record_id=eq.rec-1', incoming),
    // Bidirectional lineage read returns the union of both directions.
    on('record_links', 'or=(source_record_id', [...outgoing, ...incoming]),
    on('record_links', 'target_identifier=eq.EXP-1', []),
    on('sheet_instances', 'notebook_record_id=eq.rec-1', [
      {
        id: 'sheet-1',
        name: 'Dose response',
        lifecycle: 'active',
        notebook_record_id: 'rec-1',
        duplicated_from_instance_id: null,
        source_definition_version_id: null,
      },
    ]),
    on('records', 'project_id=eq.proj-1', [
      recordWire('rec-1', { identifier: 'EXP-1', title: 'Seed experiment' }),
      recordWire('rec-6', {
        kind: 'sample',
        identifier: 'SMP-6',
        title: 'Cohort sample',
      }),
    ]),
    // Label resolution batch: rec-hidden absent (RLS), rec-old archived.
    on('records', 'id=in.', [
      recordWire('rec-2', { identifier: 'EXP-2', title: 'Second run' }),
      recordWire('rec-3', { identifier: 'EXP-3', title: 'Templated run' }),
      recordWire('rec-old', {
        identifier: 'EXP-O',
        title: 'Old run',
        archived_at: '2026-08-08T00:00:00Z',
      }),
    ]),
    on('datasets', 'name=eq.Assay%20data', [
      { id: 'ds-1', name: 'Assay data', lifecycle: 'active' },
    ]),
  ])
}

describe('fetchRelatedWork for records', () => {
  it('aggregates outgoing, incoming, dataset, sheet and cohort sources', async () => {
    const items = await fetchRelatedWork('record', 'rec-1', recordSeedClient())
    const byId = new Map(items.map((i) => [i.id, i]))

    expect(byId.get('rec-2')?.reason).toBe('Linked to EXP-2')
    expect(byId.get('rec-3')?.reason).toBe('Used as template in EXP-3')
    expect(byId.get('ds-1')?.reason).toBe('Derived from dataset Assay data')
    expect(byId.get('sheet-1')?.reason).toBe('Sheet for this record')
    expect(byId.get('rec-6')?.reason).toBe('Same project')

    // Invisible and archived sources are dropped, never rendered as stubs.
    expect(byId.has('rec-hidden')).toBe(false)
    expect(byId.has('rec-old')).toBe(false)

    // Direct links outrank provenance, which outranks the cohort.
    const order = items.map((i) => i.id)
    expect(order.indexOf('rec-2')).toBeLessThan(order.indexOf('ds-1'))
    expect(order.indexOf('ds-1')).toBeLessThan(order.indexOf('rec-6'))
  })

  it('returns [] for an unresolvable seed and never throws', async () => {
    const missing = fakeClient([
      {
        match: (r) => r === 'records',
        rows: [],
      },
    ])
    await expect(fetchRelatedWork('record', 'nope', missing)).resolves.toEqual(
      [],
    )

    const failing: DataClient = {
      list: async () => {
        throw new Error('db down')
      },
      count: async () => 0,
      rpc: async <T>(): Promise<T> => {
        throw new Error('db down')
      },
      insert: async <T>(): Promise<T> => {
        throw new Error('db down')
      },
      patch: async () => [],
      remove: async () => [],
    }
    await expect(fetchRelatedWork('record', 'rec-1', failing)).resolves.toEqual(
      [],
    )
    await expect(fetchRelatedWork('dataset', '', failing)).resolves.toEqual([])
  })
})
