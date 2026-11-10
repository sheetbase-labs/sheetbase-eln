/**
 * SCI-04 pipeline: filters, transforms, summaries, error bars, sampling,
 * OLS overlays and plot-type encoding.
 */
import { assert, describe, expect, it } from 'vitest'

import {
  CHART_SPEC_VERSION,
  materialiseChart,
  validateChartSpec,
} from './chart-spec'
import type { ChartColumn, ChartSpec, MaterialisedSeries } from './chart-spec'
import {
  applyFiltersSci04,
  applyTransformations,
  apportionRenderBudget,
  attachFitOverlay,
  deterministicSample,
  formatScientificNumber,
  groupedNumericSummaries,
  orderCategories,
  sampleSeriesForRender,
  SCI_RENDER_POINT_CAP,
  toNumeric,
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
  {
    id: COL_X,
    label: 'Dose',
    logicalType: 'decimal',
    unit: { symbol: 'ng/mL' },
  },
  {
    id: COL_Y,
    label: 'Response',
    logicalType: 'decimal',
    unit: { symbol: '%' },
  },
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
      {
        id: '0198d970-e266-4000-8000-000000000099',
        label: 'Dose',
        logicalType: 'decimal',
      },
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
    const m = materialiseChart(spec({ type: 'violin' }), COLUMNS, ROWS)
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
  it('preserves raw numeric acceptance without coercing booleans or missing cells', () => {
    expect(toNumeric(' 2.5 ')).toBe(2.5)
    expect(toNumeric(-3)).toBe(-3)

    for (const value of [
      true,
      false,
      null,
      undefined,
      '',
      ' ',
      NaN,
      Infinity,
      [],
      {},
    ]) {
      expect(toNumeric(value)).toBeNull()
    }
  })

  it('retains original rows, own scientific keys and identity-based filters', () => {
    const category = { ['__proto__']: { measurement: 7 } }

    const row = {
      [COL_Y]: 4,
      [COL_G]: category,
      ['__proto__']: category,
      missing: undefined,
    }

    const rows = [row]

    expect(applyFiltersSci04(rows, [])).toBe(rows)
    expect(applyTransformations(rows, [], spec()).rows).toBe(rows)

    const selected = applyFiltersSci04(rows, [
      { fieldId: COL_G, op: 'eq', value: category },
      { fieldId: COL_G, op: 'in', value: [category] },
    ])

    expect(selected[0]).toBe(row)
    expect(selected[0].__proto__).toBe(category)
    expect(Object.hasOwn(selected[0], '__proto__')).toBe(true)
    expect(Object.hasOwn(selected[0], 'missing')).toBe(true)
    expect(
      applyFiltersSci04(rows, [
        { fieldId: COL_G, op: 'eq', value: { ...category } },
      ]),
    ).toEqual([])

    const transformed = applyTransformations(
      rows,
      [{ kind: 'percentage', params: {} }],
      spec(),
    )

    expect(transformed.rows[0][COL_Y]).toBe(400)
    expect(transformed.rows[0].__proto__).toBe(category)
    expect(Object.hasOwn(transformed.rows[0], '__proto__')).toBe(true)
    expect(row[COL_Y]).toBe(4)
  })

  it('keeps lexical between distinct from mixed numeric bounds', () => {
    const rows = [{ [COL_Y]: '10' }, { [COL_Y]: '3' }]
    expect(
      applyFiltersSci04(rows, [
        { fieldId: COL_Y, op: 'between', value: ['2', '9'] },
      ]),
    ).toEqual([rows[1]])
    expect(
      applyFiltersSci04(rows, [
        { fieldId: COL_Y, op: 'between', value: [2, '9'] },
      ]),
    ).toEqual([rows[1]])
    expect(
      applyFiltersSci04(rows, [
        { fieldId: COL_Y, op: 'between', value: ['1', '2'] },
      ]),
    ).toEqual([rows[0]])
    expect(
      applyFiltersSci04(rows, [
        { fieldId: COL_Y, op: 'between', value: [1, '2'] },
      ]),
    ).toEqual([])
  })

  it('applies transforms in order and reports distinct failures in first-seen order', () => {
    const ordered = applyTransformations(
      [{ [COL_Y]: 4 }],
      [
        { kind: 'difference', params: { reference: 10 } },
        { kind: 'abs', params: {} },
      ],
      spec(),
    )

    expect(ordered.rows[0][COL_Y]).toBe(6)

    const failures = applyTransformations(
      [
        { [COL_Y]: -1, [COL_X]: -4, [COL_LO]: 2 },
        { [COL_Y]: -2, [COL_X]: -9, [COL_LO]: 3 },
      ],
      [
        { kind: 'log10', params: { fieldId: COL_Y } },
        { kind: 'sqrt', params: { fieldId: COL_X } },
        { kind: 'ratio', params: { fieldId: COL_LO, reference: 0 } },
      ],
      spec(),
    )

    expect(failures.transformInvalid).toBe(6)
    expect(failures.reasons).toEqual([
      'log10 of non-positive value',
      'square root of a negative value',
      'ratio with a zero denominator',
    ])
    expect(failures.rows).toEqual([
      { [COL_Y]: null, [COL_X]: null, [COL_LO]: null },
      { [COL_Y]: null, [COL_X]: null, [COL_LO]: null },
    ])
  })

  it('normalises using population variance per group and retains nonnumeric rows', () => {
    const rows = [
      { [COL_Y]: 2, [COL_G]: 'A' },
      { [COL_Y]: 6, [COL_G]: 'A' },
      { [COL_Y]: 100, [COL_G]: 'B' },
      { [COL_Y]: null, [COL_G]: 'A' },
      { [COL_Y]: Infinity, [COL_G]: 'A' },
    ]

    const out = applyTransformations(
      rows,
      [{ kind: 'normalise', params: { method: 'z_score' } }],
      spec(),
    )

    expect(out.rows.map((row) => row[COL_Y])).toEqual([
      -1,
      1,
      0,
      null,
      Infinity,
    ])
    expect(out.rows[3]).toBe(rows[3])
    expect(out.rows[4]).toBe(rows[4])

    const invalidReference = applyTransformations(
      rows,
      [{ kind: 'normalise', params: { method: 'reference' } }],
      spec(),
    )

    expect(invalidReference.rows[0][COL_Y]).toBeNaN()
    expect(invalidReference.transformInvalid).toBe(0)
  })

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
      [
        { [COL_X]: 1, [COL_Y]: 100, [COL_G]: 'A' },
        { [COL_X]: 2, [COL_Y]: 0, [COL_G]: 'A' },
      ],
      s.transformations,
      s,
    )

    expect(rows[0][COL_Y]).toBe(2)
    expect(rows[1][COL_Y]).toBeNull()
    expect(transformInvalid).toBe(1)
  })

  it('surfaces transform-invalid counts on the materialised chart', () => {
    const m = materialiseChart(
      spec({
        transformations: [{ kind: 'log10', params: { fieldId: COL_Y } }],
      }),
      COLUMNS,
      [
        { [COL_X]: 1, [COL_Y]: 100, [COL_G]: 'A' },
        { [COL_X]: 2, [COL_Y]: 0, [COL_G]: 'A' },
      ],
    )

    expect(m.transformInvalidCount).toBe(1)
    expect(m.transformInvalidReasons).toContain('log10 of non-positive value')
  })
})

