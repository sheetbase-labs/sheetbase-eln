/**
 * COMP-07 — bridge from the ELN's canonical `ChartSpec` + `MaterialisedChart`
 * (ADR-0029) to `@sheetbase-labs/sheetbase-explorer`'s v3 figure model.
 *
 * The package's `FigureSvg` expresses the v3 figure vocabulary: markers and
 * polylines over a numeric x/y mapping, bar marks (grouped/stacked/normalised),
 * box marks (five-number summary + Tukey whiskers) and heatmap cells on a
 * category grid, plus reference lines and axes. This module is the single place
 * that translates the ELN's already-materialised rows (filters, transformations,
 * sampling, frozen snapshots) into that shape, so `chart-renderer.tsx` never
 * hand-rolls scales or colours.
 *
 * What the package's v3 figure cannot express (see COMP-07's report):
 *  - histogram: `buildFigure` has no histogram kind; `histogram` falls through
 *    to the numeric branch, so the ELN keeps its own binned renderer;
 *  - violin: no density primitive at all; the ELN draws its box summary.
 *
 * Options the package's v3 figure ignores (so the ELN reports rather than fakes
 * them): per-series colours / palette (series tokens are chosen by index),
 * number formatting (the figure formats its own ticks), and axis reverse.
 * `display.gridlines` IS honoured by clearing the figure model's gridlines.
 */
import { buildFigure, FIGURE_LAYOUT } from '@sheetbase-labs/sheetbase-explorer'
import type {
  ChartKind as PackageChartKind,
  ChartSpec as PackageChartSpec,
  Dataset as PackageDataset,
  FigureModel,
  FigurePoint,
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
/** Box-plot category (the ELN's series label); a band axis. */
export const PACKAGE_CATEGORY_COLUMN = '__category'
/** Heatmap cell value (the ELN's already-aggregated cell value). */
export const PACKAGE_VALUE_COLUMN = '__value'

/** Point/line types: a numeric x/y mapping drawn as markers/polylines. */
const POINT_LINE: Partial<Record<ChartType, true>> = {
  line: true,
  scatter: true,
  scatter_line: true,
  connected_scatter: true,
  strip: true,
}

/** Bar-shaped types: categorical x, numeric y, one bar per series. */
const BAR: Partial<Record<ChartType, true>> = {
  bar: true,
  grouped_bar: true,
  stacked_bar: true,
  summary: true,
}

const BOX: Partial<Record<ChartType, true>> = { box: true }
const HEATMAP: Partial<Record<ChartType, true>> = { heatmap: true }

/**
 * Chart types the package's v3 figure draws. `bar` covers the ELN's `bar`,
 * `grouped_bar`, `stacked_bar` and `summary` (a bar chart of a statistic);
 * `box` and `heatmap` map to the package's box and heatmap primitives.
 */
export const PACKAGE_FIGURE_TYPES: readonly ChartType[] = [
  ...Object.keys(POINT_LINE),
  ...Object.keys(BAR),
  ...Object.keys(BOX),
  ...Object.keys(HEATMAP),
] as ChartType[]

/**
 * Chart types the package's v3 figure genuinely has no primitive for, so the
 * ELN keeps its own renderer. `histogram` has no bin primitive (the package's
 * `histogram` kind belongs to the legacy `buildChart`, not `buildFigure`) and
 * `violin` has no density primitive.
 */
export const PACKAGE_UNSUPPORTED_TYPES: readonly ChartType[] = [
  'histogram',
  'violin',
]

export function supportsPackageFigure(type: ChartType): boolean {
  return PACKAGE_FIGURE_TYPES.includes(type)
}

/**
 * Package kind handed to `buildFigure`. `line` makes the builder emit a
 * polyline for every series; the caller forces it for point/line types and
 * clears the polylines a scatter-style type must not connect (see
 * `applyRenderSemantics`).
 */
export function packageFigureKind(type: ChartType): PackageChartKind {
  if (BAR[type]) return 'bar'
  if (BOX[type]) return 'box'
  if (HEATMAP[type]) return 'heatmap'
  if (
    type === 'line' ||
    type === 'scatter_line' ||
    type === 'connected_scatter'
  )
    return 'line'
  return 'scatter'
}

/** Grouped vs stacked bars, honouring both the type and `typeParams.bar`. */
export function packageBarLayout(
  spec: ChartSpec,
): NonNullable<PackageChartSpec['barLayout']> {
  if (spec.type === 'stacked_bar') return 'stacked'
  if (spec.typeParams.bar?.stacking === 'stacked') return 'stacked'
  return 'grouped'
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value === 'boolean') return value ? 1 : 0
  return null
}

