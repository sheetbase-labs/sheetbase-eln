import { describe, expect, it } from 'vitest'

import {
  CHART_PALETTE,
  CHART_SPEC_VERSION,
  applyFilters,
  formatScientific,
  materialiseChart,
  materialiseFacetedCharts,
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
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
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

  it('uses one-based row positions when no X field is mapped', () => {
    const spec = baseSpec({
      fields: { ...baseSpec().fields, x: null, series: null },
    })
    const materialised = materialiseChart(spec, COLUMNS, ROWS)

    expect(materialised.state.kind).toBe('ok')
    expect(materialised.series[0]?.points.map((point) => point.x)).toEqual([
      1, 2, 3, 4,
    ])
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

describe('SCI-01 distribution chart types', () => {
  const DIST_COLUMNS: ChartColumn[] = [
    {
      id: COL_DAYS,
      fieldName: 'col_days',
      label: 'Time (h)',
      logicalType: 'integer',
    },
    {
      id: COL_GCN,
      fieldName: 'col_gcn',
      label: 'Recovery (%)',
      logicalType: 'decimal',
    },
    {
      id: COL_REP,
      fieldName: 'col_rep',
      label: 'Condition',
      logicalType: 'text',
    },
  ]
  const DIST_ROWS = [
    { col_days: 0, col_gcn: 100, col_rep: '4C' },
    { col_days: 24, col_gcn: 97, col_rep: '4C' },
    { col_days: 48, col_gcn: 95, col_rep: '4C' },
    { col_days: 72, col_gcn: 93, col_rep: '4C' },
    { col_days: 0, col_gcn: 88, col_rep: '20C' },
    { col_days: 24, col_gcn: 84, col_rep: '20C' },
    { col_days: 48, col_gcn: 80, col_rep: '20C' },
    { col_days: 72, col_gcn: 70, col_rep: '20C' },
  ]

  function distSpec(overrides: Partial<ChartSpec>): ChartSpec {
    return baseSpec({
      display: {
        axes: {
          x: { label: 'Group', scale: 'linear' },
          y: { label: 'Recovery (%)', scale: 'linear' },
        },
        series: [],
        legend: { visible: true },
        annotations: [],
      },
      ...overrides,
    })
  }

  it('validates per-type field rules', () => {
    // Histograms reject an x mapping.
    const histogram = distSpec({
      type: 'histogram',
      typeParams: { histogram: { bins: 10 } },
      fields: { ...baseSpec().fields, x: null },
    })
    expect(
      validateChartSpec({
        ...histogram,
        fields: {
          ...histogram.fields,
          x: { columnId: COL_DAYS, fieldName: 'col_days' },
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: 'invalid_value',
        field: 'spec.fields.x',
      }),
    )
    expect(validateChartSpec(histogram)).toEqual([])

    // Heatmaps reject series grouping and error overlays but need x + y.
    const heatmap = distSpec({
      type: 'heatmap',
      fields: {
        x: { columnId: COL_REP, fieldName: 'col_rep' },
        y: { columnId: COL_GCN, fieldName: 'col_gcn' },
        series: null,
        color: null,
        size: null,
        facet: null,
      },
      typeParams: {
        heatmap: { aggregate: 'count', valueField: null, xBins: 10, yBins: 10 },
      },
    })
    expect(validateChartSpec(heatmap)).toEqual([])
    expect(
      validateChartSpec({
        ...heatmap,
        overlays: {
          errorBars: {
            columnId: COL_ERR,
            fieldName: 'col_err',
            basis: 'custom',
            multiplier: 1,
          },
        },
      }),
    ).toContainEqual(
      expect.objectContaining({ field: 'spec.overlays.errorBars' }),
    )
    // Non-count aggregation requires an explicit value column.
    expect(
      validateChartSpec({
        ...heatmap,
        typeParams: { heatmap: { aggregate: 'mean', valueField: null } },
      }),
    ).toContainEqual(
      expect.objectContaining({
        field: 'spec.typeParams.heatmap.valueField',
        code: 'missing_field',
      }),
    )

    // Annotations are Cartesian-only and bounded.
    const annotated = distSpec({
      display: {
        axes: {
          x: { label: 'x', scale: 'linear' },
          y: { label: 'y', scale: 'linear' },
        },
        series: [],
        legend: { visible: true },
        annotations: [{ x: 1, y: 2, label: 'peak' }],
      },
    })
    expect(validateChartSpec(annotated)).toEqual([])
    expect(
      validateChartSpec({
        ...annotated,
        type: 'box',
        fields: { ...annotated.fields, x: null },
        typeParams: { box: {} },
      }),
    ).toContainEqual(
      expect.objectContaining({ field: 'spec.display.annotations' }),
    )
  })

  it('bins histograms with shared edges across groups', () => {
    const spec = distSpec({
      type: 'histogram',
      fields: {
        ...baseSpec().fields,
        x: null,
        series: { columnId: COL_REP, fieldName: 'col_rep' },
      },
      typeParams: { histogram: { bins: 3 } },
    })
    const m = materialiseChart(spec, DIST_COLUMNS, DIST_ROWS)
    expect(m.state.kind).toBe('ok')
    expect(m.bins?.edges.map((e) => Math.round(e))).toEqual([70, 80, 90, 100])
    const byKey = Object.fromEntries(
      m.series.map((s) => [s.identifier, s.points.map((p) => p.y)]),
    )
    expect(byKey['4C']).toEqual([0, 0, 4])
    expect(byKey['20C']).toEqual([1, 3, 0])
    expect(m.droppedPoints).toBe(0)
  })

  it('counts dropped non-numeric values instead of binning them as zero', () => {
    const spec = distSpec({
      type: 'histogram',
      fields: { ...baseSpec().fields, x: null },
      typeParams: { histogram: { bins: 2 } },
    })
    const m = materialiseChart(spec, DIST_COLUMNS, [
      { col_days: 0, col_gcn: 1, col_rep: '4C' },
      { col_days: 0, col_gcn: 'oops', col_rep: '4C' },
      { col_days: 0, col_gcn: null, col_rep: '4C' },
    ])
    expect(m.droppedPoints).toBe(2)
  })

  it('computes Tukey box statistics with linear-interpolation quartiles', () => {
    const spec = distSpec({
      type: 'box',
      fields: {
        ...baseSpec().fields,
        x: null,
        series: { columnId: COL_REP, fieldName: 'col_rep' },
      },
      typeParams: { box: { showOutliers: true } },
    })
    const m = materialiseChart(spec, DIST_COLUMNS, DIST_ROWS)
    const byKey = Object.fromEntries(
      m.series.map((s) => [s.identifier, s.points[0].box]),
    )
    expect(byKey['4C']).toMatchObject({
      lo: 93,
      q1: 94.5,
      median: 96,
      q3: 97.75,
      hi: 100,
      n: 4,
    })
    expect(byKey['20C']).toMatchObject({
      lo: 70,
      q1: 77.5,
      median: 82,
      q3: 85,
      hi: 88,
      n: 4,
    })
    expect(m.series[0].points[0].x).toBe(1)
  })

  it('flags outliers outside the 1.5×IQR fences', () => {
    const spec = distSpec({
      type: 'box',
      fields: {
        ...baseSpec().fields,
        x: null,
        series: { columnId: COL_REP, fieldName: 'col_rep' },
      },
      typeParams: {},
    })
    const rows = [...DIST_ROWS, { col_days: 96, col_gcn: 10, col_rep: '4C' }]
    const m = materialiseChart(spec, DIST_COLUMNS, rows)
    const box4c = m.series.find((s) => s.identifier === '4C')!.points[0].box!
    expect(box4c.outliers).toEqual([10])
    expect(box4c.n).toBe(5)
  })

  it('aggregates heatmaps into labelled count grids', () => {
    const spec = distSpec({
      type: 'heatmap',
      fields: {
        x: { columnId: COL_REP, fieldName: 'col_rep' },
        y: { columnId: COL_DAYS, fieldName: 'col_days' },
        series: null,
        color: null,
        size: null,
        facet: null,
      },
      typeParams: {
        heatmap: { aggregate: 'count', valueField: null, yBins: 2 },
      },
    })
    const m = materialiseChart(spec, DIST_COLUMNS, DIST_ROWS)
    expect(m.state.kind).toBe('ok')
    expect(m.heatmap).toBeDefined()
    expect(m.heatmap!.xLabels).toEqual(['20C', '4C'])
    expect(m.heatmap!.yLabels).toHaveLength(2)
    expect(m.heatmap!.cells.every((c) => c.value === 2)).toBe(true)
    expect(m.heatmap!.min).toBe(2)
    expect(m.heatmap!.max).toBe(2)
    expect(m.series).toEqual([])
  })

  it('facets charts into sorted small multiples with an honest total', () => {
    const spec = distSpec({
      fields: {
        ...baseSpec().fields,
        x: null,
        facet: { columnId: COL_REP, fieldName: 'col_rep' },
      },
      typeParams: { box: {} },
      type: 'box',
    })
    const result = materialiseFacetedCharts(spec, DIST_COLUMNS, DIST_ROWS)
    expect(result.total).toBe(2)
    expect(result.panels.map((p) => p.value)).toEqual(['20C', '4C'])
    for (const panel of result.panels) {
      expect(panel.chart.state.kind).toBe('ok')
      expect(panel.chart.series).toHaveLength(1)
    }
  })
})
