/**
 * COMP-07 — mapping tests from the ELN's ADR-0029 materialised chart to the
 * `sheetbase-explorer` v3 figure. One case per chart type: what the package
 * can draw (series, markers, lines, bars, boxes, heat cells, reference lines,
 * axes) and what it cannot.
 */
import { describe, expect, it } from 'vitest'

import {
  buildPackageChartSpec,
  buildPackageDataset,
  buildPackageFigure,
  figureCategoryToPx,
  figureValueToPx,
  PACKAGE_FIGURE_TYPES,
  PACKAGE_UNSUPPORTED_TYPES,
  packageBarLayout,
  supportsPackageFigure,
  toPackageReferenceLines,
} from './chart-package'
import type {
  ChartSpec,
  ChartType,
  MaterialisedChart,
  MaterialisedSeries,
} from './chart-spec'

function makeSpec(
  type: ChartType,
  overrides: Partial<ChartSpec> = {},
): ChartSpec {
  return {
    specVersion: 1,
    type,
    datasets: [{ datasetId: '00000000-0000-4000-8000-000000000170' }],
    fields: {
      x: { fieldId: 'c1' },
      y: { fieldId: 'c2' },
      series: { fieldId: 'c3' },
      color: null,
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {
      axes: {
        x: { label: 'Time', scale: 'linear', unit: 'd' },
        y: { label: 'Titre', scale: 'linear', unit: 'log10' },
      },
      series: [],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
    ...overrides,
  }
}

function series(
  identifier: string,
  points: Array<{ x: number | null; y: number | null }>,
  extra: Partial<MaterialisedSeries> = {},
): MaterialisedSeries {
  return {
    identifier,
    label: identifier,
    color: 'var(--series-a)',
    points: points.map((p) => ({ ...p, yError: null, label: identifier })),
    ...extra,
  }
}

function materialised(seriesList: MaterialisedSeries[]): MaterialisedChart {
  return {
    state: { kind: 'ok' },
    columns: [],
    rows: [],
    series: seriesList,
    xLabel: 'Time',
    yLabel: 'Titre',
    xUnit: 'd',
    yUnit: 'log10',
    droppedPoints: 0,
  }
}

function twoSeries(): MaterialisedChart {
  return materialised([
    series('A', [
      { x: 0, y: 1 },
      { x: 1, y: 2 },
    ]),
    series('B', [
      { x: 0, y: 3 },
      { x: 1, y: 4 },
    ]),
  ])
}

describe('supportsPackageFigure', () => {
  it('accepts every ELN chart type', () => {
    for (const type of PACKAGE_FIGURE_TYPES) {
      expect(supportsPackageFigure(type)).toBe(true)
    }
    for (const type of PACKAGE_UNSUPPORTED_TYPES) {
      expect(supportsPackageFigure(type)).toBe(false)
    }
  })

  it('has a v3 primitive for every ELN chart type', () => {
    expect(PACKAGE_UNSUPPORTED_TYPES).toEqual([])
  })

  it('returns null only when there are no materialised rows to bin or plot', () => {
    const chart = materialised([series('A', [{ x: 0, y: 1 }])])
    expect(buildPackageFigure(makeSpec('histogram'), chart)).toBeNull()
    expect(buildPackageFigure(makeSpec('violin'), chart)).toBeNull()
  })
})

describe('buildPackageDataset', () => {
  it('emits one row per plottable point and drops null positions', () => {
    const dataset = buildPackageDataset(
      makeSpec('line'),
      materialised([
        series('A', [
          { x: 0, y: 1 },
          { x: 1, y: null },
          { x: null, y: 3 },
          { x: 2, y: 4 },
        ]),
        series('B', [{ x: 0, y: 5 }]),
      ]),
    )
    expect(dataset.rows).toHaveLength(3)
    expect(dataset.columns.map((c) => c.key)).toEqual([
      '__x',
      '__y',
      '__series',
    ])
  })

  it('dedupes bars to the first value per (series, category), sorted by category', () => {
    const dataset = buildPackageDataset(
      makeSpec('bar'),
      materialised([
        series('A', [
          { x: 2, y: 3 },
          { x: 1, y: 2 },
          { x: 1, y: 9 },
        ]),
      ]),
    )
    expect(dataset.rows).toEqual([
      { __x: 1, __y: 2, __series: 'A' },
      { __x: 2, __y: 3, __series: 'A' },
    ])
  })

  it('builds box rows from the materialised rows, labelled by series', () => {
    const chart: MaterialisedChart = {
      ...materialised([]),
      rows: [
        { c2: 1, c3: 'A' },
        { c2: 2, c3: 'A' },
        { c2: 3, c3: 'A' },
        { c2: 10, c3: 'B' },
      ],
      series: [
        series('A', [{ x: 1, y: 2 }], { label: 'Alpha' }),
        series('B', [{ x: 2, y: 10 }], { label: 'Beta' }),
      ],
    }
    const dataset = buildPackageDataset(makeSpec('box'), chart)
    expect(dataset.columns.map((c) => c.key)).toEqual(['__category', '__y'])
    expect(dataset.rows).toEqual([
      { __category: 'Alpha', __y: 1 },
      { __category: 'Alpha', __y: 2 },
      { __category: 'Alpha', __y: 3 },
      { __category: 'Beta', __y: 10 },
    ])
  })

  it('builds histogram rows from the raw observations, grouped by series', () => {
    const chart: MaterialisedChart = {
      ...materialised([]),
      rows: [
        { c2: 70, c3: 'A' },
        { c2: 80, c3: 'A' },
        { c2: 80, c3: 'A' },
        { c2: 90, c3: 'B' },
      ],
      series: [series('A', []), series('B', [])],
    }
    const dataset = buildPackageDataset(makeSpec('histogram'), chart)
    expect(dataset.columns.map((c) => c.key)).toEqual(['__x', '__series'])
    expect(dataset.rows).toEqual([
      { __x: 70, __series: 'A' },
      { __x: 80, __series: 'A' },
      { __x: 80, __series: 'A' },
      { __x: 90, __series: 'B' },
    ])
  })

  it('builds violin rows from the raw observations, labelled by series', () => {
    const chart: MaterialisedChart = {
      ...materialised([]),
      rows: [
        { c2: 1, c3: 'A' },
        { c2: 2, c3: 'A' },
        { c2: 10, c3: 'B' },
      ],
      series: [
        series('A', [], { label: 'Alpha' }),
        series('B', [], { label: 'Beta' }),
      ],
    }
    const dataset = buildPackageDataset(makeSpec('violin'), chart)
    expect(dataset.columns.map((c) => c.key)).toEqual([
      '__category',
      '__y',
      '__series',
    ])
    expect(dataset.rows).toEqual([
      { __category: 'Alpha', __y: 1, __series: 'A' },
      { __category: 'Alpha', __y: 2, __series: 'A' },
      { __category: 'Beta', __y: 10, __series: 'B' },
    ])
  })

  it('builds heatmap rows from the aggregated grid in label order', () => {
    const chart: MaterialisedChart = {
      ...materialised([]),
      series: [],
      heatmap: {
        xLabels: ['20C', '4C'],
        yLabels: ['0–36'],
        cells: [
          { x: 0, y: 0, value: 2, count: 2 },
          { x: 1, y: 0, value: null, count: 0 },
        ],
        min: 2,
        max: 2,
        aggregate: 'count',
      },
    }
    const dataset = buildPackageDataset(makeSpec('heatmap'), chart)
    expect(dataset.columns.map((c) => c.key)).toEqual(['__x', '__y', '__value'])
    // The empty cell is omitted, never coerced to zero.
    expect(dataset.rows).toEqual([{ __x: '20C', __y: '0–36', __value: 2 }])
  })
})

describe('package figure per chart type', () => {
  it('line: connects and marks every point, with unit-carrying axis titles', () => {
    const figure = buildPackageFigure(makeSpec('line'), twoSeries())
    expect(figure).not.toBeNull()
    expect(figure?.series).toHaveLength(2)
    for (const s of figure?.series ?? []) {
      expect(s.line.length).toBeGreaterThan(1)
      expect(s.markers).toBe(true)
      expect(s.points[0].px).toBeTypeOf('number')
      expect(s.points[0].py).toBeTypeOf('number')
    }
    expect(figure?.x.title).toBe('Time (d)')
    expect(figure?.y.title).toBe('Titre (log10)')
  })

  it('scatter: markers only, no connecting line', () => {
    const figure = buildPackageFigure(makeSpec('scatter'), twoSeries())
    expect(figure?.series.every((s) => s.line.length === 0)).toBe(true)
    expect(figure?.series.every((s) => s.markers)).toBe(true)
  })

  it('connected_scatter: connects like a line', () => {
    const figure = buildPackageFigure(
      makeSpec('connected_scatter'),
      twoSeries(),
    )
    expect(figure?.series.every((s) => s.line.length > 1)).toBe(true)
  })

  it('strip: plotted as unconnected markers', () => {
    const figure = buildPackageFigure(makeSpec('strip'), twoSeries())
    expect(figure?.series.every((s) => s.line.length === 0)).toBe(true)
  })

  it('scatter_line: fitted renderAs=line series keeps its line without markers', () => {
    const chart = materialised([
      series('observed', [
        { x: 0, y: 1 },
        { x: 1, y: 2 },
      ]),
      series(
        'fit',
        [
          { x: 0, y: 1.1 },
          { x: 1, y: 1.9 },
        ],
        { renderAs: 'line' },
      ),
    ])
    const figure = buildPackageFigure(makeSpec('scatter_line'), chart)
    const observed = figure?.series.find((s) => s.id === 'observed')
    const fit = figure?.series.find((s) => s.id === 'fit')
    expect(observed?.line.length).toBe(0)
    expect(observed?.markers).toBe(true)
    expect(fit?.line.length).toBeGreaterThan(1)
    expect(fit?.markers).toBe(false)
  })

  it('bar: one mark per (series, category) with a band x axis', () => {
    const figure = buildPackageFigure(makeSpec('grouped_bar'), twoSeries())
    expect(figure?.bars).toHaveLength(4)
    expect(figure?.x.kind).toBe('band')
    expect(figure?.x.bands?.map((b) => b.value)).toEqual(['0', '1'])
    expect(figure?.legend.map((l) => l.label)).toEqual(['A', 'B'])
  })

  it('stacked_bar: every bar rises from the running total', () => {
    const figure = buildPackageFigure(makeSpec('stacked_bar'), twoSeries())
    expect(figure?.bars).toHaveLength(4)
    // Series A sits on the baseline; series B is stacked above it.
    const firstCategory = figure?.bars?.filter((b) => b.category === '0') ?? []
    expect(firstCategory.some((b) => b.value0 > 0)).toBe(true)
  })

  it('summary: draws the statistic as grouped bars', () => {
    const chart = materialised([
      series('A', [
        { x: 1, y: 2.5 },
        { x: 2, y: 3.5 },
      ]),
    ])
    const figure = buildPackageFigure(makeSpec('summary'), chart)
    expect(figure?.bars).toHaveLength(2)
  })

  it('box: five-number summary per labelled category', () => {
    const chart: MaterialisedChart = {
      ...materialised([]),
      rows: [
        { c2: 1, c3: 'A' },
        { c2: 2, c3: 'A' },
        { c2: 3, c3: 'A' },
        { c2: 4, c3: 'A' },
        { c2: 10, c3: 'B' },
        { c2: 12, c3: 'B' },
      ],
      series: [
        series('A', [{ x: 1, y: 2.5 }], { label: 'Alpha' }),
        series('B', [{ x: 2, y: 11 }], { label: 'Beta' }),
      ],
    }
    const figure = buildPackageFigure(makeSpec('box'), chart)
    expect(figure?.boxes).toHaveLength(2)
    expect(figure?.boxes?.[0].category).toBe('Alpha')
    // Matches the ELN's boxStats (linear quantile) on the same values.
    expect(figure?.boxes?.[0].median).toBe(2.5)
    expect(figure?.x.kind).toBe('band')
    // The design omits the x-axis title for a self-labelling box category.
    expect(figure?.xTitle).toBe('')
  })

  it('heatmap: cells and a discrete scale legend from the package', () => {
    const chart: MaterialisedChart = {
      ...materialised([]),
      series: [],
      heatmap: {
        xLabels: ['20C', '4C'],
        yLabels: ['0–36'],
        cells: [
          { x: 0, y: 0, value: 2, count: 2 },
          { x: 1, y: 0, value: 4, count: 1 },
        ],
        min: 2,
        max: 4,
        aggregate: 'count',
      },
    }
    const figure = buildPackageFigure(makeSpec('heatmap'), chart)
    expect(figure?.heat).toHaveLength(2)
    expect(figure?.heat?.map((c) => c.value)).toEqual([2, 4])
    expect(figure?.scaleLegend?.min).toBe(2)
    expect(figure?.scaleLegend?.max).toBe(4)
  })

  it('histogram: bins the values with the requested count and a count axis', () => {
    const chart: MaterialisedChart = {
      ...materialised([]),
      rows: [
        { c2: 70, c3: 'A' },
        { c2: 80, c3: 'A' },
        { c2: 80, c3: 'A' },
        { c2: 90, c3: 'B' },
      ],
      series: [series('A', []), series('B', [])],
    }
    const figure = buildPackageFigure(
      makeSpec('histogram', { typeParams: { histogram: { bins: 3 } } }),
      chart,
    )
    expect(figure).not.toBeNull()
    expect(figure?.bins).toHaveLength(3)
    expect(figure?.bars?.length).toBeGreaterThan(0)
    // The measured values ride the numeric x axis; the count axis keeps the
    // package's "Count" default.
    expect(figure?.xTitle).toBe('Titre (log10)')
    expect(figure?.yTitle).toBe('Count')
  })

  it('violin: a KDE per series with a box overlay and no x-axis title', () => {
    const chart: MaterialisedChart = {
      ...materialised([]),
      rows: [
        { c2: 1, c3: 'A' },
        { c2: 2, c3: 'A' },
        { c2: 3, c3: 'A' },
        { c2: 4, c3: 'A' },
        { c2: 5, c3: 'A' },
      ],
      series: [series('A', [], { label: 'Alpha' })],
    }
    const figure = buildPackageFigure(makeSpec('violin'), chart)
    expect(figure?.violins).toHaveLength(1)
    expect(figure?.violins?.[0].seriesId).toBe('A')
    expect(figure?.violins?.[0].category).toBe('Alpha')
    expect(figure?.violins?.[0].density.length).toBeGreaterThan(4)
    expect(figure?.xTitle).toBe('')
    expect(figure?.y.title).toBe('Titre (log10)')
  })

  it('honours display.gridlines=false by clearing the model gridlines', () => {
    const on = buildPackageFigure(makeSpec('line'), twoSeries())
    expect(on?.gridlines.length).toBeGreaterThan(0)
    const off = buildPackageFigure(
      makeSpec('line', {
        display: {
          axes: {
            x: { label: 'Time', scale: 'linear' },
            y: { label: 'Titre', scale: 'linear' },
          },
          series: [],
          gridlines: false,
        },
      }),
      twoSeries(),
    )
    expect(off?.gridlines).toEqual([])
  })
})

describe('buildPackageChartSpec', () => {
  it('maps axes, units, domains and scales onto the package spec', () => {
    const spec = makeSpec('line', {
      display: {
        axes: {
          x: { label: 'Time', scale: 'log', unit: 'd', min: 1, max: 100 },
          y: { label: 'Titre', scale: 'linear', max: 9 },
        },
        series: [],
      },
      overlays: {
        errorBars: null,
        references: [
          { kind: 'hline', value: 8, label: 'Target' },
          { kind: 'vline', value: 14, label: 'Day 14' },
          { kind: 'band', axis: 'y', lo: 7, hi: 9, label: 'Spec' },
          { kind: 'identity', label: 'y = x' },
        ],
      },
    })
    const packageSpec = buildPackageChartSpec(spec, materialised([]))
    expect(packageSpec.kind).toBe('line')
    expect(packageSpec.xScale).toBe('log')
    expect(packageSpec.xMin).toBe(1)
    expect(packageSpec.xMax).toBe(100)
    expect(packageSpec.yMax).toBe(9)
    expect(packageSpec.xUnit).toBe('d')
    expect(packageSpec.refLines).toEqual([
      { id: 'ref-0', axis: 'y', value: 8, label: 'Target' },
      { id: 'ref-1', axis: 'x', value: 14, label: 'Day 14' },
    ])
  })

  it('maps scatter-like types to an unconnected figure kind', () => {
    const chart = materialised([])
    expect(buildPackageChartSpec(makeSpec('scatter'), chart).kind).toBe(
      'scatter',
    )
    expect(buildPackageChartSpec(makeSpec('strip'), chart).kind).toBe('scatter')
    expect(buildPackageChartSpec(makeSpec('line'), chart).kind).toBe('line')
  })

  it('maps bar types, bar layout and the mark kinds', () => {
    const chart = materialised([])
    expect(buildPackageChartSpec(makeSpec('grouped_bar'), chart).kind).toBe(
      'bar',
    )
    expect(buildPackageChartSpec(makeSpec('summary'), chart).kind).toBe('bar')
    expect(buildPackageChartSpec(makeSpec('box'), chart).kind).toBe('box')
    expect(buildPackageChartSpec(makeSpec('histogram'), chart).kind).toBe(
      'histogram',
    )
    expect(buildPackageChartSpec(makeSpec('violin'), chart).kind).toBe('violin')
    expect(buildPackageChartSpec(makeSpec('heatmap'), chart).kind).toBe(
      'heatmap',
    )
    expect(packageBarLayout(makeSpec('stacked_bar'))).toBe('stacked')
    expect(packageBarLayout(makeSpec('grouped_bar'))).toBe('grouped')
    expect(
      packageBarLayout(
        makeSpec('bar', { typeParams: { bar: { stacking: 'stacked' } } }),
      ),
    ).toBe('stacked')
  })

  it('maps histogram bins/binWidth and never requests density', () => {
    const bins = buildPackageChartSpec(
      makeSpec('histogram', { typeParams: { histogram: { bins: 25 } } }),
      materialised([]),
    )
    expect(bins.histogramBins).toBe(25)
    expect(bins.histogramBinWidth).toBeUndefined()
    expect(bins.histogramDensity).toBe(false)
    const width = buildPackageChartSpec(
      makeSpec('histogram', { typeParams: { histogram: { binWidth: 5 } } }),
      materialised([]),
    )
    expect(width.histogramBinWidth).toBe(5)
  })
})

describe('figureValueToPx', () => {
  it('maps a linear domain onto the plot rectangle', () => {
    const spec = makeSpec('line', {
      display: {
        axes: {
          x: { label: 'Time', scale: 'linear', min: 0, max: 10 },
          y: { label: 'Titre', scale: 'linear', min: 0, max: 10 },
        },
        series: [],
      },
    })
    const figure = buildPackageFigure(
      spec,
      materialised([
        series('A', [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ]),
      ]),
    )
    expect(figure).not.toBeNull()
    if (!figure) return
    const { plot } = figure
    expect(figureValueToPx(figure, 'y', 'linear', 0)).toBeCloseTo(
      plot.y + plot.height,
      5,
    )
    expect(figureValueToPx(figure, 'y', 'linear', 10)).toBeCloseTo(plot.y, 5)
    expect(figureValueToPx(figure, 'x', 'linear', 0)).toBeCloseTo(plot.x, 5)
    expect(figureValueToPx(figure, 'x', 'linear', 10)).toBeCloseTo(
      plot.x + plot.width,
      5,
    )
  })

  it('maps a log domain by magnitude', () => {
    const spec = makeSpec('line', {
      display: {
        axes: {
          x: { label: 'Time', scale: 'linear', min: 1, max: 100 },
          y: { label: 'Titre', scale: 'log', min: 1, max: 100 },
        },
        series: [],
      },
    })
    const figure = buildPackageFigure(
      spec,
      materialised([
        series('A', [
          { x: 1, y: 1 },
          { x: 100, y: 100 },
        ]),
      ]),
    )
    expect(figure).not.toBeNull()
    if (!figure) return
    const mid = figureValueToPx(figure, 'y', 'log', 10)
    expect(mid).toBeCloseTo(figure.plot.y + figure.plot.height / 2, 4)
  })
})

describe('figureCategoryToPx', () => {
  it('maps a numeric category to its band centre on a bar figure', () => {
    const figure = buildPackageFigure(
      makeSpec('grouped_bar'),
      materialised([
        series('A', [
          { x: 1, y: 2 },
          { x: 2, y: 3 },
          { x: 3, y: 4 },
        ]),
      ]),
    )
    expect(figure).not.toBeNull()
    if (!figure?.x.bands) return
    expect(figureCategoryToPx(figure, 1)).toBeCloseTo(figure.x.bands[0].px, 5)
    expect(figureCategoryToPx(figure, 3)).toBeCloseTo(
      figure.x.bands[figure.x.bands.length - 1].px,
      5,
    )
    expect(figureCategoryToPx(figure, 2)).toBeCloseTo(figure.x.bands[1].px, 5)
  })
})

describe('toPackageReferenceLines', () => {
  it('keeps horizontal and vertical lines and drops bands/identity', () => {
    expect(
      toPackageReferenceLines([
        { kind: 'hline', value: 1, label: 'a' },
        { kind: 'vline', value: 2, label: 'b' },
        { kind: 'band', axis: 'x', lo: 0, hi: 1, label: 'c' },
      ]),
    ).toHaveLength(2)
    expect(toPackageReferenceLines(undefined)).toBeUndefined()
    expect(
      toPackageReferenceLines([{ kind: 'identity', label: 'y = x' }]),
    ).toBeUndefined()
  })
})
