/**
 * DATA-007 — Dataset Explorer data layer unit tests.
 *
 * Covers the pure helpers that define the safe limits: PostgREST query
 * construction, saved-view sanitisation against stale local storage, the
 * transformation validator, and the default chart spec builder. The store
 * is exercised with an in-memory Storage so it never touches the browser.
 */
import { describe, expect, it } from 'vitest'

import {
  buildDatasetRowQuery,
  buildDefaultChartSpec,
  createDatasetSavedViewStore,
  DATASET_MAX_FILTERS,
  DATASET_MAX_TRANSFORMATIONS,
  DATASET_PAGE_SIZES,
  datasetSavedViewStorageKey,
  fetchDatasetLifecycleById,
  getNextDatasetPageParam,
  fetchDatasetRowPage,
  fetchDatasetSummaries,
  keepDatasetVersion,
  listDatasetVersionSummaries,
  resolveDatasetDeepLinkSelection,
  sanitizeDatasetView,
  validateTransformations,
} from './dataset-explorer-data'
import { createDataClient } from './data-client'
import type {
  DatasetSavedView,
  DatasetViewSpec,
  DatasetVersionSummary,
} from './dataset-explorer-data'
import type {
  ScientificColumnWire,
  ScientificTableWire,
} from './scientific-sheet-data'

