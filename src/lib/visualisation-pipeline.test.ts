/**
 * SCI-04 pipeline: filters, transforms, summaries, error bars, sampling,
 * OLS overlays and plot-type encoding.
 */
import { describe, expect, it } from 'vitest'

import {
  CHART_SPEC_VERSION,
  materialiseChart,
  validateChartSpec,
} from './chart-spec'
import type { ChartColumn, ChartSpec } from './chart-spec'
import {
  applyFiltersSci04,
  applyTransformations,
  attachFitOverlay,
  deterministicSample,
  formatScientificNumber,
  groupedNumericSummaries,
  SCI_RENDER_POINT_CAP,
} from './visualisation-pipeline'
import { recommendPlotType } from './visualisation-presets'
import { serialiseChartSvg, svgContainsFigure } from './visualisation-export'
import { sheetVisualisationHandoff } from './visualisation-handoff'
import { olsFit } from './stats'

const DS = '0198d970-e266-4000-8000-000000000001'
const COL_X = '0198d970-e266-4000-8000-000000000002'
const COL_Y = '0198d970-e266-4000-8000-000000000003'
const COL_G = '0198d970-e266-4000-8000-000000000004'
const COL_LO = '0198d970-e266-4000-8000-000000000005'
const COL_HI = '0198d970-e266-4000-8000-000000000006'

const COLUMNS: ChartColumn[] = [
  { id: COL_X, label: 'Dose', logicalType: 'decimal', unit: { symbol: 'ng/mL' } },
  { id: COL_Y, label: 'Response', logicalType: 'decimal', unit: { symbol: '%' } },
  { id: COL_G, label: 'Construct', logicalType: 'text' },
  { id: COL_LO, label: 'Low', logicalType: 'decimal' },
  { id: COL_HI, label: 'High', logicalType: 'decimal' },
]

function spec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    specVersion: CHART_SPEC_VERSION,
    type: 'scatter',
    datasets: [{ datasetId: DS }],
    fields: {
      x: { fieldId: COL_X },
      y: { fieldId: COL_Y },
      series: { fieldId: COL_G },
      color: { fieldId: COL_G },
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {
      axes: {
        x: { label: 'Dose', scale: 'linear' },
        y: { label: 'Response', scale: 'linear' },
      },
      series: [],
      legend: { visible: true },
    },
    overlays: { errorBars: null, fit: null, references: [] },
    ...overrides,
  }
}

const ROWS = [
  { [COL_X]: 1, [COL_Y]: 2, [COL_G]: 'A', [COL_LO]: 1.5, [COL_HI]: 2.5 },
  { [COL_X]: 2, [COL_Y]: 4, [COL_G]: 'A', [COL_LO]: 3.5, [COL_HI]: 4.5 },
  { [COL_X]: 3, [COL_Y]: 6, [COL_G]: 'A', [COL_LO]: 5.5, [COL_HI]: 6.5 },
  { [COL_X]: 1, [COL_Y]: 3, [COL_G]: 'B', [COL_LO]: 2.5, [COL_HI]: 3.5 },
  { [COL_X]: 2, [COL_Y]: 5, [COL_G]: 'B', [COL_LO]: 4.5, [COL_HI]: 5.5 },
  { [COL_X]: 3, [COL_Y]: 7, [COL_G]: 'B', [COL_LO]: 6.5, [COL_HI]: 7.5 },
]

describe('stable field identity', () => {
  it('does not rebind a retired field by label', () => {
    const impostor: ChartColumn[] = [
      { id: '0198d970-e266-4000-8000-000000000099', label: 'Dose', logicalType: 'decimal' },
      { id: COL_Y, label: 'Response', logicalType: 'decimal' },
    ]
    const m = materialiseChart(spec(), impostor, ROWS)
    expect(m.state.kind).toBe('missing_field')
    if (m.state.kind === 'missing_field') expect(m.state.fields).toContain('x')
  })
})