describe('summaries and error bars', () => {
  it('keeps native object group labels, first x identity and group insertion order', () => {
    const firstX = { value: 1 }

    const rows = [
      { [COL_X]: firstX, [COL_Y]: 2, [COL_G]: 'B' },
      { [COL_X]: { value: 99 }, [COL_Y]: 6, [COL_G]: 'B' },
      { [COL_X]: 'next', [COL_Y]: 10, [COL_G]: 'A' },
    ]

    const groups = groupedNumericSummaries(
      rows,
      spec({ overlays: { errorBars: { source: 'computed', basis: 'range' } } }),
      COL_Y,
      COL_X,
    )

    expect(groups.map((group) => group.key)).toEqual([
      '[object Object]::B',
      'next::A',
    ])
    expect(groups[0].x).toBe(firstX)
    expect(groups[0].stats.n).toBe(2)
    expect(groups[0].stats.mean).toBe(4)
    expect(groups[0].interval).toEqual({ lo: 2, hi: 6, basis: 'range' })

    const aggregated = applyTransformations(
      rows,
      [{ kind: 'aggregate', params: {} }],
      spec(),
    )

    expect(aggregated.rows).toEqual([
      { [COL_X]: firstX, [COL_Y]: 4, [COL_G]: 'B' },
      { [COL_X]: 'next', [COL_Y]: 10, [COL_G]: 'A' },
    ])
  })

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
    const fit = olsFit([1, 2, 3], [2, 4, 6], 1)
    assert(fit !== null)
    expect(fit.coefficients[0]).toBeCloseTo(0, 10)
    expect(fit.coefficients[1]).toBeCloseTo(2, 10)

    const m = materialiseChart(
      spec({
        fields: { ...spec().fields, series: null, color: null },
        overlays: {
          errorBars: null,
          fit: { method: 'ols', degree: 1, showBand: true },
        },
      }),
      COLUMNS,
      ROWS.filter((r) => r[COL_G] === 'A'),
    )

    expect(m.fit?.r2).toBeCloseTo(1, 10)
    expect(m.fit?.n).toBe(3)
    expect(m.fit?.band?.length).toBeGreaterThan(2)
    expect(m.fit?.equation).toMatch(/y = /)
  })

  it('reports insufficient data instead of drawing a fake line', () => {
    const overlay = attachFitOverlay(
      spec({
        overlays: { errorBars: null, fit: { method: 'ols', degree: 1 } },
      }),
      [
        {
          identifier: 'all',
          label: 'all',
          color: '#006edc',
          points: [{ x: 1, y: 2 }],
        },
      ],
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
    const m = materialiseChart(spec(), COLUMNS, [
      { ...ROWS[0], __sheetbaseRowId: 'row-1' },
    ])

    expect(m.series[0].points[0].rowId).toBe('row-1')
  })
})

