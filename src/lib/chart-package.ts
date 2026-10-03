/**
 * COMP-07 — bridge from the ELN's canonical `ChartSpec` + `MaterialisedChart`
 * (ADR-0029) to `@sheetbase-labs/sheetbase-explorer`'s figure model.
 *
 * The package's standalone `Chart`/`FigureSvg` express one v3 figure: series,
 * markers, reference lines and axes over a numeric x/y mapping. It reads its
 * own `ChartSpec` + `Dataset` and computes the geometry in `buildFigure`. This
 * module is the single place that translates the ELN's already-materialised
 * rows (filters, transformations, sampling, frozen snapshots) into that shape,
 * so `chart-renderer.tsx` never hand-rolls scales or colours.
 *
 * Types the package cannot express as a point/line figure (bar, histogram,
 * box, violin, summary, heatmap) are reported as unsupported and rendered by
 * the ELN's own mark renderers — see COMP-07's `deferred` note.
 */
import {
  buildFigure,
  FIGURE_LAYOUT,
  type ChartKind as PackageChartKind,
  type ChartSpec as PackageChartSpec,
  type Dataset as PackageDataset,
  type FigureModel,
  type FigurePoint,
} from '@sheetbase-labs/sheetbase-explorer'

import type {
  AxisScale,
  ChartSpec,
  ChartType,
  MaterialisedChart,
  MaterialisedSeries,
  ReferenceOverlay,
} from './chart-spec'

/** Columns the synthesised package dataset uses; never surfaced to readers. */
export const PACKAGE_X_COLUMN = '__x'
export const PACKAGE_Y_COLUMN = '__y'
export const PACKAGE_SERIES_COLUMN = '__series'

/**
 * Chart types the package's v3 figure can draw: a numeric x/y mapping drawn as
 * markers and (optionally) a connecting line. `bar`, `histogram`, `box`,
 * `violin`, `summary` and `heatmap` are mark shapes `FigureSvg` has no
 * primitive for, so the renderer keeps its own SVG for those.
 */
export const PACKAGE_FIGURE_TYPES: readonly ChartType[] = [
  'line',
  'scatter',
  'scatter_line',
  'connected_scatter',
  'strip',
]

export function supportsPackageFigure(type: ChartType): boolean {
  return PACKAGE_FIGURE_TYPES.includes(type)
}

/**
 * Package kind handed to `buildFigure`. `line` makes the builder emit a
 * polyline for every series; the caller clears the polylines a scatter-style
 * type must not connect (see `applyRenderSemantics`). `scatter` remains for
 * genuinely unconnected figures.
 */
export function packageFigureKind(type: ChartType): PackageChartKind {
  if (
    type === 'line' ||
    type === 'scatter_line' ||
    type === 'connected_scatter'
  ) {
    return 'line'
  }
  return 'scatter'
}

/**
 * Dataset of the materialised points. Each point becomes one row; the series
 * identifier is the grouping field, so the package redraws exactly the series
 * the ELN materialised (already filtered, transformed, sampled and, for a
 * frozen snapshot, pinned). Points missing x or y are omitted — they carry no
 * position, and the renderer surfaces the dropped count separately.
 */
export function buildPackageDataset(
  materialised: MaterialisedChart,
): PackageDataset {
  const rows: Record<string, unknown>[] = []
  for (const series of materialised.series) {
    for (const point of series.points) {
      if (point.x === null || point.y === null) continue
      rows.push({
        [PACKAGE_X_COLUMN]: point.x,
        [PACKAGE_Y_COLUMN]: point.y,
        [PACKAGE_SERIES_COLUMN]: series.identifier,
      })
    }
  }
  return {
    name: materialised.yLabel,
    source: 'eln-materialised-chart',
    rows,
    columns: [
      {
        key: PACKAGE_X_COLUMN,
        kind: 'number',
        nullable: false,
        uniqueCount: new Set(
          materialised.series.flatMap((s) => s.points.map((p) => p.x)),
        ).size,
      },
      {
        key: PACKAGE_Y_COLUMN,
        kind: 'number',
        nullable: false,
        uniqueCount: new Set(
          materialised.series.flatMap((s) => s.points.map((p) => p.y)),
        ).size,
      },
      {
        key: PACKAGE_SERIES_COLUMN,
        kind: 'string',
        nullable: false,
        uniqueCount: materialised.series.length,
      },
    ],
  }
}

/** Reference lines the package can draw. Bands and identity lines become nulls. */
export function toPackageReferenceLines(
  overlays: ReferenceOverlay[] | undefined,
): NonNullable<PackageChartSpec['refLines']> | undefined {
  if (!overlays?.length) return undefined
  const lines: NonNullable<PackageChartSpec['refLines']> = []
  overlays.forEach((overlay, index) => {
    if (overlay.kind === 'hline') {
      lines.push({
        id: `ref-${index}`,
        axis: 'y',
        value: overlay.value,
        label: overlay.label,
      })
    } else if (overlay.kind === 'vline') {
      lines.push({
        id: `ref-${index}`,
        axis: 'x',
        value: overlay.value,
        label: overlay.label,
      })
    }
  })
  return lines.length ? lines : undefined
}