function dataRequest(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Request {
  return new Request(
    input instanceof Request ? input : new URL(input, 'http://eln.test'),
    init,
  )
}

function column(
  overrides: Partial<ScientificColumnWire> = {},
): ScientificColumnWire {
  return {
    id: 'col-1',
    field_name: 'col_aaaaaaaaaaaaaaaaaaaaaaaaa',
    label: 'Sample',
    display_order: 0,
    logical_type: 'text',
    nullable: true,
    unit: null,
    validation: {},
    width: null,
    options: [],
    ...overrides,
  }
}

function table(
  overrides: Partial<ScientificTableWire> = {},
): ScientificTableWire {
  return {
    id: 't-1',
    resource_name: 'sheet_aaaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Stability',
    schema_version: 1,
    lifecycle: 'active',
    columns: [
      column({ id: 'col-1', field_name: 'col_alpha', label: 'Sample' }),
      column({
        id: 'col-2',
        field_name: 'col_beta',
        label: 'pH',
        logical_type: 'decimal',
      }),
    ],
    ...overrides,
  }
}

describe('buildDatasetRowQuery', () => {
  it('rejects a sort field absent from current table metadata', () => {
    expect(() =>
      buildDatasetRowQuery(
        {
          pageIndex: 0,
          pageSize: 25,
          sorting: [{ id: 'not_a_column', desc: false }],
          filters: [],
        },
        table().columns,
      ),
    ).toThrow('Unsupported dataset sort field')
  })

  it('rejects a filter field absent from current table metadata', () => {
    expect(() =>
      buildDatasetRowQuery(
        {
          pageIndex: 0,
          pageSize: 25,
          sorting: [],
          filters: [{ fieldId: 'not_a_column', operator: 'eq', values: ['x'] }],
        },
        table().columns,
      ),
    ).toThrow('Unsupported dataset filter')
  })
  it('uses stable insertion order when no sort is set', () => {
    const q = buildDatasetRowQuery(
      {
        pageIndex: 0,
        pageSize: 25,
        sorting: [],
        filters: [],
      },
      table().columns,
    )

    expect(q).toContain('order=created_at.asc,id.asc')
    expect(q).toContain('limit=25')
    expect(q).toContain('offset=0')
  })

  it('maps sorting to the PostgREST order param', () => {
    const q = buildDatasetRowQuery(
      {
        pageIndex: 2,
        pageSize: 50,
        sorting: [{ id: 'col_beta', desc: true }],
        filters: [],
      },
      table().columns,
    )

    expect(q).toContain('order=col_beta.desc,id.asc')
    expect(q).toContain('limit=50')
    expect(q).toContain('offset=100')
  })

  it('maps filters to eq predicates and respects the filter cap', () => {
    const filters = Array.from({ length: DATASET_MAX_FILTERS + 2 }, (_, i) => ({
      fieldId: `col_${i}`,
      operator: 'eq' as const,
      values: [`v${i}`],
    }))

    const q = buildDatasetRowQuery(
      {
        pageIndex: 0,
        pageSize: 25,
        sorting: [],
        filters,
      },
      Array.from({ length: DATASET_MAX_FILTERS + 2 }, (_, i) =>
        column({ field_name: `col_${i}` }),
      ),
    )

    // Only the first DATASET_MAX_FILTERS filters are emitted.
    const matches = q.match(/col_\d+=eq\./g) ?? []
    expect(matches.length).toBe(DATASET_MAX_FILTERS)
  })

  it('clamps page size to the safe maximum', () => {
    const q = buildDatasetRowQuery(
      {
        pageIndex: 0,
        pageSize: 9999,
        sorting: [],
        filters: [],
      },
      table().columns,
    )

    expect(q).toContain(
      `limit=${DATASET_PAGE_SIZES[DATASET_PAGE_SIZES.length - 1]}`,
    )
  })
})

describe('canonical Dataset Explorer reads', () => {
  it('lists api.datasets and attaches stable schema-version field UUIDs', async () => {
    const calls: string[] = []

    const client = createDataClient(async (input) => {
      const resource = new URL(
        input instanceof Request ? input.url : input,
        'http://eln.test',
      ).pathname.slice('/api/db/'.length)

      calls.push(resource)

      if (resource === 'datasets')
        return Response.json([
          {
            id: 'd1',
            workspace_id: 'w1',
            schema_version_id: 'v1',
            name: 'Assays',
            description: null,
            lifecycle: 'active',
            revision: 2,
          },
        ])

      if (resource === 'dataset_schema_versions')
        return Response.json([{ id: 'v1', schema_id: 'schema-1', version: 3 }])

      if (resource === 'dataset_schema_definitions')
        return Response.json([
          { id: 'schema-1', name: 'Assay schema', key: 'assay' },
        ])

      if (resource !== 'dataset_schema_version_fields') return Response.json([])

      return Response.json([
        {
          field_id: 'f1',
          schema_version_id: 'v1',
          key: 'ph',
          label: 'pH',
          logical_type: 'decimal',
          nullable: false,
          quantity: {
            code: 'pH',
            symbol: 'pH',
            ['__proto__']: { reference: 'pH' },
          },
          validation: {
            min: 0,
            max: 14,
            ['constructor']: { rule: 'scientific' },
          },
          lifecycle: 'active',
          display_order: 0,
        },
      ])
    })

    const result = await fetchDatasetSummaries(client)
    expect(calls).toEqual([
      'datasets',
      'dataset_schema_version_fields',
      'dataset_schema_versions',
      'dataset_schema_definitions',
    ])
    expect(result[0].columns[0]).toMatchObject({
      id: 'f1',
      field_name: 'f1',
      label: 'pH',
      unit: { code: 'pH', symbol: 'pH' },
      validation: { min: 0, max: 14 },
    })
    expect(Object.hasOwn(result[0].columns[0].unit ?? {}, '__proto__')).toBe(
      true,
    )
    expect(Object.hasOwn(result[0].columns[0].validation, 'constructor')).toBe(
      true,
    )
  })

  it.each([
    { quantity: ['pH'], validation: {} },
    { quantity: null, validation: { min: '0' } },
    { quantity: { symbol: 7 }, validation: {} },
  ])(
    'rejects malformed field metadata instead of publishing a typed column: %j',
    async (metadata) => {
      const client = createDataClient(async (input) => {
        const resource = new URL(
          input instanceof Request ? input.url : input,
          'http://eln.test',
        ).pathname.slice('/api/db/'.length)

        if (resource === 'datasets')
          return Response.json([{ id: 'd1', schema_version_id: 'v1' }])

        if (resource === 'dataset_schema_version_fields') {
          return Response.json([
            { field_id: 'f1', schema_version_id: 'v1', ...metadata },
          ])
        }

        return Response.json([])
      })

      await expect(fetchDatasetSummaries(client)).rejects.toThrow()
    },
  )

  it('keeps every lookup query short enough for the proxy when there are many datasets', async () => {
    const queries: string[] = []

    const client = createDataClient(async (input, init) => {
      const url = new URL(dataRequest(input, init).url)
      queries.push(url.search)

      if (url.pathname === '/api/db/datasets')
        return Response.json(
          Array.from({ length: 40 }, (_, i) => ({
            id: `d${i}`,
            name: `Dataset ${i}`,
            schema_version_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          })),
        )

      return Response.json([])
    })

    await fetchDatasetSummaries(client)
    expect(queries.length).toBeGreaterThan(4)

    for (const q of queries)
      for (const [, value] of new URLSearchParams(q.slice(1)))
        expect(value.length).toBeLessThanOrEqual(500)
  })

  it('pages, filters and sorts only through query_dataset_rows', async () => {
    let request: Request | undefined

    const client = createDataClient(async (input, init) => {
      request = dataRequest(input, init)

      return Response.json({
        totalCount: 1,
        rows: [{ rowId: 'r1', revision: 3, values: { f1: 7.2 } }],
      })
    })

    const canonical = table({
      id: 'd1',
      columns: [column({ id: 'f1', field_name: 'f1' })],
    })

    const page = await fetchDatasetRowPage(client, canonical, {
      pageIndex: 2,
      pageSize: 25,
      sorting: [{ id: 'f1', desc: true }],
      filters: [{ fieldId: 'f1', operator: 'eq', values: [7.2] }],
    })

    expect(request?.url).toBe('http://eln.test/api/db/rpc/query_dataset_rows')
    expect(request?.method).toBe('POST')
    expect(await request?.json()).toEqual({
      p_dataset_id: 'd1',
      p_query: {
        filters: [{ fieldId: 'f1', operator: 'eq', value: 7.2 }],
        sort: { fieldId: 'f1', direction: 'desc' },
      },
      p_limit: 25,
      p_offset: 50,
    })
    expect(page).toEqual({
      totalCount: 1,
      rows: [{ id: 'r1', version: 3, f1: 7.2 }],
    })
  })

  it.each([
    { pageSize: 0, limit: 1 },
    { pageSize: 9999, limit: 100 },
  ])(
    'omits absent sorts and preserves RPC limits and scientific row keys: %j',
    async ({ pageSize, limit }) => {
      let request: Request | undefined

      const values = {
        f1: 7.2,
        ['__proto__']: { source: 'assay' },
        ['constructor']: 'scientific',
      }

      const client = createDataClient(async (input, init) => {
        request = dataRequest(input, init)

        return Response.json({
          totalCount: 12,
          rows: [{ rowId: 'r1', revision: 9, values }],
        })
      })

      const page = await fetchDatasetRowPage(
        client,
        table({ id: 'd1' }),
        {
          pageIndex: -1,
          pageSize,
          sorting: [],
          filters: [],
        },
        false,
      )

      expect(await request?.json()).toEqual({
        p_dataset_id: 'd1',
        p_query: { filters: [] },
        p_limit: limit,
        p_offset: 0,
      })
      expect(page).toEqual({
        totalCount: 0,
        rows: [{ id: 'r1', version: 9, ...values }],
      })
      expect(Object.hasOwn(page.rows[0], '__proto__')).toBe(true)
      expect(Object.hasOwn(page.rows[0], 'constructor')).toBe(true)
    },
  )

  it('rejects a non-JSON original scientific metadata key before publishing it', async () => {
    const client = createDataClient(async (input, init) => {
      const resource = new URL(dataRequest(input, init).url).pathname

      if (resource === '/api/db/datasets')
        return Response.json([{ id: 'd1', schema_version_id: 'v1' }])

      if (resource === '/api/db/dataset_schema_version_fields') {
        return new Response(
          '[{"field_id":"f1","schema_version_id":"v1","quantity":{"__proto__":1e999},"validation":{}}]',
          {
            headers: { 'content-type': 'application/json' },
          },
        )
      }

      return Response.json([])
    })

    await expect(fetchDatasetSummaries(client)).rejects.toThrow()
  })
})

describe('incremental dataset pages', () => {
  const rows = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, index) => ({
      id: `row-${offset + index}`,
      version: 1,
    }))

  it('continues through full pages until the authoritative total is loaded', () => {
    const first = { rows: rows(50), totalCount: 120 }
    const second = { rows: rows(50, 50), totalCount: 0 }
    const third = { rows: rows(20, 100), totalCount: 0 }

    expect(getNextDatasetPageParam(first, [first], 50)).toBe(1)
    expect(getNextDatasetPageParam(second, [first, second], 50)).toBe(2)
    expect(
      getNextDatasetPageParam(third, [first, second, third], 50),
    ).toBeUndefined()
  })

  it('stops on an exact full final page', () => {
    const first = { rows: rows(50), totalCount: 100 }
    const second = { rows: rows(50, 50), totalCount: 0 }

    expect(getNextDatasetPageParam(second, [first, second], 50)).toBeUndefined()
  })
})

