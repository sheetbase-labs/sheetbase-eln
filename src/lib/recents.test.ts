import { describe, expect, it } from 'vitest'

import {
  buildRecentItems,
  describeRecentChange,
  fetchMyRecentSignals,
  fetchRecentItems,
  recentStatusLabel,
  recordRecentView,
  resolveRecentItems,
  signalEventsFromChangeEvents,
} from './recents'
import type { DataClient } from './data-client'
import type { ChangeEventRecordWire } from './notebook-data'
import type {
  DerivedRecentItem,
  RecentItem,
  RecentObjectKind,
  RecentSignalEvent,
  RecentView,
} from './recents'

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const T0 = '2026-08-31T10:00:00Z'
const T1 = '2026-08-31T11:00:00Z'
const T2 = '2026-08-31T12:00:00Z'

function changeEvent(
  overrides: Partial<ChangeEventRecordWire> & Pick<ChangeEventRecordWire, 'id'>,
): ChangeEventRecordWire {
  return {
    entity_type: 'record',
    entity_uuid: '11111111-1111-1111-1111-111111111111',
    operation: 'update',
    record_id: null,
    actor_user_id: 'user-1',
    payload: {},
    created_at: T1,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// signalEventsFromChangeEvents — canonical audit trail → per-object signals.
// ---------------------------------------------------------------------------

describe('signalEventsFromChangeEvents', () => {
  it('maps record, block and link events to their owning record', () => {
    const signals = signalEventsFromChangeEvents([
      changeEvent({ id: 'a', entity_type: 'record', entity_uuid: 'r-1' }),
      changeEvent({ id: 'b', entity_type: 'block', record_id: 'r-2' }),
      changeEvent({ id: 'c', entity_type: 'record_link', record_id: 'r-3' }),
    ])
    expect(signals).toEqual([
      { kind: 'record', id: 'r-1', at: T1, signal: 'edited' },
      { kind: 'record', id: 'r-2', at: T1, signal: 'edited' },
      { kind: 'record', id: 'r-3', at: T1, signal: 'edited' },
    ])
  })

  it('maps the other resumable object kinds from their own entity_uuid', () => {
    const signals = signalEventsFromChangeEvents([
      changeEvent({
        id: 'a',
        entity_type: 'sheet_instance',
        entity_uuid: 's-1',
      }),
      changeEvent({ id: 'b', entity_type: 'dataset', entity_uuid: 'd-1' }),
      changeEvent({ id: 'c', entity_type: 'project', entity_uuid: 'p-1' }),
      changeEvent({
        id: 'd',
        entity_type: 'notebook_template',
        entity_uuid: 't-1',
      }),
    ])
    expect(signals.map((s) => [s.kind, s.id])).toEqual([
      ['sheet', 's-1'],
      ['dataset', 'd-1'],
      ['project', 'p-1'],
      ['notebook_template', 't-1'],
    ])
  })

  it('maps review submission events to a reviewed signal on the record', () => {
    const signals = signalEventsFromChangeEvents([
      changeEvent({
        id: 'a',
        entity_type: 'review_submission',
        entity_uuid: 'sub-1',
        record_id: 'r-1',
      }),
    ])
    expect(signals).toEqual([
      { kind: 'record', id: 'r-1', at: T1, signal: 'reviewed' },
    ])
  })

  it('ignores non-edit operations and unrelated entity types', () => {
    const signals = signalEventsFromChangeEvents([
      changeEvent({ id: 'a', operation: 'delete' }),
      changeEvent({ id: 'b', operation: 'archive' }),
      changeEvent({ id: 'c', entity_type: 'webhook_delivery' }),
    ])
    expect(signals).toEqual([])
  })

  it('ignores block events without a record scoping hint', () => {
    const signals = signalEventsFromChangeEvents([
      changeEvent({ id: 'a', entity_type: 'block', record_id: null }),
    ])
    expect(signals).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildRecentItems — merge, ordering, signal precedence, capping.
// ---------------------------------------------------------------------------

describe('buildRecentItems', () => {
  const view = (
    kind: RecentObjectKind,
    id: string,
    viewedAt: string,
  ): RecentView => ({
    kind,
    id,
    viewedAt,
  })

  it('orders by last activity across viewed and edited signals', () => {
    const items = buildRecentItems({
      views: [
        view('record', 'r-old', T0),
        view('dataset', 'd-new', T2),
        view('record', 'r-mid', T1),
      ],
      signals: [
        { kind: 'record', id: 'r-mid', at: T1, signal: 'edited' },
        { kind: 'sheet', id: 's-edit', at: T1, signal: 'edited' },
      ],
    })
    expect(items.map((i) => [i.kind, i.id, i.signal])).toEqual([
      ['dataset', 'd-new', 'viewed'],
      ['record', 'r-mid', 'edited'],
      ['sheet', 's-edit', 'edited'],
      ['record', 'r-old', 'viewed'],
    ])
  })

  it('marks an object edited when the edit is newer than the view', () => {
    const items = buildRecentItems({
      views: [view('record', 'r-1', T0)],
      signals: [{ kind: 'record', id: 'r-1', at: T2, signal: 'edited' }],
    })
    expect(items).toHaveLength(1)
    expect(items[0].signal).toBe('edited')
    expect(items[0].viewedAt).toBe(T0)
    expect(items[0].editedAt).toBe(T2)
    expect(items[0].lastActivityAt).toBe(T2)
  })

  it('keeps the viewed signal when the view is newer than the edit', () => {
    const items = buildRecentItems({
      views: [view('record', 'r-1', T2)],
      signals: [{ kind: 'record', id: 'r-1', at: T0, signal: 'edited' }],
    })
    expect(items[0].signal).toBe('viewed')
    expect(items[0].editedAt).toBe(T0)
    expect(items[0].lastActivityAt).toBe(T2)
  })

  it('keeps the newest signal per object instead of duplicating rows', () => {
    const items = buildRecentItems({
      views: [view('record', 'r-1', T1)],
      signals: [
        { kind: 'record', id: 'r-1', at: T0, signal: 'edited' },
        { kind: 'record', id: 'r-1', at: T2, signal: 'edited' },
        { kind: 'record', id: 'r-1', at: T1, signal: 'reviewed' },
      ],
    })
    expect(items).toHaveLength(1)
    expect(items[0].signal).toBe('edited')
    expect(items[0].reviewedAt).toBe(T1)
  })

  it('caps the list to the requested limit', () => {
    const views = Array.from({ length: 30 }, (_, i) =>
      view(
        'record',
        `r-${i}`,
        new Date(Date.parse(T0) + i * 1000).toISOString(),
      ),
    )
    const items = buildRecentItems({ views, signals: [], limit: 20 })
    expect(items).toHaveLength(20)
    // Newest first after the cap.
    expect(items[0].id).toBe('r-29')
  })

  it('breaks ordering ties deterministically by kind then id', () => {
    const items = buildRecentItems({
      views: [
        view('sheet', 's-1', T1),
        view('dataset', 'd-1', T1),
        view('record', 'r-1', T1),
        view('project', 'p-1', T1),
      ],
      signals: [],
    })
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      'dataset:d-1',
      'project:p-1',
      'record:r-1',
      'sheet:s-1',
    ])
  })
})

// ---------------------------------------------------------------------------
// resolveRecentItems — canonical labels, destinations, lifecycle filtering.
// ---------------------------------------------------------------------------

describe('resolveRecentItems', () => {
  const derived = (kind: RecentSignalEvent['kind'], id: string) => ({
    kind,
    id,
    lastActivityAt: T1,
    signal: 'viewed' as const,
    viewedAt: T1,
    editedAt: null,
    reviewedAt: null,
  })

  function clientWithRows(rows: Record<string, unknown[]>): DataClient {
    return {
      list: (resource: string) => Promise.resolve(rows[resource] ?? []),
      count: () => Promise.resolve(0),
      rpc: () => Promise.resolve({}),
      insert: () => Promise.resolve({}),
      patch: () => Promise.resolve([]),
      remove: () => Promise.resolve([]),
    } as unknown as DataClient
  }

  it('labels records and routes through the canonical destination helpers', async () => {
    const items = await resolveRecentItems(
      clientWithRows({
        records: [
          {
            id: 'r-1',
            kind: 'sample',
            identifier: 'SAM-0001',
            title: 'Buffer lot A',
            archived_at: null,
            deleted_at: null,
          },
        ],
      }),
      [derived('record', 'r-1')],
    )
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('Buffer lot A')
    expect(items[0].destination).toBe('/samples/r-1')
    expect(items[0].identifier).toBe('SAM-0001')
  })

  it('drops archived, deleted and retired objects rather than linking to them', async () => {
    const items = await resolveRecentItems(
      clientWithRows({
        records: [
          {
            id: 'r-archived',
            kind: 'experiment',
            identifier: 'EXP-1',
            title: 'Archived',
            archived_at: T0,
            deleted_at: null,
          },
          {
            id: 'r-deleted',
            kind: 'experiment',
            identifier: 'EXP-2',
            title: 'Deleted',
            archived_at: null,
            deleted_at: T0,
          },
        ],
        datasets: [{ id: 'd-retired', name: 'Retired', lifecycle: 'archived' }],
        sheet_instances: [
          { id: 's-archived', name: 'Archived sheet', lifecycle: 'archived' },
        ],
        projects: [
          {
            id: 'p-archived',
            key: 'ARC',
            title: 'Archived project',
            archived_at: T0,
          },
        ],
        notebook_templates: [
          {
            id: 't-retired',
            key: 'retired_tpl',
            name: 'Retired template',
            lifecycle: 'retired',
          },
        ],
      }),
      [
        derived('record', 'r-archived'),
        derived('record', 'r-deleted'),
        derived('dataset', 'd-retired'),
        derived('sheet', 's-archived'),
        derived('project', 'p-archived'),
        derived('notebook_template', 't-retired'),
      ],
    )
    expect(items).toEqual([])
  })

  it('preserves the derivation order and resolves every kind', async () => {
    const items = await resolveRecentItems(
      clientWithRows({
        records: [
          {
            id: 'r-1',
            kind: 'experiment',
            identifier: 'EXP-1',
            title: 'Experiment one',
            archived_at: null,
            deleted_at: null,
          },
        ],
        datasets: [{ id: 'd-1', name: 'Assay readouts', lifecycle: 'active' }],
        sheet_instances: [
          { id: 's-1', name: 'Dose response', lifecycle: 'active' },
        ],
        projects: [
          {
            id: 'p-1',
            key: 'LV-1',
            title: 'Stability study',
            archived_at: null,
          },
        ],
        notebook_templates: [
          { id: 't-1', key: 'pk_study', name: 'PK study', lifecycle: 'active' },
        ],
      }),
      [
        derived('sheet', 's-1'),
        derived('record', 'r-1'),
        derived('dataset', 'd-1'),
        derived('project', 'p-1'),
        derived('notebook_template', 't-1'),
      ],
    )
    expect(items.map((i) => [i.kind, i.destination])).toEqual([
      ['sheet', '/sheets/s-1'],
      ['record', '/experiments/r-1'],
      ['dataset', '/datasets/d-1'],
      ['project', '/projects/p-1'],
      ['notebook_template', '/templates?template=t-1'],
    ])
  })

  it('drops objects the canonical tables no longer return', async () => {
    const items = await resolveRecentItems(clientWithRows({}), [
      derived('record', 'r-gone'),
      derived('sheet', 's-gone'),
    ])
    expect(items).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Presentation helpers — last-change copy and canonical status labels.
// ---------------------------------------------------------------------------

describe('describeRecentChange', () => {
  const item = (kind: RecentObjectKind, signal: RecentItem['signal']) =>
    ({ kind, signal }) as Pick<RecentItem, 'kind' | 'signal'>

  it('describes the newest action in the user’s words', () => {
    expect(describeRecentChange(item('record', 'edited'))).toBe('Edited record')
    expect(describeRecentChange(item('dataset', 'viewed'))).toBe(
      'Viewed dataset',
    )
    expect(describeRecentChange(item('sheet', 'edited'))).toBe('Edited sheet')
    expect(describeRecentChange(item('project', 'viewed'))).toBe(
      'Viewed project',
    )
    expect(describeRecentChange(item('notebook_template', 'viewed'))).toBe(
      'Viewed template',
    )
    expect(describeRecentChange(item('record', 'reviewed'))).toBe(
      'Submitted for review',
    )
  })
})

describe('recentStatusLabel', () => {
  it('maps canonical statuses and title-cases unknown ones', () => {
    expect(recentStatusLabel({ status: 'in_progress' })).toBe('In progress')
    expect(recentStatusLabel({ status: 'active' })).toBe('Active')
    expect(recentStatusLabel({ status: 'archived' })).toBe('Archived')
    expect(recentStatusLabel({ status: 'weird_state' })).toBe('Weird State')
    expect(recentStatusLabel({ status: null })).toBeNull()
  })
})

describe('resolveRecentItems status', () => {
  function client(rows: Record<string, unknown[]>): DataClient {
    return {
      list: (resource: string) => Promise.resolve(rows[resource] ?? []),
    } as unknown as DataClient
  }
  const derivedItem = (
    kind: RecentObjectKind,
    id: string,
  ): DerivedRecentItem => ({
    kind,
    id,
    lastActivityAt: T1,
    signal: 'edited',
    viewedAt: null,
    editedAt: T1,
    reviewedAt: null,
  })

  it('carries the canonical status for records and lifecycle objects', async () => {
    const items = await resolveRecentItems(
      client({
        records: [
          {
            id: 'r-1',
            kind: 'experiment',
            identifier: 'EXP-1',
            title: 'Run one',
            status: 'in_progress',
            archived_at: null,
            deleted_at: null,
          },
        ],
        datasets: [{ id: 'd-1', name: 'Assay', lifecycle: 'active' }],
        projects: [
          {
            id: 'p-1',
            key: 'LV-1',
            title: 'Study',
            status: 'active',
            archived_at: null,
          },
        ],
      }),
      [
        derivedItem('record', 'r-1'),
        derivedItem('dataset', 'd-1'),
        derivedItem('project', 'p-1'),
      ],
    )
    expect(items.map((i) => [i.kind, i.status])).toEqual([
      ['record', 'in_progress'],
      ['dataset', 'active'],
      ['project', 'active'],
    ])
  })
})

// ---------------------------------------------------------------------------
// fetchMyRecentSignals — the change_events query contract.
// ---------------------------------------------------------------------------

describe('fetchMyRecentSignals', () => {
  it('queries the canonical change_events audit trail scoped to the actor', async () => {
    const queries: string[] = []
    const client = {
      list: (_resource: string, query: string) => {
        queries.push(_resource + query)
        return Promise.resolve([])
      },
    } as unknown as DataClient
    const signals: RecentSignalEvent[] = await fetchMyRecentSignals(
      client,
      'user-1',
    )
    expect(signals).toEqual([])
    expect(queries).toEqual([
      'change_events?actor_user_id=eq.user-1&operation=in.(create,update,amend)&order=created_at.desc&select=id,entity_type,entity_uuid,operation,record_id,actor_user_id,created_at&limit=300',
    ])
  })
})

// ---------------------------------------------------------------------------
// fetchMyRecentSignals — distinct-object paging (concentrated bursts).
// ---------------------------------------------------------------------------

describe('fetchMyRecentSignals paging', () => {
  /** Serves change_events pages from a fixed newest-first array. */
  function pagedClient(events: ChangeEventRecordWire[]): {
    client: DataClient
    queries: string[]
  } {
    const queries: string[] = []
    const client = {
      list: (_resource: string, query: string) => {
        queries.push(_resource + query)
        const params = new URLSearchParams(query)
        const offset = Number(params.get('offset') ?? 0)
        const pageSize = Number(params.get('limit') ?? 100)
        return Promise.resolve(events.slice(offset, offset + pageSize))
      },
    } as unknown as DataClient
    return { client, queries }
  }

  it('pages past a concentrated burst until other objects appear', async () => {
    // 120 events all for one record, then one each for two others. The old
    // single 100-row raw window was entirely filled by the burst, so r-a and
    // r-b never reached the derivation at all.
    const events = [
      ...Array.from({ length: 120 }, (_, i) =>
        changeEvent({
          id: `burst-${i}`,
          entity_uuid: 'r-burst',
          created_at: new Date(Date.parse(T2) - i * 1000).toISOString(),
        }),
      ),
      changeEvent({ id: 'e-a', entity_uuid: 'r-a', created_at: T0 }),
      changeEvent({ id: 'e-b', entity_uuid: 'r-b', created_at: T0 }),
    ]
    const { client } = pagedClient(events)
    const signals = await fetchMyRecentSignals(client, 'user-1', {
      targetDistinct: 3,
    })
    const ids = new Set(signals.map((s) => s.id))
    expect(ids).toContain('r-burst')
    expect(ids).toContain('r-a')
    expect(ids).toContain('r-b')
  })

  it('stops paging once the target distinct-object count is reached', async () => {
    const { client, queries } = pagedClient([
      changeEvent({ id: 'a', entity_uuid: 'r-1', created_at: T2 }),
      changeEvent({ id: 'b', entity_uuid: 'r-2', created_at: T1 }),
    ])
    const signals = await fetchMyRecentSignals(client, 'user-1', {
      targetDistinct: 2,
      pageSize: 1,
    })
    expect(queries).toHaveLength(2)
    expect(new Set(signals.map((s) => s.id))).toEqual(new Set(['r-1', 'r-2']))
  })

  it('stops at the end of the feed without a final empty-page request', async () => {
    const { client, queries } = pagedClient([
      changeEvent({ id: 'a', entity_uuid: 'r-1', created_at: T1 }),
    ])
    const signals = await fetchMyRecentSignals(client, 'user-1', {
      pageSize: 2,
    })
    expect(queries).toHaveLength(1)
    expect(signals).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// fetchRecentItems — replenishment after resolution and distinct objects.
// ---------------------------------------------------------------------------

describe('fetchRecentItems', () => {
  const visibleRecord = (id: string) => ({
    id,
    kind: 'experiment',
    identifier: `EXP-${id}`,
    title: `Record ${id}`,
    archived_at: null,
    deleted_at: null,
  })

  /** Reads the `id=in.(a,b)` filter out of a PostgREST query string. */
  function idsFromInQuery(query: string): string[] {
    const raw = new URLSearchParams(query).get('id') ?? ''
    return raw
      .replace(/^in\.\(/, '')
      .replace(/\)$/, '')
      .split(',')
  }

  it('replenishes from older candidates when the newest are hidden', async () => {
    // 30 views; the newest 10 (r-20…r-29) are archived, so resolution drops
    // them. Capping candidates before resolving would strand 10 slots; the
    // older visible records must fill the surface instead.
    const views = Array.from({ length: 30 }, (_, i) => ({
      user_id: 'user-1',
      object_kind: 'record' as const,
      object_id: `r-${i}`,
      viewed_at: new Date(Date.parse(T0) + i * 1000).toISOString(),
    }))
    const visible = new Set(Array.from({ length: 20 }, (_, i) => `r-${i}`))
    const client = {
      list: (resource: string, query: string) => {
        if (resource === 'recently_viewed') return Promise.resolve(views)
        if (resource === 'records') {
          const rows = idsFromInQuery(query)
            .filter((id) => visible.has(id))
            .map(visibleRecord)
          return Promise.resolve(rows)
        }
        return Promise.resolve([])
      },
    } as unknown as DataClient

    const items = await fetchRecentItems(client, 'user-1')
    expect(items).toHaveLength(20)
    expect(items.map((i) => i.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `r-${19 - i}`),
    )
  })

  it('keeps other objects when one object owns the entire raw window', async () => {
    const events = [
      ...Array.from({ length: 120 }, (_, i) =>
        changeEvent({
          id: `burst-${i}`,
          entity_uuid: 'r-burst',
          created_at: new Date(Date.parse(T2) - i * 1000).toISOString(),
        }),
      ),
      changeEvent({ id: 'e-a', entity_uuid: 'r-a', created_at: T0 }),
      changeEvent({ id: 'e-b', entity_uuid: 'r-b', created_at: T0 }),
    ]
    const client = {
      list: (resource: string, query: string) => {
        if (resource === 'change_events') {
          const params = new URLSearchParams(query)
          const offset = Number(params.get('offset') ?? 0)
          const pageSize = Number(params.get('limit') ?? 100)
          return Promise.resolve(events.slice(offset, offset + pageSize))
        }
        if (resource === 'records') {
          const rows = idsFromInQuery(query).map(visibleRecord)
          return Promise.resolve(rows)
        }
        return Promise.resolve([])
      },
    } as unknown as DataClient

    const items = await fetchRecentItems(client, 'user-1')
    const ids = items.map((i) => i.id)
    expect(ids).toContain('r-burst')
    expect(ids).toContain('r-a')
    expect(ids).toContain('r-b')
  })
})

describe('recordRecentView', () => {
  it('writes through the record_recent_view RPC with stable object identity', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return Promise.resolve('2026-08-31T12:00:00Z')
      },
    } as unknown as DataClient
    const viewedAt = await recordRecentView(client, 'sheet', 's-1')
    expect(viewedAt).toBe('2026-08-31T12:00:00Z')
    expect(calls).toEqual([
      {
        name: 'record_recent_view',
        args: { p_object_kind: 'sheet', p_object_id: 's-1' },
      },
    ])
  })

  it('normalises the scalar timestamptz return and null (ignored view)', async () => {
    const stringClient = {
      rpc: () => Promise.resolve('2026-08-31T12:00:00Z'),
    } as unknown as DataClient
    expect(await recordRecentView(stringClient, 'record', 'r-1')).toBe(
      '2026-08-31T12:00:00Z',
    )
    const nullClient = {
      rpc: () => Promise.resolve(null),
    } as unknown as DataClient
    expect(await recordRecentView(nullClient, 'record', 'r-1')).toBeNull()
  })
})
