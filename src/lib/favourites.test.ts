import { describe, expect, it } from 'vitest'

import {
  applyFavouriteChange,
  fetchFavouriteItems,
  fetchFavourites,
  orderFavourites,
  resolveFavouriteItems,
  setFavourite,
} from './favourites'
import type { DataClient } from './data-client'
import type { Favourite, FavouriteObjectKind } from './favourites'

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const T0 = '2026-08-31T10:00:00Z'
const T1 = '2026-08-31T11:00:00Z'
const T2 = '2026-08-31T12:00:00Z'

const favourite = (
  kind: FavouriteObjectKind,
  id: string,
  createdAt: string,
): Favourite => ({ kind, id, createdAt })

// ---------------------------------------------------------------------------
// orderFavourites — deterministic ordering and capping.
// ---------------------------------------------------------------------------

describe('orderFavourites', () => {
  it('orders most recently favourited first with kind-then-id tiebreak', () => {
    const ordered = orderFavourites([
      favourite('record', 'r-1', T1),
      favourite('sheet', 's-1', T2),
      favourite('dataset', 'd-1', T1),
      favourite('project', 'p-1', T0),
    ])
    expect(ordered.map((f) => `${f.kind}:${f.id}`)).toEqual([
      'sheet:s-1',
      'dataset:d-1',
      'record:r-1',
      'project:p-1',
    ])
  })

  it('breaks created_at ties deterministically by kind then id', () => {
    const ordered = orderFavourites([
      favourite('notebook_template', 't-1', T1),
      favourite('sheet', 's-1', T1),
      favourite('dataset', 'd-1', T1),
      favourite('project', 'p-1', T1),
    ])
    expect(ordered.map((f) => `${f.kind}:${f.id}`)).toEqual([
      'dataset:d-1',
      'notebook_template:t-1',
      'project:p-1',
      'sheet:s-1',
    ])
  })

  it('caps the list to the requested limit', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      favourite(
        'record',
        `r-${i}`,
        new Date(Date.parse(T0) + i * 1000).toISOString(),
      ),
    )
    const ordered = orderFavourites(rows, 12)
    expect(ordered).toHaveLength(12)
    expect(ordered[0].id).toBe('r-29')
  })

  it('does not mutate the input array', () => {
    const rows = [favourite('record', 'r-1', T0), favourite('sheet', 's-1', T1)]
    const copy = [...rows]
    orderFavourites(rows)
    expect(rows).toEqual(copy)
  })
})

// ---------------------------------------------------------------------------
// applyFavouriteChange — pure toggle semantics for optimistic updates.
// ---------------------------------------------------------------------------

describe('applyFavouriteChange', () => {
  it('adds a pin when not present', () => {
    const next = applyFavouriteChange([], 'record', 'r-1', true)
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ kind: 'record', id: 'r-1' })
    expect(next[0].createdAt).toBeTruthy()
  })

  it('removes only the targeted pin when unfavouriting', () => {
    const rows = [
      favourite('record', 'r-1', T0),
      favourite('dataset', 'd-1', T1),
    ]
    const next = applyFavouriteChange(rows, 'record', 'r-1', false)
    expect(next).toEqual([favourite('dataset', 'd-1', T1)])
  })

  it('keeps the original created_at when the favourite already exists', () => {
    const rows = [favourite('record', 'r-1', T0)]
    const next = applyFavouriteChange(rows, 'record', 'r-1', true)
    expect(next).toHaveLength(1)
    expect(next[0].createdAt).toBe(T0)
  })

  it('does not duplicate an object across kinds or lose other rows', () => {
    const rows = [favourite('record', 'r-1', T0)]
    const next = applyFavouriteChange(rows, 'dataset', 'r-1', true)
    expect(next.map((f) => `${f.kind}:${f.id}`)).toEqual([
      'dataset:r-1',
      'record:r-1',
    ])
    // Unfavouriting one kind does not touch the other.
    const afterUnfavourite = applyFavouriteChange(next, 'dataset', 'r-1', false)
    expect(afterUnfavourite).toEqual([favourite('record', 'r-1', T0)])
  })
})

// ---------------------------------------------------------------------------
// fetchFavourites / setFavourite — the PostgREST/RPC contract.
// ---------------------------------------------------------------------------

describe('fetchFavourites', () => {
  it('reads RLS-scoped rows through the /api/db boundary, newest first', async () => {
    const queries: string[] = []
    const client = {
      list: (resource: string, query: string) => {
        queries.push(resource + query)
        return Promise.resolve([
          {
            user_id: 'user-1',
            object_kind: 'record',
            object_id: 'r-1',
            created_at: T1,
          },
          {
            user_id: 'user-1',
            object_kind: 'sheet',
            object_id: 's-1',
            created_at: T2,
          },
        ])
      },
    } as unknown as DataClient
    const favourites = await fetchFavourites(client)
    expect(favourites.map((f) => `${f.kind}:${f.id}`)).toEqual([
      'sheet:s-1',
      'record:r-1',
    ])
    expect(queries).toEqual([
      'user_favourites?order=created_at.desc&limit=200&select=user_id,object_kind,object_id,created_at',
    ])
  })
})