describe('sanitizeDatasetView', () => {
  function view(spec: Partial<DatasetViewSpec> = {}): DatasetSavedView {
    return {
      id: 'v-1',
      name: 'My view',
      datasetId: 't-1',
      spec: {
        query: {
          pageIndex: 3,
          pageSize: 25,
          sorting: [{ id: 'col_beta', desc: true }],
          filters: [{ fieldId: 'col_alpha', operator: 'eq', values: ['A1'] }],
        },
        hiddenFields: ['col_alpha'],
        density: 'compact',
        ...spec,
      },
    }
  }

  it('drops sorts, filters and hidden fields the dataset no longer exposes', () => {
    const t = table({
      columns: [column({ id: 'col-2', field_name: 'col_beta', label: 'pH' })],
    })

    // Default view sorts by col_beta (still present), filters by col_alpha
    // (gone) and hides col_alpha (gone): only the filter and hidden field
    // are stripped.
    const safe = sanitizeDatasetView(view(), t.columns)
    expect(safe.spec.query.sorting).toEqual([{ id: 'col_beta', desc: true }])
    expect(safe.spec.query.filters).toEqual([])
    expect(safe.spec.hiddenFields).toEqual([])
  })

  it('resets page index and clamps page size to an allowed value', () => {
    const t = table()

    const safe = sanitizeDatasetView(
      view({
        query: {
          pageIndex: 9,
          pageSize: 999,
          sorting: [],
          filters: [],
        },
      }),
      t.columns,
    )

    expect(safe.spec.query.pageIndex).toBe(0)
    expect(DATASET_PAGE_SIZES).toContain(safe.spec.query.pageSize)
  })

  it('preserves valid spec unchanged apart from the page index reset', () => {
    const t = table()
    const safe = sanitizeDatasetView(view(), t.columns)
    expect(safe.spec.query.sorting).toEqual([{ id: 'col_beta', desc: true }])
    expect(safe.spec.query.filters).toEqual([
      { fieldId: 'col_alpha', operator: 'eq', values: ['A1'] },
    ])
    expect(safe.spec.hiddenFields).toEqual(['col_alpha'])
    expect(safe.spec.density).toBe('compact')
  })
})