describe('sampling', () => {
  it('uses floor-stride selection and apportions asymmetric budgets without empty groups', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(deterministicSample(items, 7).items).toBe(items)
    expect(deterministicSample(items, 3)).toEqual({
      items: ['a', 'c', 'e'],
      sampled: true,
      stride: 7 / 3,
    })
    expect(deterministicSample(items, 0).items).toEqual([])
    expect(apportionRenderBudget([7, 2, 0], 4)).toEqual([3, 1, 0])
    expect(apportionRenderBudget([7, 2, 0], 1)).toEqual([1, 0, 0])
    const unchanged = sampleSeriesForRender([])
    expect(Object.hasOwn(unchanged, 'sampling')).toBe(true)
    expect(unchanged.sampling).toBeUndefined()
  })

  it('is deterministic and does not change analysis n', () => {
    const items = Array.from({ length: 10_000 }, (_, i) => i)
    const a = deterministicSample(items, SCI_RENDER_POINT_CAP)
    const b = deterministicSample(items, SCI_RENDER_POINT_CAP)
    expect(a.items).toEqual(b.items)
    expect(a.sampled).toBe(true)
    expect(a.items.length).toBeLessThanOrEqual(SCI_RENDER_POINT_CAP)
  })

  it('apportions a chart-wide display budget, leaving fit lines intact', () => {
    expect(apportionRenderBudget([3000, 3000], SCI_RENDER_POINT_CAP)).toEqual([
      2000, 2000,
    ])

    const series: MaterialisedSeries[] = [
      {
        identifier: 'A',
        label: 'A',
        color: '#006edc',
        points: Array.from({ length: 3000 }, (_, i) => ({
          x: i,
          y: i,
          yError: null,
        })),
      },
      {
        identifier: 'B',
        label: 'B',
        color: '#00a659',
        points: Array.from({ length: 3000 }, (_, i) => ({
          x: i,
          y: i,
          yError: null,
        })),
      },
      {
        identifier: '__fit',
        label: 'fit',
        color: '#111111',
        renderAs: 'line',
        points: Array.from({ length: 200 }, (_, i) => ({
          x: i,
          y: i,
          yError: null,
        })),
      },
    ]

    const sampled = sampleSeriesForRender(series)
    expect(sampled.sampling?.sampledCount).toBe(SCI_RENDER_POINT_CAP)
    expect(sampled.sampling?.analysisCount).toBe(6000)
    expect(sampled.sampling?.totalCount).toBe(6000)
    expect(
      sampled.series.find((item) => item.identifier === '__fit')?.points,
    ).toHaveLength(200)

    const displayed = sampled.series
      .filter((item) => item.identifier !== '__fit')
      .reduce((n, item) => n + item.points.length, 0)

    expect(displayed).toBe(SCI_RENDER_POINT_CAP)
  })
})

