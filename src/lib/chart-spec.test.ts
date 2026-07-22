import { describe, expect, it } from 'vitest'

import {
  CHART_PALETTE,
  CHART_SPEC_VERSION,
  applyFilters,
  formatScientific,
  materialiseChart,
  validateChartPayload,
  validateChartSpec,
} from './chart-spec'
import type { ChartColumn, ChartSpec } from './chart-spec'

const TABLE_ID = '0198d970-e266-4000-8000-000000000001'
const COL_DAYS = '0198d970-e266-4000-8000-000000000002'
const COL_GCN = '0198d970-e266-4000-8000-000000000003'
const COL_REP = '0198d970-e266-4000-8000-000000000004'
const COL_ERR = '0198d970-e266-4000-8000-000000000005'

function baseSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    specVersion: CHART_SPEC_VERSION,
    type: 'line',
    datasets: [{ tableId: TABLE_ID }],
    fields: {
      x: { columnId: COL_DAYS, fieldName: 'col_days' },
      y: { columnId: COL_GCN, fieldName: 'col_gcn' },
      series: null,
      color: null,
      size: null,
    },
    filters: [],
    transformations: [],
    display: {
      axes: {
        x: { label: 'Time (days)', scale: 'linear', unit: 'd' },
        y: { label: 'GCN per mL', scale: 'log', unit: 'copies/mL' },
      },
      series: [],
      legend: { visible: true },
      annotations: [],
    },
    overlays: { errorBars: null },
    ...overrides,
  }
}

const COLUMNS: ChartColumn[] = [
  {
    id: COL_DAYS,
    fieldName: 'col_days',
    label: 'Time (days)',
    logicalType: 'integer',
    unit: { symbol: 'd' },
  },
  {
    id: COL_GCN,
    fieldName: 'col_gcn',
    label: 'GCN per mL',
    logicalType: 'decimal',
    unit: { symbol: 'copies/mL' },
  },
  {
    id: COL_REP,
    fieldName: 'col_rep',
    label: 'Replicate',
    logicalType: 'text',
  },
  { id: COL_ERR, fieldName: 'col_err', label: 'SD', logicalType: 'decimal' },
]

const ROWS = [
  { col_days: 0, col_gcn: 2.31e8, col_rep: 'Rep 1', col_err: 1.2e7 },
  { col_days: 7, col_gcn: 1.8e8, col_rep: 'Rep 1', col_err: 9.0e6 },
  { col_days: 0, col_gcn: 2.25e8, col_rep: 'Rep 2', col_err: 1.1e7 },
  { col_days: 7, col_gcn: 1.72e8, col_rep: 'Rep 2', col_err: 8.5e6 },
]

describe('validateChartSpec', () => {
  it('accepts a valid line spec', () => {
    expect(validateChartSpec(baseSpec())).toEqual([])
  })

  it('accepts a scatter spec without an x field', () => {
    expect(
      validateChartSpec(
        baseSpec({
          type: 'scatter',
          fields: { ...baseSpec().fields, x: null },
        }),
      ),
    ).toEqual([])
  })

  it('rejects a line chart missing the x field', () => {
    const errors = validateChartSpec(
      baseSpec({ fields: { ...baseSpec().fields, x: null } }),
    )
    expect(errors.some((e) => e.field === 'spec.fields.x')).toBe(true)
  })

  it('rejects an unsupported chart type', () => {
    const errors = validateChartSpec(
      baseSpec({ type: 'pie' as unknown as ChartSpec['type'] }),
    )
    expect(errors.some((e) => e.code === 'unsupported_type')).toBe(true)
  })

  it('rejects an unsupported spec version', () => {
    const errors = validateChartSpec(baseSpec({ specVersion: 99 }))
    expect(errors.some((e) => e.code === 'unsupported_spec_version')).toBe(true)
  })

  it('rejects an empty datasets array', () => {
    const errors = validateChartSpec(baseSpec({ datasets: [] }))
    expect(errors.some((e) => e.field === 'spec.datasets')).toBe(true)
  })

  it('rejects a non-UUID dataset tableId', () => {
    const errors = validateChartSpec(
      baseSpec({ datasets: [{ tableId: 'not-a-uuid' }] }),
    )
    expect(errors.some((e) => e.code === 'invalid_dataset_reference')).toBe(
      true,
    )
  })

  it('rejects a series colour outside the approved palette', () => {
    const errors = validateChartSpec(
      baseSpec({
        display: {
          ...baseSpec().display,
          series: [{ identifier: 'Rep 1', label: 'Rep 1', color: '#FF00FF' }],
        },
      }),
    )
    expect(errors.some((e) => e.code === 'invalid_palette')).toBe(true)
  })

  it('accepts a palette colour case-insensitively', () => {
    const errors = validateChartSpec(
      baseSpec({
        display: {
          ...baseSpec().display,
          series: [{ identifier: 'Rep 1', label: 'Rep 1', color: '#006edc' }],
        },
      }),
    )
    expect(errors).toEqual([])
  })

  it('rejects error bars without a basis', () => {
    const errors = validateChartSpec(
      baseSpec({
        overlays: {
          errorBars: {
            columnId: COL_ERR,
            fieldName: 'col_err',
            basis: 'magic' as unknown as never,
          },
        },
      }),
    )
    expect(errors.some((e) => e.field === 'spec.overlays.errorBars')).toBe(true)
  })

  it('rejects a missing y field binding', () => {
    const errors = validateChartSpec(
      baseSpec({
        fields: {
          ...baseSpec().fields,
          y: null as unknown as ChartSpec['fields']['y'],
        },
      }),
    )
    expect(errors.some((e) => e.field === 'spec.fields.y')).toBe(true)
  })
})