describe('validateTransformations', () => {
  it('accepts an empty list', () => {
    expect(validateTransformations([])).toEqual({ ok: true })
  })

  it('rejects more transformations than the safe limit', () => {
    const tooMany = Array.from(
      { length: DATASET_MAX_TRANSFORMATIONS + 1 },
      () => ({ kind: 'aggregate' as const, params: {} }),
    )

    const result = validateTransformations(tooMany)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors.length).toBeGreaterThan(0)
  })

  it('rejects unsupported kinds and non-object params', () => {
    const result = validateTransformations([
      { kind: 'unknown', params: {} },
      {
        kind: 'bin',
        params: 'not-an-object',
      },
    ])

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('Unsupported'))).toBe(true)
      expect(result.errors.some((e) => e.includes('params'))).toBe(true)
    }
  })

  it('retains transformation diagnostic order and only validates the params envelope', () => {
    const result = validateTransformations([
      { kind: 'unsupported', params: [] },
      ...Array.from({ length: DATASET_MAX_TRANSFORMATIONS }, () => ({
        kind: 'bin',
        params: {},
      })),
    ])

    expect(result).toEqual({
      ok: false,
      errors: [
        `At most ${DATASET_MAX_TRANSFORMATIONS} transformations are allowed.`,
        'Unsupported transformation kind: unsupported.',
        'Transformation params must be an object.',
      ],
    })
    expect(
      validateTransformations([
        { kind: 'aggregate', params: new Date(0) },
        { kind: 'bin', params: new Map() },
        { kind: 'normalise', params: { nested: undefined } },
      ]),
    ).toEqual({ ok: true })
  })
})