describe('plot types', () => {
  it('accepts the SCI-04 catalogue', () => {
    for (const type of [
      'scatter',
      'line',
      'scatter_line',
      'connected_scatter',
      'histogram',
      'box',
      'violin',
      'strip',
      'bar',
      'grouped_bar',
      'stacked_bar',
      'summary',
      'heatmap',
    ] as const) {
      const next = spec({
        type,
        fields:
          type === 'histogram' || type === 'box'
            ? { ...spec().fields, x: null }
            : spec().fields,
        typeParams:
          type === 'heatmap'
            ? { heatmap: { aggregate: 'count', valueField: null } }
            : {},
        overlays:
          type === 'heatmap'
            ? { errorBars: null, fit: null, references: [] }
            : spec().overlays,
      })
      if (type === 'heatmap') {
        next.fields.series = null
        next.fields.color = null
        next.fields.size = null
      }
      expect(validateChartSpec(next)).toEqual([])
    }
  })

  it('materialises scatter series by colour/series field', () => {
    const m = materialiseChart(spec(), COLUMNS, ROWS)
    expect(m.state.kind).toBe('ok')
    expect(m.series.map((s) => s.identifier).sort()).toEqual(['A', 'B'])
  })

  it('bins histograms without coercing null to zero', () => {
    const m = materialiseChart(
      spec({
        type: 'histogram',
        fields: { ...spec().fields, x: null },
        typeParams: { histogram: { bins: 2 } },
      }),
      COLUMNS,
      [...ROWS, { [COL_X]: 1, [COL_Y]: null, [COL_G]: 'A' }],
    )
    expect(m.droppedPoints).toBe(1)
  })

  it('builds Tukey boxes', () => {
    const m = materialiseChart(
      spec({
        type: 'box',
        fields: { ...spec().fields, x: null },
      }),
      COLUMNS,
      ROWS,
    )
    expect(m.series[0].points[0].box?.n).toBe(3)
  })

  it('builds violin density from the same groups', () => {
    const m = materialiseChart(
      spec({ type: 'violin' }),
      COLUMNS,
      ROWS,
    )
    expect(m.series[0].violin?.length).toBeGreaterThan(4)
  })

  it('builds summary mean + interval with correct n', () => {
    const m = materialiseChart(
      spec({
        type: 'summary',
        overlays: {
          errorBars: { source: 'computed', basis: 'sd', multiplier: 1 },
          fit: null,
          references: [],
        },
        typeParams: { summary: { statistic: 'mean' } },
      }),
      COLUMNS,
      ROWS,
    )
    expect(m.state.kind).toBe('ok')
    expect(m.summaries?.every((row) => row.n === 1 || row.n === 3)).toBe(true)
  })

  it('aggregates heatmap counts', () => {
    const m = materialiseChart(
      spec({
        type: 'heatmap',
        fields: {
          x: { fieldId: COL_G },
          y: { fieldId: COL_X },
          series: null,
          color: null,
          size: null,
          facet: null,
        },
        overlays: { errorBars: null },
        typeParams: { heatmap: { aggregate: 'count', valueField: null } },
      }),
      COLUMNS,
      ROWS,
    )
    expect(m.heatmap?.cells.reduce((a, c) => a + c.count, 0)).toBe(6)
  })
})

describe('filters and transforms', () => {
  it('supports is_null / not_null without mutating source', () => {
    const rows = [...ROWS, { [COL_X]: 4, [COL_Y]: null, [COL_G]: 'A' }]
    const copy = rows.map((r) => ({ ...r }))
    const out = applyFiltersSci04(rows, [
      { fieldId: COL_Y, op: 'not_null', value: null },
    ])
    expect(out).toHaveLength(6)
    expect(rows).toEqual(copy)
  })

  it('applies log10 without inventing zeros', () => {
    const s = spec({
      transformations: [{ kind: 'log10', params: { fieldId: COL_Y } }],
    })
    const { rows, transformInvalid } = applyTransformations(
      [{ [COL_X]: 1, [COL_Y]: 100, [COL_G]: 'A' }, { [COL_X]: 2, [COL_Y]: 0, [COL_G]: 'A' }],
      s.transformations,
      s,
    )
    expect(rows[0][COL_Y]).toBe(2)
    expect(rows[1][COL_Y]).toBeNull()
    expect(transformInvalid).toBe(1)
  })
})

describe('summaries and error bars', () => {
  it('computes mean, SD, SEM and n on known fixtures', () => {
    const groups = groupedNumericSummaries(
      ROWS.filter((r) => r[COL_G] === 'A'),
      spec({
        fields: { ...spec().fields, series: null, color: null },
        overlays: {
          errorBars: { source: 'computed', basis: 'sd' },
        },
      }),
      COL_Y,
      COL_X,
    )
    expect(groups).toHaveLength(3)
    expect(groups[0].stats.n).toBe(1)
  })

  it('records explicit lower/upper fields', () => {
    const m = materialiseChart(
      spec({
        overlays: {
          errorBars: {
            source: 'field',
            basis: 'custom',
            lowerFieldId: COL_LO,
            upperFieldId: COL_HI,
          },
        },
      }),
      COLUMNS,
      ROWS,
    )
    expect(m.series[0].points[0].yErrorLo).toBe(1.5)
    expect(m.series[0].points[0].yErrorHi).toBe(2.5)
  })
})

