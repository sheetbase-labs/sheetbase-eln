import { describe, expect, it } from 'vitest'

import {
  createRegistrySavedViewStore,
  decodeRegistryQuery,
  encodeRegistryQuery,
  formatRegistryValue,
  registrySavedViewStorageKey,
  sanitizeRegistryView,
} from './registry'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

const viewState = {
  query: {
    pageIndex: 0,
    pageSize: 50,
    sorting: [{ id: 'identifier', desc: false }],
    grouping: ['status'],
    filters: [
      { fieldId: 'status', operator: 'eq' as const, values: ['available'] },
    ],
  },
  columnVisibility: { owner: false },
  density: 'compact' as const,
}

describe('registry saved views', () => {
  it('persists views in a key scoped to registry, workspace and user', () => {
    const storage = memoryStorage()
    const ownerA = createRegistrySavedViewStore({
      registryId: 'samples',
      workspaceId: 'workspace-a',
      userId: 'owner-a',
      storage,
    })
    const ownerB = createRegistrySavedViewStore({
      registryId: 'samples',
      workspaceId: 'workspace-a',
      userId: 'owner-b',
      storage,
    })

    ownerA.save({
      id: 'available',
      name: 'Available samples',
      state: viewState,
    })

    expect(ownerA.list()).toMatchObject([
      { id: 'available', name: 'Available samples', state: viewState },
    ])
    expect(ownerB.list()).toEqual([])
    expect(
      storage.getItem(
        registrySavedViewStorageKey('samples', 'workspace-a', 'owner-a'),
      ),
    ).not.toBeNull()
  })

  it('updates and removes a saved view without duplicating it', () => {
    const store = createRegistrySavedViewStore({
      registryId: 'reagents',
      workspaceId: 'workspace-a',
      userId: 'owner-a',
      storage: memoryStorage(),
    })
    store.save({ id: 'attention', name: 'Attention', state: viewState })
    store.save({
      id: 'attention',
      name: 'Needs attention',
      state: { ...viewState, density: 'comfortable' },
    })

    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]).toMatchObject({
      id: 'attention',
      name: 'Needs attention',
      state: { density: 'comfortable' },
    })

    store.remove('attention')
    expect(store.list()).toEqual([])
  })

  it('fails closed to an empty list for corrupt persisted data', () => {
    const storage = memoryStorage()
    storage.setItem(
      registrySavedViewStorageKey('samples', 'workspace-a', 'owner-a'),
      '{not-json',
    )
    const store = createRegistrySavedViewStore({
      registryId: 'samples',
      workspaceId: 'workspace-a',
      userId: 'owner-a',
      storage,
    })

    expect(store.list()).toEqual([])
  })

  it('removes fields that are outside the current registry policy', () => {
    const safe = sanitizeRegistryView(
      {
        id: 'stale',
        name: 'Stale',
        state: {
          ...viewState,
          query: {
            ...viewState.query,
            pageSize: 999,
            sorting: [...viewState.query.sorting, { id: 'secret', desc: true }],
            filters: [
              ...viewState.query.filters,
              { fieldId: 'secret', operator: 'eq', values: ['x'] },
            ],
          },
          columnVisibility: { owner: false, secret: true },
        },
      },
      {
        sortColumnIds: ['identifier'],
        visibilityColumnIds: ['owner'],
        filterIds: ['status'],
        groupingIds: ['status'],
        pageSizes: [25, 50, 100],
        fallbackPageSize: 25,
      },
    )

    expect(safe.state.query).toMatchObject({
      pageIndex: 0,
      pageSize: 25,
      sorting: [{ id: 'identifier', desc: false }],
      filters: [{ fieldId: 'status', operator: 'eq', values: ['available'] }],
    })
    expect(safe.state.columnVisibility).toEqual({ owner: false })
  })
})

describe('registry query URL codec', () => {
  it('round-trips typed operators and every value', () => {
    const query = {
      ...viewState.query,
      filters: [
        {
          fieldId: 'status',
          operator: 'in' as const,
          values: ['available', 'reserved', true],
        },
      ],
    }
    expect(decodeRegistryQuery(encodeRegistryQuery(query))).toEqual(query)
  })

  it('rejects malformed, oversized and unknown-version state', () => {
    expect(decodeRegistryQuery('%7Bbad')).toBeNull()
    expect(decodeRegistryQuery('x'.repeat(4097))).toBeNull()
    expect(
      decodeRegistryQuery(
        encodeURIComponent(JSON.stringify({ v: 2, q: viewState.query })),
      ),
    ).toBeNull()
  })
})

describe('registry scientific formatting', () => {
  it('formats scientific numbers, units and missing values consistently', () => {
    expect(formatRegistryValue(23_100_000, { kind: 'scientific' })).toBe(
      '23,100,000',
    )
    expect(
      formatRegistryValue(0.0000042, { kind: 'scientific', unit: 'µg/mL' }),
    ).toBe('4.20e-6 µg/mL')
    expect(formatRegistryValue(null, { kind: 'scientific' })).toBe('—')
  })
})