describe('buildDefaultChartSpec', () => {
  it('returns null when no numeric column exists', () => {
    expect(buildDefaultChartSpec(table({ columns: [column()] }))).toBeNull()
  })

  it('binds y to the first numeric column and x to the first category/date', () => {
    const t = table({
      columns: [
        column({
          id: 'col-cat',
          field_name: 'col_cat',
          label: 'Group',
          logical_type: 'category',
        }),
        column({
          id: 'col-num',
          field_name: 'col_num',
          label: 'pH',
          logical_type: 'decimal',
        }),
      ],
    })

    const spec = buildDefaultChartSpec(t)
    expect(spec).not.toBeNull()
    expect(spec!.fields.y.fieldId).toBe('col-num')
    expect(spec!.fields.x?.fieldId).toBe('col-cat')
    expect(spec!.fields.series?.fieldId).toBe('col-cat')
    expect(spec!.datasets[0].datasetId).toBe(t.id)
  })
})

describe('createDatasetSavedViewStore', () => {
  const persistedView: DatasetSavedView = {
    id: 'v-1',
    name: 'Default',
    datasetId: 't-1',
    spec: {
      query: { pageIndex: 0, pageSize: 25, sorting: [], filters: [] },
      hiddenFields: [],
      density: 'comfortable',
    },
  }

  function memoryStorage(): Storage {
    const map = new Map<string, string>()

    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size
      },
    }
  }

  it('round-trips a saved view scoped by table', () => {
    const store = createDatasetSavedViewStore({
      workspaceId: 'ws-1',
      userId: 'u-1',
      storage: memoryStorage(),
    })

    store.save({
      id: 'v-1',
      name: 'Default',
      datasetId: 't-1',
      spec: {
        query: {
          pageIndex: 0,
          pageSize: 25,
          sorting: [],
          filters: [],
        },
        hiddenFields: [],
        density: 'comfortable',
      },
    })
    expect(store.list('t-1').map((v) => v.name)).toEqual(['Default'])
    expect(store.list('t-2')).toEqual([])
    store.remove('t-1', 'v-1')
    expect(store.list('t-1')).toEqual([])
  })

  it('ignores corrupt persisted JSON', () => {
    const storage = memoryStorage()
    storage.setItem('sheetbase-dataset-views-v1:ws-1:u-1', 'not-json')

    const store = createDatasetSavedViewStore({
      workspaceId: 'ws-1',
      userId: 'u-1',
      storage,
    })

    expect(store.list('t-1')).toEqual([])
  })

  it.each([
    null,
    [],
    { ...persistedView, id: 1 },
    { ...persistedView, spec: null },
    { ...persistedView, spec: { ...persistedView.spec, density: 'other' } },
    { ...persistedView, spec: { ...persistedView.spec, hiddenFields: [1] } },
    ...[
      { pageIndex: -1 },
      { pageIndex: 0.5 },
      { pageSize: 0 },
      { pageSize: '25' },
      { sorting: [{ id: 'f1' }] },
      { sorting: [{ id: 1, desc: false }] },
      { filters: [{ fieldId: 'f1', operator: 'neq', values: ['x'] }] },
      { filters: [{ fieldId: 'f1', operator: 'eq', values: [null] }] },
      { filters: [{ fieldId: 'f1', operator: 'eq', values: [{}] }] },
    ].map((query) => ({
      ...persistedView,
      spec: {
        ...persistedView.spec,
        query: { ...persistedView.spec.query, ...query },
      },
    })),
  ])(
    'drops a malformed persisted view but retains valid neighbours: %j',
    (input) => {
      const storage = memoryStorage()
      storage.setItem(
        datasetSavedViewStorageKey('ws-1', 'u-1'),
        JSON.stringify([input, persistedView]),
      )

      const store = createDatasetSavedViewStore({
        workspaceId: 'ws-1',
        userId: 'u-1',
        storage,
      })

      expect(store.list('t-1')).toEqual([persistedView])
    },
  )

  it('checks saved views without stripping original extensions or unchecked timestamps', () => {
    const storage = memoryStorage()

    const extended = {
      ...persistedView,
      updatedAt: 123,
      ['__proto__']: { source: 'local' },
    }

    storage.setItem(
      datasetSavedViewStorageKey('ws-1', 'u-1'),
      JSON.stringify([extended]),
    )

    const store = createDatasetSavedViewStore({
      workspaceId: 'ws-1',
      userId: 'u-1',
      storage,
    })

    expect(store.list('t-1')).toEqual([extended])
    expect(Object.hasOwn(store.list('t-1')[0], '__proto__')).toBe(true)
  })

  it('retains integer bounds and scalar filter acceptance before sanitization', () => {
    const storage = memoryStorage()

    const legacy = {
      ...persistedView,
      spec: {
        ...persistedView.spec,
        query: {
          pageIndex: 1e20,
          pageSize: 1e20,
          sorting: [],
          filters: [
            { fieldId: 'f1', operator: 'eq', values: ['overflow', true, 1] },
          ],
        },
      },
    }

    storage.setItem(
      datasetSavedViewStorageKey('ws-1', 'u-1'),
      JSON.stringify([legacy]).replace('"overflow"', '1e999'),
    )

    const store = createDatasetSavedViewStore({
      workspaceId: 'ws-1',
      userId: 'u-1',
      storage,
    })

    expect(store.list('t-1')[0]?.spec.query).toEqual({
      ...legacy.spec.query,
      filters: [{ fieldId: 'f1', operator: 'eq', values: [Infinity, true, 1] }],
    })
  })
})