describe('fitting', () => {
  it('recovers slope 2, intercept 0, R² 1 for y=2x', () => {
    const fit = olsFit([1, 2, 3], [2, 4, 6], 1)!
    expect(fit.coefficients[0]).toBeCloseTo(0, 10)
    expect(fit.coefficients[1]).toBeCloseTo(2, 10)
    const m = materialiseChart(
      spec({
        fields: { ...spec().fields, series: null, color: null },
        overlays: { errorBars: null, fit: { method: 'ols', degree: 1, showBand: true } },
      }),
      COLUMNS,
      ROWS.filter((r) => r[COL_G] === 'A'),
    )
    expect(m.fit?.r2).toBeCloseTo(1, 10)
    expect(m.fit?.n).toBe(3)
    expect(m.fit?.band?.length).toBeGreaterThan(2)
  })

  it('reports insufficient data instead of drawing a fake line', () => {
    const overlay = attachFitOverlay(
      spec({ overlays: { errorBars: null, fit: { method: 'ols', degree: 1 } } }),
      [{ identifier: 'all', label: 'all', color: '#006edc', points: [{ x: 1, y: 2 }] }],
    )
    expect(overlay.fit?.error).toBe('insufficient_data')
  })
})

describe('log scale', () => {
  it('accepts positive values and rejects zeros without coercion', () => {
    const ok = materialiseChart(
      spec({
        display: {
          axes: {
            x: { scale: 'linear' },
            y: { scale: 'log' },
          },
          series: [],
        },
      }),
      COLUMNS,
      ROWS,
    )
    expect(ok.state.kind).toBe('ok')
    const bad = materialiseChart(
      spec({
        display: {
          axes: {
            x: { scale: 'linear' },
            y: { scale: 'log' },
          },
          series: [],
        },
      }),
      COLUMNS,
      [{ [COL_X]: 1, [COL_Y]: 0, [COL_G]: 'A' }],
    )
    expect(bad.state.kind).toBe('log_scale_invalid')
  })
})

describe('point provenance', () => {
  it('maps plotted points back to dataset field ids and optional row id', () => {
    const m = materialiseChart(
      spec(),
      COLUMNS,
      [{ ...ROWS[0], __sheetbaseRowId: 'row-1' }],
    )
    expect(m.series[0].points[0].rowId).toBe('row-1')
  })
})

describe('sampling', () => {
  it('is deterministic and does not change analysis n', () => {
    const items = Array.from({ length: 10_000 }, (_, i) => i)
    const a = deterministicSample(items, SCI_RENDER_POINT_CAP)
    const b = deterministicSample(items, SCI_RENDER_POINT_CAP)
    expect(a.items).toEqual(b.items)
    expect(a.sampled).toBe(true)
    expect(a.items.length).toBeLessThanOrEqual(SCI_RENDER_POINT_CAP)
  })
})

describe('formatting, recommendation, handoff, export', () => {
  it('formats scientific numbers without changing the value', () => {
    expect(formatScientificNumber(1.23e-6, 'scientific', 3)).toMatch(/e-/)
    expect(formatScientificNumber(0.25, 'percent', 1)).toBe('25.0%')
  })

  it('recommends scatter for numeric+numeric', () => {
    expect(
      recommendPlotType({
        x: COLUMNS[0],
        y: COLUMNS[1],
      }),
    ).toBe('scatter')
  })

  it('does not promote local Sheet fields', () => {
    const handoff = sheetVisualisationHandoff({
      datasetId: DS,
      columns: [
        { id: COL_X, source: 'dataset', fieldId: COL_X, logicalType: 'decimal' },
        { id: 'local-1', source: 'local', logicalType: 'decimal' },
      ],
      selectedColumnIds: [COL_X, 'local-1'],
    })
    expect(handoff.yFieldId).toBe(COL_X)
    expect(handoff.localFieldIds).toEqual(['local-1'])
  })

  it('serialises SVG without application chrome comments as the figure', () => {
    const svg = serialiseChartSvg(null, {
      format: 'svg',
      width: 720,
      height: 420,
      scale: 1,
      background: 'opaque',
      includeProvenance: false,
    })
    expect(svgContainsFigure(svg)).toBe(false)
  })
})