function columnMeta(
  key: string,
  kind: 'number' | 'string',
  uniqueCount: number,
): PackageDataset['columns'][number] {
  return { key, kind, nullable: false, uniqueCount }
}

/**
 * Dataset of the materialised chart, in the shape each package primitive reads:
 *  - point/line and bar/summary: one row per plotted point (`__x`, `__y`,
 *    `__series`). Bars dedupe to the first value per (series, category), which
 *    is exactly what the ELN's own bar renderer showed.
 *  - box: one row per raw observation (`__category`, `__y`) taken from the
 *    materialised rows, so the package recomputes the same Tukey summary the
 *    ELN's materialiser produced (identical quantile + 1.5×IQR rules). The
 *    category carries the ELN's resolved series label.
 *  - heatmap: one row per non-empty aggregated cell (`__x`, `__y`, `__value`)
 *    from the ELN's materialised grid, in the grid's own label order.
 */
export function buildPackageDataset(
  spec: ChartSpec,
  materialised: MaterialisedChart,
): PackageDataset {
  if (spec.type === 'heatmap') return buildHeatmapDataset(materialised)
  if (spec.type === 'box') return buildBoxDataset(spec, materialised)
  return buildSeriesDataset(spec, materialised)
}

function buildSeriesDataset(
  spec: ChartSpec,
  materialised: MaterialisedChart,
): PackageDataset {
  const dedupe = BAR[spec.type] === true
  const rows: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (const series of materialised.series) {
    for (const point of series.points) {
      if (point.x === null || point.y === null) continue
      if (dedupe) {
        const key = `${series.identifier}\u0000${point.x}`
        if (seen.has(key)) continue
        seen.add(key)
      }
      rows.push({
        [PACKAGE_X_COLUMN]: point.x,
        [PACKAGE_Y_COLUMN]: point.y,
        [PACKAGE_SERIES_COLUMN]: series.identifier,
      })
    }
  }
  // Bars order their category bands by first appearance, so sort the rows by
  // category — the ELN's own bar renderer always plotted categories ascending.
  if (dedupe) {
    rows.sort(
      (a, b) => Number(a[PACKAGE_X_COLUMN]) - Number(b[PACKAGE_X_COLUMN]),
    )
  }
  return {
    name: materialised.yLabel,
    source: 'eln-materialised-chart',
    rows,
    columns: [
      columnMeta(
        PACKAGE_X_COLUMN,
        'number',
        new Set(rows.map((r) => r[PACKAGE_X_COLUMN])).size,
      ),
      columnMeta(
        PACKAGE_Y_COLUMN,
        'number',
        new Set(rows.map((r) => r[PACKAGE_Y_COLUMN])).size,
      ),
      columnMeta(PACKAGE_SERIES_COLUMN, 'string', materialised.series.length),
    ],
  }
}

function buildBoxDataset(
  spec: ChartSpec,
  materialised: MaterialisedChart,
): PackageDataset {
  const yFieldId = spec.fields.y.fieldId
  const seriesFieldId = spec.fields.series?.fieldId ?? null
  const valuesByKey = new Map<string, number[]>()
  for (const row of materialised.rows) {
    const value = numeric(row[yFieldId])
    if (value === null) continue
    const key = seriesFieldId ? String(row[seriesFieldId] ?? '—') : 'all'
    const values = valuesByKey.get(key)
    if (values) values.push(value)
    else valuesByKey.set(key, [value])
  }
  // Iterate the materialised series so the boxes keep the ELN's series order
  // and labels; the category bands then follow first appearance.
  const rows: Record<string, unknown>[] = []
  for (const series of materialised.series) {
    for (const value of valuesByKey.get(series.identifier) ?? []) {
      rows.push({
        [PACKAGE_CATEGORY_COLUMN]: series.label,
        [PACKAGE_Y_COLUMN]: value,
      })
    }
  }
  return {
    name: materialised.yLabel,
    source: 'eln-materialised-chart',
    rows,
    columns: [
      columnMeta(
        PACKAGE_CATEGORY_COLUMN,
        'string',
        new Set(rows.map((r) => r[PACKAGE_CATEGORY_COLUMN])).size,
      ),
      columnMeta(
        PACKAGE_Y_COLUMN,
        'number',
        new Set(rows.map((r) => r[PACKAGE_Y_COLUMN])).size,
      ),
    ],
  }
}