/**
 * Package spec for a point/line figure. Colours are left to the package's v3
 * series tokens (`series-a/b/c`); the ELN palette is not copied into the
 * figure, so no literal colour reaches the DOM.
 */
export function buildPackageChartSpec(
  spec: ChartSpec,
  materialised: MaterialisedChart,
): PackageChartSpec {
  return {
    kind: packageFigureKind(spec.type),
    x: PACKAGE_X_COLUMN,
    y: PACKAGE_Y_COLUMN,
    group: PACKAGE_SERIES_COLUMN,
    aggregate: 'none',
    showPoints: true,
    showGrid: spec.display.gridlines !== false,
    pointSize: 4,
    pointOpacity: spec.display.pointOpacity ?? 1,
    lineWidth: 1.6,
    lineOpacity: 1,
    fillOpacity: 0.2,
    barGap: 0.1,
    barRadius: 2,
    barLayout: 'grouped',
    histogramBins: 10,
    palette: [],
    xLabel: materialised.xLabel,
    yLabel: materialised.yLabel,
    xUnit: materialised.xUnit,
    yUnit: materialised.yUnit,
    xMin: spec.display.axes.x.min,
    xMax: spec.display.axes.x.max,
    yMin: spec.display.axes.y.min,
    yMax: spec.display.axes.y.max,
    xScale: spec.display.axes.x.scale,
    yScale: spec.display.axes.y.scale,
    refLines: toPackageReferenceLines(spec.overlays.references),
  }
}

export interface PackageFigureOptions {
  width?: number
  height?: number
  showXAxisTitle?: boolean
  showYAxisTitle?: boolean
}

/**
 * Build the v3 figure for a point/line chart, then apply the ELN's render
 * semantics per series: a scatter draws markers only, a line keeps its
 * connecting polyline, and a fitted (or otherwise `renderAs: 'line'`) series
 * inside a scatter keeps a dashed-free connecting line without markers — the
 * package's own `Chart` cannot mix line and marker series, so the per-series
 * intent is applied to the returned model instead. `FigureSvg` renders it.
 */
export function buildPackageFigure(
  spec: ChartSpec,
  materialised: MaterialisedChart,
  options: PackageFigureOptions = {},
): FigureModel | null {
  if (!supportsPackageFigure(spec.type)) return null
  const dataset = buildPackageDataset(materialised)
  if (dataset.rows.length === 0) return null
  // Build with `line` so every series carries polyline geometry; the ELN's
  // per-series render semantics below drop or keep it. A plain scatter then
  // clears every line, a fitted series keeps its own.
  const packageSpec: PackageChartSpec = {
    ...buildPackageChartSpec(spec, materialised),
    kind: 'line',
  }
  const figure = buildFigure(dataset, packageSpec, {
    width: options.width ?? FIGURE_LAYOUT.width,
    height: options.height ?? FIGURE_LAYOUT.height,
    showXAxisTitle: options.showXAxisTitle ?? true,
    showYAxisTitle: options.showYAxisTitle ?? true,
  })
  if (!figure) return null
  return applyRenderSemantics(figure, spec, materialised.series)
}

function applyRenderSemantics(
  figure: FigureModel,
  spec: ChartSpec,
  series: MaterialisedSeries[],
): FigureModel {
  const byId = new Map(series.map((s) => [s.identifier, s]))
  const connectAll = spec.type === 'line' || spec.type === 'connected_scatter'
  const modelSeries = figure.series.map((model) => {
    const source = byId.get(model.id)
    const asLine = connectAll || source?.renderAs === 'line'
    const points: FigurePoint[] = model.points.map((point) => ({ ...point }))
    return {
      ...model,
      points,
      line: asLine ? model.line : [],
      markers: source?.renderAs === 'line' ? false : true,
    }
  })
  return { ...figure, series: modelSeries }
}

/**
 * Map a data value to the figure's pixel coordinate. `FigureSvg` exposes no
 * scale, so the axis kind comes from the spec. Used by the renderer's overlay
 * for the marks the package's figure model has no primitive for — reference
 * bands, identity lines, annotations and error bars.
 */
export function figureValueToPx(
  figure: FigureModel,
  axis: 'x' | 'y',
  scale: AxisScale,
  value: number,
): number {
  const domain = axis === 'x' ? figure.x.domain : figure.y.domain
  const [v0, v1] = domain
  const [p0, p1] =
    axis === 'x'
      ? [figure.plot.x, figure.plot.x + figure.plot.width]
      : [figure.plot.y + figure.plot.height, figure.plot.y]
  if (scale === 'log') {
    const lv = Math.log10(Math.max(value, Number.MIN_VALUE))
    const l0 = Math.log10(Math.max(v0, Number.MIN_VALUE))
    const l1 = Math.log10(Math.max(v1, Number.MIN_VALUE))
    return p0 + ((lv - l0) / (l1 - l0 || 1)) * (p1 - p0)
  }
  return p0 + ((value - v0) / (v1 - v0 || 1)) * (p1 - p0)
}
