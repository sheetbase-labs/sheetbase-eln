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
  sanitizeDatasetView,
  validateTransformations,
} from './dataset-explorer-data'
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
    expect(q).toContain('order=col_beta.desc')
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