describe('validateChartPayload', () => {
  it('accepts an empty draft payload', () => {
    expect(validateChartPayload({})).toEqual([])
  })

  it('rejects a payload missing a title', () => {
    const errors = validateChartPayload({ spec: baseSpec() })
    expect(errors.some((e) => e.field === 'title')).toBe(true)
  })

  it('rejects a non-object payload', () => {
    expect(
      validateChartPayload('nope').some((e) => e.code === 'invalid_shape'),
    ).toBe(true)
  })
})

describe('applyFilters', () => {
  it('passes all rows when no filters', () => {
    expect(applyFilters(ROWS, [])).toHaveLength(ROWS.length)
  })
  it('filters by a numeric gt predicate', () => {
    const out = applyFilters(ROWS, [
      { columnId: COL_DAYS, fieldName: 'col_days', op: 'gt', value: 0 },
    ])
    expect(out.every((r) => Number(r.col_days) > 0)).toBe(true)
  })
  it('filters by a between predicate', () => {
    const out = applyFilters(ROWS, [
      {
        columnId: COL_GCN,
        fieldName: 'col_gcn',
        op: 'between',
        value: [1.7e8, 1.9e8],
      },
    ])
    expect(
      out.every(
        (r) => Number(r.col_gcn) >= 1.7e8 && Number(r.col_gcn) <= 1.9e8,
      ),
    ).toBe(true)
  })
  it('filters by an eq predicate on text', () => {
    const out = applyFilters(ROWS, [
      { columnId: COL_REP, fieldName: 'col_rep', op: 'eq', value: 'Rep 1' },
    ])
    expect(out.every((r) => r.col_rep === 'Rep 1')).toBe(true)
  })
})

describe('materialiseChart', () => {
  it('groups rows into series by the series field', () => {
    const spec = baseSpec({
      fields: {
        ...baseSpec().fields,
        series: { columnId: COL_REP, fieldName: 'col_rep' },
      },
    })
    const m = materialiseChart(spec, COLUMNS, ROWS)
    expect(m.state.kind).toBe('ok')
    expect(m.series.map((s) => s.identifier).sort()).toEqual(['Rep 1', 'Rep 2'])
    expect(m.series[0].points).toHaveLength(2)
  })

  it('reports a missing_field state when a mapped column is gone', () => {
    const spec = baseSpec()
    const m = materialiseChart(spec, [], ROWS)
    expect(m.state.kind).toBe('missing_field')
    if (m.state.kind === 'missing_field') {
      expect(m.state.fields).toContain('x')
      expect(m.state.fields).toContain('y')
    }
  })

  it('reports an empty_dataset state when filters remove every row', () => {
    const spec = baseSpec({
      filters: [
        { columnId: COL_DAYS, fieldName: 'col_days', op: 'gt', value: 999 },
      ],
    })
    const m = materialiseChart(spec, COLUMNS, ROWS)
    expect(m.state.kind).toBe('empty_dataset')
  })

  it('reports log_scale_invalid when a log axis maps non-positive values', () => {
    const spec = baseSpec({
      display: {
        ...baseSpec().display,
        axes: {
          x: { label: 'Time (days)', scale: 'linear' },
          y: { label: 'GCN per mL', scale: 'log' },
        },
      },
    })
    const rowsWithZero = [
      ...ROWS,
      { col_days: 14, col_gcn: 0, col_rep: 'Rep 1', col_err: 0 },
    ]
    const m = materialiseChart(spec, COLUMNS, rowsWithZero)
    expect(m.state.kind).toBe('log_scale_invalid')
    if (m.state.kind === 'log_scale_invalid') {
      expect(m.state.axis).toBe('y')
      expect(m.state.invalidCount).toBe(1)
    }
  })

  it('attaches error-bar values when overlays.errorBars is set', () => {
    const spec = baseSpec({
      overlays: {
        errorBars: { columnId: COL_ERR, fieldName: 'col_err', basis: 'sd' },
      },
    })
    const m = materialiseChart(spec, COLUMNS, ROWS)
    expect(m.state.kind).toBe('ok')
    expect(m.series[0].points.every((p) => typeof p.yError === 'number')).toBe(
      true,
    )
  })

  it('reports missing_field when an error-bar column is retired', () => {
    const spec = baseSpec({
      overlays: {
        errorBars: { columnId: COL_ERR, fieldName: 'col_err', basis: 'sd' },
      },
    })
    const m = materialiseChart(
      spec,
      COLUMNS.filter((c) => c.id !== COL_ERR),
      ROWS,
    )
    expect(m.state.kind).toBe('missing_field')
    if (m.state.kind === 'missing_field')
      expect(m.state.fields).toContain('errorBars')
  })

  it('uses palette colours in order when display.series is unconfigured', () => {
    const spec = baseSpec({
      fields: {
        ...baseSpec().fields,
        series: { columnId: COL_REP, fieldName: 'col_rep' },
      },
    })
    const m = materialiseChart(spec, COLUMNS, ROWS)
    expect(m.series.map((s) => s.color)).toEqual([
      CHART_PALETTE[0].toLowerCase(),
      CHART_PALETTE[1].toLowerCase(),
    ])
  })
})

describe('formatScientific', () => {
  it('formats large magnitudes with exponential notation', () => {
    expect(formatScientific(2.31e8)).toBe('2.31e8')
  })
  it('formats zero', () => {
    expect(formatScientific(0)).toBe('0')
  })
  it('formats a plain integer', () => {
    expect(formatScientific(7)).toBe('7')
  })
  it('returns a dash for non-finite values', () => {
    expect(formatScientific(null)).toBe('—')
    expect(formatScientific(NaN)).toBe('—')
  })
})
