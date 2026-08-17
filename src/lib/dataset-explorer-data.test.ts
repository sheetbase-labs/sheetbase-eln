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
  getNextDatasetPageParam,
  fetchDatasetRowPage,
  fetchDatasetSummaries,
  sanitizeDatasetView,
  validateTransformations,
} from './dataset-explorer-data'
import type { DataClient } from './data-client'
import type { DatasetSavedView, DatasetViewSpec } from './dataset-explorer-data'
import type {
  ScientificColumnWire,
  ScientificTableWire,
} from './scientific-sheet-data'

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
    const client = {
      list: async (resource: string) => {
        calls.push(resource)
        if (resource === 'datasets')
          return [
            {
              id: 'd1',
              workspace_id: 'w1',
              schema_version_id: 'v1',
              name: 'Assays',
              description: null,
              lifecycle: 'active',
              revision: 2,
            },
          ]
        return [
          {
            field_id: 'f1',
            schema_version_id: 'v1',
            key: 'ph',
            label: 'pH',
            logical_type: 'decimal',
            nullable: false,
            quantity: null,
            validation: {},
            lifecycle: 'active',
            display_order: 0,
          },
        ]
      },
    } as unknown as DataClient
    const result = await fetchDatasetSummaries(client)
    expect(calls).toEqual([
      'datasets',
      'dataset_schema_version_fields',
      'dataset_schema_versions',
    ])
    expect(result[0].columns[0]).toMatchObject({
      id: 'f1',
      field_name: 'f1',
      label: 'pH',
    })
  })

  it('pages, filters and sorts only through query_dataset_rows', async () => {
    let call: { name: string; args: Record<string, unknown> } | undefined
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        call = { name, args }
        return {
          totalCount: 1,
          rows: [{ rowId: 'r1', revision: 3, values: { f1: 7.2 } }],
        }
      },
    } as unknown as DataClient
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
    expect(call).toEqual({
      name: 'query_dataset_rows',
      args: {
        p_dataset_id: 'd1',
        p_query: {
          filters: [{ fieldId: 'f1', operator: 'eq', value: 7.2 }],
          sort: { fieldId: 'f1', direction: 'desc' },
        },
        p_limit: 25,
        p_offset: 50,
      },
    })
    expect(page).toEqual({
      totalCount: 1,
      rows: [{ id: 'r1', version: 3, f1: 7.2 }],
    })
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
      tableId: 't-1',
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
    expect(spec!.fields.y.columnId).toBe('col-num')
    expect(spec!.fields.x?.columnId).toBe('col-cat')
    expect(spec!.fields.series?.columnId).toBe('col-cat')
    expect(spec!.datasets[0].tableId).toBe(t.id)
  })
})

describe('createDatasetSavedViewStore', () => {
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
      tableId: 't-1',
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
})