describe('setFavourite', () => {
  it('writes through the set_record_favourite RPC with stable identity', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return Promise.resolve(T1)
      },
    } as unknown as DataClient
    const createdAt = await setFavourite(client, 'project', 'p-1', true)
    expect(createdAt).toBe(T1)
    expect(calls).toEqual([
      {
        name: 'set_record_favourite',
        args: {
          p_object_kind: 'project',
          p_object_id: 'p-1',
          p_favourite: true,
        },
      },
    ])
  })

  it('normalises the scalar timestamptz return and the null (removed/ignored) return', async () => {
    const stringClient = {
      rpc: () => Promise.resolve(T2),
    } as unknown as DataClient
    expect(await setFavourite(stringClient, 'record', 'r-1', true)).toBe(T2)
    const nullClient = {
      rpc: () => Promise.resolve(null),
    } as unknown as DataClient
    expect(await setFavourite(nullClient, 'record', 'r-1', false)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// resolveFavouriteItems — canonical labels, destinations, lifecycle.
// ---------------------------------------------------------------------------

describe('resolveFavouriteItems', () => {
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

  it('labels every kind and routes through the canonical destination helpers', async () => {
    const items = await resolveFavouriteItems(
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
        favourite('sheet', 's-1', T1),
        favourite('record', 'r-1', T1),
        favourite('dataset', 'd-1', T1),
        favourite('project', 'p-1', T1),
        favourite('notebook_template', 't-1', T1),
      ],
    )
    expect(items.map((i) => [i.kind, i.label, i.destination])).toEqual([
      ['sheet', 'Dose response', '/sheets/s-1'],
      ['record', 'Buffer lot A', '/samples?selected=r-1'],
      ['dataset', 'Assay readouts', '/datasets?dataset=d-1'],
      ['project', 'Stability study', '/projects/p-1'],
      ['notebook_template', 'PK study', '/templates?template=t-1'],
    ])
  })

  it('hides favourites of archived, retired and deleted objects instead of linking to them', async () => {
    const items = await resolveFavouriteItems(
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
        favourite('record', 'r-archived', T0),
        favourite('record', 'r-deleted', T1),
        favourite('dataset', 'd-retired', T1),
        favourite('sheet', 's-archived', T1),
        favourite('project', 'p-archived', T1),
        favourite('notebook_template', 't-retired', T1),
      ],
    )
    // Hidden at read time — never deleted; unfavouriting is the only removal.
    expect(items).toEqual([])
  })

  it('keeps the deterministic input order and preserves the identifier line', async () => {
    const items = await resolveFavouriteItems(
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
        projects: [
          { id: 'p-1', key: 'LV-1', title: 'Stability', archived_at: null },
        ],
      }),
      [favourite('project', 'p-1', T0), favourite('record', 'r-1', T1)],
    )
    expect(items.map((i) => [i.kind, i.identifier])).toEqual([
      ['project', 'LV-1'],
      ['record', 'EXP-1'],
    ])
  })

  it('drops favourites whose canonical object no longer resolves', async () => {
    const items = await resolveFavouriteItems(clientWithRows({}), [
      favourite('record', 'r-gone', T0),
      favourite('sheet', 's-gone', T1),
    ])
    expect(items).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// fetchFavouriteItems — the one-shot home read.
// ---------------------------------------------------------------------------

describe('fetchFavouriteItems', () => {
  it('fetches rows then resolves labels, preserving the order and cap', async () => {
    const client = {
      list: (resource: string, query: string) => {
        if (resource === 'user_favourites') {
          expect(query).toContain('order=created_at.desc')
          return Promise.resolve([
            {
              user_id: 'u',
              object_kind: 'project',
              object_id: 'p-1',
              created_at: T0,
            },
            {
              user_id: 'u',
              object_kind: 'record',
              object_id: 'r-1',
              created_at: T1,
            },
          ])
        }
        if (resource === 'records') {
          return Promise.resolve([
            {
              id: 'r-1',
              kind: 'experiment',
              identifier: 'EXP-1',
              title: 'Experiment one',
              archived_at: null,
              deleted_at: null,
            },
          ])
        }
        if (resource === 'projects') {
          return Promise.resolve([
            { id: 'p-1', key: 'LV-1', title: 'Stability', archived_at: null },
          ])
        }
        return Promise.resolve([])
      },
    } as unknown as DataClient
    const items = await fetchFavouriteItems(client, 1)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'record',
      id: 'r-1',
      label: 'Experiment one',
      destination: '/records/r-1',
    })
  })
})