describe('fetchDatasetLifecycleById', () => {
  it('reads one Dataset lifecycle by stable ID regardless of archive state', async () => {
    const queries: string[] = []

    const client = createDataClient(async (input, init) => {
      const url = new URL(dataRequest(input, init).url)
      queries.push(url.search)
      expect(url.pathname).toBe('/api/db/datasets')

      return Response.json([{ lifecycle: 'archived' }])
    })

    const lifecycle = await fetchDatasetLifecycleById(client, 'd-archived')
    expect(lifecycle).toBe('archived')
    expect(queries[0]).toBe('?id=eq.d-archived&select=lifecycle')
  })

  it('returns null when the Dataset does not exist', async () => {
    const client = createDataClient(async () => Response.json([]))

    await expect(
      fetchDatasetLifecycleById(client, 'd-missing'),
    ).resolves.toBeNull()
  })
})

describe('resolveDatasetDeepLinkSelection', () => {
  const listed = [{ id: 'd-active-1' }, { id: 'd-active-2' }]

  it('selects the exact requested Dataset when it is in the list', () => {
    expect(
      resolveDatasetDeepLinkSelection({
        datasets: listed,
        requestedDatasetId: 'd-active-2',
        requestedLifecycle: undefined,
        summariesLoaded: true,
      }),
    ).toEqual({ selectedDatasetId: 'd-active-2', flipToArchived: false })
  })

  it('holds the requested Dataset while its lifecycle is still resolving', () => {
    // The requested ID is absent from the active-only list, but the lookup
    // has not answered yet: falling back now could select the wrong object.
    expect(
      resolveDatasetDeepLinkSelection({
        datasets: listed,
        requestedDatasetId: 'd-archived',
        requestedLifecycle: undefined,
        summariesLoaded: true,
      }),
    ).toEqual({ selectedDatasetId: null, flipToArchived: false })
  })

  it('flips to the archived view for an archived deep-linked Dataset', () => {
    expect(
      resolveDatasetDeepLinkSelection({
        datasets: listed,
        requestedDatasetId: 'd-archived',
        requestedLifecycle: 'archived',
        summariesLoaded: true,
      }),
    ).toEqual({ selectedDatasetId: null, flipToArchived: true })
  })

  it('never selects a different active Dataset for a retired deep link', () => {
    expect(
      resolveDatasetDeepLinkSelection({
        datasets: listed,
        requestedDatasetId: 'd-retired',
        requestedLifecycle: 'retired',
        summariesLoaded: true,
      }),
    ).toEqual({ selectedDatasetId: null, flipToArchived: true })
  })

  it('falls back to the list default only for an unknown Dataset', () => {
    expect(
      resolveDatasetDeepLinkSelection({
        datasets: listed,
        requestedDatasetId: 'd-missing',
        requestedLifecycle: null,
        summariesLoaded: true,
      }),
    ).toEqual({ selectedDatasetId: 'd-active-1', flipToArchived: false })
  })

  it('defaults to the first Dataset when no deep link is present', () => {
    expect(
      resolveDatasetDeepLinkSelection({
        datasets: listed,
        requestedDatasetId: null,
        requestedLifecycle: undefined,
        summariesLoaded: true,
      }),
    ).toEqual({ selectedDatasetId: 'd-active-1', flipToArchived: false })
  })

  it('selects nothing before the summaries list has loaded', () => {
    expect(
      resolveDatasetDeepLinkSelection({
        datasets: [],
        requestedDatasetId: null,
        requestedLifecycle: undefined,
        summariesLoaded: false,
      }),
    ).toEqual({ selectedDatasetId: null, flipToArchived: false })
  })
})

