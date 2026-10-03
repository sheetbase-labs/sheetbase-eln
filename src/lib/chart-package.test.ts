/**
 * COMP-07 — mapping tests from the ELN's ADR-0029 materialised chart to the
 * `sheetbase-explorer` v3 figure. One case per chart type: what the package
 * can draw (series, markers, lines, reference lines, axes) and what it cannot.
 */
import { describe, expect, it } from 'vitest'

import {
  buildPackageChartSpec,
  buildPackageDataset,
  buildPackageFigure,
  figureValueToPx,
  PACKAGE_FIGURE_TYPES,
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

describe('supportsPackageFigure', () => {
  it('accepts the point/line types and rejects mark shapes with no figure primitive', () => {
    for (const type of PACKAGE_FIGURE_TYPES) {
      expect(supportsPackageFigure(type)).toBe(true)
    }
    for (const type of [
      'bar',
      'grouped_bar',
      'stacked_bar',
      'histogram',
      'box',
      'violin',
      'summary',
      'heatmap',
    ] satisfies ChartType[]) {
      expect(supportsPackageFigure(type)).toBe(false)
    }
  })

  it('returns null for a type the package cannot express', () => {
    const chart = materialised([series('A', [{ x: 0, y: 1 }])])
    expect(buildPackageFigure(makeSpec('bar'), chart)).toBeNull()
  })
})

describe('buildPackageDataset', () => {
  it('emits one row per plottable point and drops null positions', () => {
    const dataset = buildPackageDataset(
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
})

describe('package figure per chart type', () => {
  const twoSeries = () =>
    materialised([
      series('A', [
        { x: 0, y: 1 },
        { x: 1, y: 2 },
      ]),
      series('B', [
        { x: 0, y: 3 },
        { x: 1, y: 4 },
      ]),
    ])

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