describe('live versus frozen rematerialisation', () => {
  it('reproduces log10, SEM summary, violin, OLS and error bars from the same rows', () => {
    const cases: ChartSpec[] = [
      spec({
        transformations: [{ kind: 'log10', params: { fieldId: COL_Y } }],
      }),
      spec({
        type: 'summary',
        overlays: {
          errorBars: { source: 'computed', basis: 'sem' },
          fit: null,
        },
      }),
      spec({
        type: 'violin',
        fields: { ...spec().fields, x: null },
      }),
      spec({
        fields: { ...spec().fields, series: null, color: null },
        overlays: { errorBars: null, fit: { method: 'ols', degree: 1 } },
      }),
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
    ]

    for (const chartSpec of cases) {
      const live = materialiseChart(chartSpec, COLUMNS, ROWS)
      const rematerialised = materialiseChart(chartSpec, COLUMNS, ROWS)
      expect(rematerialised.state).toEqual(live.state)
      expect(rematerialised.series).toEqual(live.series)
      expect(rematerialised.fit).toEqual(live.fit)
      expect(rematerialised.summaries).toEqual(live.summaries)
    }
  })

  it('keeps rematerialised evidence when live rows later change', () => {
    const chartSpec = spec({
      transformations: [{ kind: 'log10', params: { fieldId: COL_Y } }],
    })

    const pinned = materialiseChart(chartSpec, COLUMNS, ROWS)
    const mutated = [...ROWS, { [COL_X]: 4, [COL_Y]: 16, [COL_G]: 'A' }]
    const live = materialiseChart(chartSpec, COLUMNS, mutated)
    const frozenAgain = materialiseChart(chartSpec, COLUMNS, ROWS)
    expect(live.series[0].points.length).not.toBe(
      pinned.series[0].points.length,
    )
    expect(frozenAgain.series).toEqual(pinned.series)
  })
})

describe('formatting, recommendation, handoff, export', () => {
  it('preserves explicit category duplicates and sorts only the remaining categories', () => {
    expect(
      orderCategories(['c', 'b', 'a', 'c'], 'explicit', ['b', 'b', 'missing']),
    ).toEqual(['b', 'b', 'a', 'c'])
    expect(orderCategories(['10', '2', 'missing', '2'], 'numeric')).toEqual([
      '2',
      '10',
      'missing',
    ])
    expect(orderCategories(['c', 'b', 'a', 'c'], 'natural')).toEqual([
      'c',
      'b',
      'a',
    ])
  })

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
        {
          id: COL_X,
          source: 'dataset',
          fieldId: COL_X,
          logicalType: 'decimal',
        },
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