function buildHeatmapDataset(materialised: MaterialisedChart): PackageDataset {
  const heatmap = materialised.heatmap
  const rows: Record<string, unknown>[] = []
  if (heatmap) {
    const yLabels = heatmap.yLabels ?? ['']
    const cellByPosition = new Map(
      heatmap.cells.map((cell) => [`${cell.x},${cell.y}`, cell]),
    )
    // Iterate the grid in its own label order so the package's first-seen
    // band order matches the ELN's sorted labels.
    for (let y = 0; y < yLabels.length; y++) {
      for (let x = 0; x < heatmap.xLabels.length; x++) {
        const cell = cellByPosition.get(`${x},${y}`)
        if (!cell || cell.value === null) continue
        rows.push({
          [PACKAGE_X_COLUMN]: heatmap.xLabels[x],
          [PACKAGE_Y_COLUMN]: yLabels[y],
          [PACKAGE_VALUE_COLUMN]: cell.value,
        })
      }
    }
  }
  return {
    name: materialised.yLabel,
    source: 'eln-materialised-chart',
    rows,
    columns: [
      columnMeta(
        PACKAGE_X_COLUMN,
        'string',
        new Set(rows.map((r) => r[PACKAGE_X_COLUMN])).size,
      ),
      columnMeta(
        PACKAGE_Y_COLUMN,
        'string',
        new Set(rows.map((r) => r[PACKAGE_Y_COLUMN])).size,
      ),
      columnMeta(
        PACKAGE_VALUE_COLUMN,
        'number',
        new Set(rows.map((r) => r[PACKAGE_VALUE_COLUMN])).size,
      ),
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
 * Package spec for a figure. Colours are left to the package's v3 series
 * tokens (`series-a/b/c`); the ELN palette is not copied into the figure, so
 * no literal colour reaches the DOM.
 */
export function buildPackageChartSpec(
  spec: ChartSpec,
  materialised: MaterialisedChart,
): PackageChartSpec {
  const kind = packageFigureKind(spec.type)
  const isHeatmap = kind === 'heatmap'
  const isBox = kind === 'box'
  const isBar = kind === 'bar'
  const grouped = isBar || POINT_LINE[spec.type] === true
  return {
    kind,
    x: isBox ? PACKAGE_CATEGORY_COLUMN : PACKAGE_X_COLUMN,
    y: PACKAGE_Y_COLUMN,
    // Box rows group by their category so each box keeps its series identity
    // (`FigureBoxPlot.seriesId`) for the selection model.
    group: grouped
      ? PACKAGE_SERIES_COLUMN
      : isBox
        ? PACKAGE_CATEGORY_COLUMN
        : undefined,
    aggregate: isHeatmap ? 'sum' : 'none',
    size: isHeatmap ? PACKAGE_VALUE_COLUMN : undefined,
    showPoints: isBox ? spec.typeParams.box?.showOutliers !== false : true,
    showGrid: spec.display.gridlines !== false,
    pointSize: 4,
    pointOpacity: spec.display.pointOpacity ?? 1,
    lineWidth: 1.6,
    lineOpacity: 1,
    fillOpacity: 0.2,
    barGap: 0.1,
    barRadius: 2,
    barLayout: isBar ? packageBarLayout(spec) : 'grouped',
    histogramBins: 10,
    palette: [],
    xLabel: materialised.xLabel,
    yLabel: materialised.yLabel,
    xUnit: materialised.xUnit,
    yUnit: materialised.yUnit,
    xMin: isHeatmap || isBox ? undefined : spec.display.axes.x.min,
    xMax: isHeatmap || isBox ? undefined : spec.display.axes.x.max,
    yMin: isHeatmap ? undefined : spec.display.axes.y.min,
    yMax: isHeatmap ? undefined : spec.display.axes.y.max,
    xScale: isHeatmap || isBox ? undefined : spec.display.axes.x.scale,
    yScale: isHeatmap ? undefined : spec.display.axes.y.scale,
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
 * Build the v3 figure for any package-rendered chart, then apply the ELN's
 * render semantics: a scatter draws markers only, a line keeps its connecting
 * polyline, and a fitted (or otherwise `renderAs: 'line'`) series inside a
 * scatter keeps a connecting line without markers — the package's own `Chart`
 * cannot mix line and marker series, so the per-series intent is applied to
 * the returned model instead. `FigureSvg` renders it.
 */
export function buildPackageFigure(
  spec: ChartSpec,
  materialised: MaterialisedChart,
  options: PackageFigureOptions = {},
): FigureModel | null {
  if (!supportsPackageFigure(spec.type)) return null
  const dataset = buildPackageDataset(spec, materialised)
  if (dataset.rows.length === 0) return null
  const pointLine = POINT_LINE[spec.type] === true
  const packageSpec: PackageChartSpec = {
    ...buildPackageChartSpec(spec, materialised),
    // Build point/line types with `line` so every series carries polyline
    // geometry; the per-series render semantics below drop or keep it.
    ...(pointLine ? { kind: 'line' as const } : {}),
  }
  const figure = buildFigure(dataset, packageSpec, {
    width: options.width ?? FIGURE_LAYOUT.width,
    height: options.height ?? FIGURE_LAYOUT.height,
    // Box categories are self-labelling, so the design omits the x-axis title.
    showXAxisTitle: options.showXAxisTitle ?? spec.type !== 'box',
    showYAxisTitle: options.showYAxisTitle ?? true,
  })
  if (!figure) return null
  const withSemantics = pointLine
    ? applyRenderSemantics(figure, spec, materialised.series)
    : figure
  return applyDisplayOptions(withSemantics, spec)
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
 * Apply the ELN display options the package's figure model carries. The package
 * ignores `showGrid` when it draws the figure (it renders `figure.gridlines`
 * verbatim), so clearing the model's gridlines is how `display.gridlines=false`
 * is honoured without hand-rolling geometry.
 */
function applyDisplayOptions(
  figure: FigureModel,
  spec: ChartSpec,
): FigureModel {
  if (spec.display.gridlines === false && figure.gridlines.length > 0) {
    return { ...figure, gridlines: [] }
  }
  return figure
}

/**
 * Map a data value to the figure's pixel coordinate on a numeric axis.
 * `FigureSvg` exposes no scale, so the axis kind comes from the spec. Used by
 * the renderer's overlay for the marks the package's figure model has no
 * primitive for — reference bands, identity lines, annotations and error bars.
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

/**
 * Map a category value to the pixel coordinate of its band on a band axis
 * (bar/box/heatmap). Categories are evenly spaced, so a numeric category maps
 * linearly across the band centres — matching the ELN's own categorical
 * renderers. Falls back to the numeric axis mapping when there is no band axis.
 */
export function figureCategoryToPx(figure: FigureModel, value: number): number {
  const bands = figure.x.bands
  if (!bands?.length) return figureValueToPx(figure, 'x', 'linear', value)
  if (bands.length === 1) return bands[0].px
  const parsed = bands.map((band) => Number(band.value))
  const first = parsed[0]
  const last = parsed[parsed.length - 1]
  if (Number.isFinite(first) && Number.isFinite(last) && last !== first) {
    return (
      bands[0].px +
      ((value - first) / (last - first)) *
        (bands[bands.length - 1].px - bands[0].px)
    )
  }
  let nearest = bands[0]
  let nearestDistance = Number.POSITIVE_INFINITY
  bands.forEach((band, index) => {
    const distance = Math.abs((parsed[index] ?? 0) - value)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = band
    }
  })
  return nearest.px
}