describe('snapshot version reads and keeps (DSET-04.3)', () => {
  it('lists snapshots through dataset_version_list', async () => {
    let request: Request | undefined

    const summary = {
      id: 'v-1',
      label: 'S-1',
      createdAt: '2026-11-10T00:00:00.000Z',
      createdByUserId: 'u-1',
      createdByCredentialId: null,
      createdByName: 'Researcher',
      sourceDatasetRevision: 9,
      rowCount: 12,
      contentHash: 'sha256:abc',
      rowsRemovedAt: null,
      change: { added: 1, removed: 2, changed: 3, flags: 4 },
      retention: {
        reason: 'kept',
        keptUntil: '2028-11-10T00:00:00.000Z',
        policy: { citedYears: 15, uncitedYears: 2 },
      },
      source: null,
      citedBy: {
        signedRevisions: [
          {
            revisionId: 'revision-1',
            signedAt: '2026-11-10T01:00:00.000Z',
            signerUserId: 'u-1',
          },
        ],
        pipelineRuns: [],
        analyses: [],
      },
    } satisfies DatasetVersionSummary

    const client = createDataClient(async (input, init) => {
      request = dataRequest(input, init)

      return Response.json([summary])
    })

    const versions = await listDatasetVersionSummaries(client, 'd-1')
    expect(request?.url).toBe('http://eln.test/api/db/rpc/dataset_version_list')
    expect(request?.method).toBe('POST')
    expect(await request?.json()).toEqual({ p_dataset_id: 'd-1' })
    expect(versions).toEqual([summary])
  })

  it('keeps a snapshot through keep_dataset_version with a trimmed reason', async () => {
    let request: Request | undefined

    const client = createDataClient(async (input, init) => {
      request = dataRequest(input, init)

      return Response.json({})
    })

    await keepDatasetVersion(client, 'v-1', '  Still needed  ')
    expect(request?.url).toBe('http://eln.test/api/db/rpc/keep_dataset_version')
    expect(request?.method).toBe('POST')
    expect(await request?.json()).toEqual({
      p_version_id: 'v-1',
      p_reason: 'Still needed',
    })
  })
})
