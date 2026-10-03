import * as React from 'react'
import { FigureSvg, seriesStyle } from '@sheetbase-labs/sheetbase-explorer'

import { cn } from '#/lib/utils'
import { ChartFrame } from './chart-frame'
import {
  BarPlotChart,
  BoxPlotChart,
  HeatmapPlot,
  HistogramPlot,
} from './chart-plots'
import type { ChartSelection, PlotSelectionProps } from './chart-plots'
import { CHART_PALETTE, formatScientific } from '#/lib/chart-spec'
import type {
  ChartSpec,
  FacetedChart,
  FrozenChart,
  MaterialisedChart,
  MaterialisedSeries,
} from '#/lib/chart-spec'
import { buildPackageFigure, figureValueToPx } from '#/lib/chart-package'

/**
 * SCI-004 — Chart renderer inside `ChartFrame` (decision 0029).
 *
 * Point/line charts (line, scatter, scatter_line, connected_scatter, strip)
 * are drawn by `sheetbase-explorer`'s v3 figure from the materialised rows, so
 * series, markers, reference lines, axes and units come from the package and
 * its v3 tokens. Mark shapes the package's `FigureSvg` has no primitive for
 * (bar, histogram, summary, box, violin, heatmap) are drawn here from the same
 * materialised points — see COMP-07's `deferred` note.
 *
 * Accessibility:
 *  - `ChartFrame` owns the figure semantics (role=figure, labelled title,
 *    sr-only `alt` description).
 *  - The plot carries an accessible label that summarises the plotted series.
 *  - The tabular alternative (`ChartTableAlternative`) renders the exact
 *    rows the chart plots, so the data is reachable without the visual.
 *  - Series are distinguishable by colour AND symbol so non-colour
 *    perception still works (DESIGN.md "non-colour distinctions").
 */

export interface ChartRendererProps {
  title: string
  subtitle?: string
  provenance?: string
  spec: ChartSpec | null
  materialised: MaterialisedChart
  frozen: FrozenChart | null
  loading?: boolean
  /** Permission error message; when set the frame renders an error state. */
  error?: string | null
  className?: string
  actions?: React.ReactNode
  /** When true, suppress the visual title (parent renders it). */
  hideTitle?: boolean
  /** Plot height in pixels. Ignored when `fillPlot` is set. */
  plotHeight?: number
  /** Fill the parent height instead of a fixed pixel plot. */
  fillPlot?: boolean
  /** Hide the built-in table when the surrounding page already shows these rows. */
  showTableAlternative?: boolean
  /** Faceted small multiples; when set the plot area renders a panel grid. */
  facets?: FacetedChart[]
  /** Total distinct facet values before the MAX_FACETS cap (honest truncation). */
  facetTotal?: number
  /** Interactive selection state shared by the plot and the data table. */
  selection?: ChartSelection | null
  onSelectionChange?: (selection: ChartSelection | null) => void
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

export function ChartRenderer({
  title,
  subtitle,
  provenance,
  spec,
  materialised,
  frozen,
  loading = false,
  error = null,
  className,
  actions,
  hideTitle = false,
  plotHeight = 240,
  fillPlot = false,
  showTableAlternative = true,
  facets,
  facetTotal,
  selection = null,
  onSelectionChange,
  expanded = false,
  onExpandedChange,
}: ChartRendererProps) {
  const mode = frozen ? 'snapshot' : 'live'
  const alt = describeChart(spec, materialised, frozen)
  const legend = materialised.series.length ? (
    <ChartLegend series={materialised.series} />
  ) : null
  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      provenance={provenance}
      mode={mode}
      alt={alt}
      legend={legend}
      loading={loading}
      actions={actions}
      className={cn('sheetbase-scope', className)}
      hideTitle={hideTitle}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      fill={fillPlot}
    >
      {error ? (
        <ChartStateMessage tone="error">{error}</ChartStateMessage>
      ) : materialised.state.kind !== 'ok' ? (
        <ChartStateMessage tone="warning">
          {describeState(materialised)}
        </ChartStateMessage>
      ) : materialised.series.length === 0 && !materialised.heatmap ? (
        <ChartStateMessage tone="muted">
          {spec != null && spec.fields.x
            ? 'No plottable points after filtering. Check mapped fields and filters.'
            : 'Choose an X and Y field to create a scatter plot.'}
        </ChartStateMessage>
      ) : (
        <div className={fillPlot ? 'flex h-full min-h-0 flex-col' : undefined}>
          {fillPlot ? (
            <div className="min-h-0 flex-1">
              <MeasuredPlotHeight>
                {(height) => (
                  <ChartPlot
                    spec={spec}
                    materialised={materialised}
                    height={height}
                    facets={facets}
                    facetTotal={facetTotal}
                    selectionProps={{
                      selection,
                      onSelect: onSelectionChange ?? (() => {}),
                    }}
                  />
                )}
              </MeasuredPlotHeight>
            </div>
          ) : (
            <ChartPlot
              spec={spec}
              materialised={materialised}
              height={plotHeight}
              facets={facets}
              facetTotal={facetTotal}
              selectionProps={{
                selection,
                onSelect: onSelectionChange ?? (() => {}),
              }}
            />
          )}
          {materialised.transformInvalidCount ? (
            <p role="status" className="mt-1 text-xs text-muted-foreground">
              {materialised.transformInvalidCount} value
              {materialised.transformInvalidCount === 1 ? '' : 's'} could not be
              transformed
              {materialised.transformInvalidReasons?.length
                ? ` (${materialised.transformInvalidReasons.join('; ')})`
                : ''}
              . They are omitted, not coerced.
            </p>
          ) : null}
          {materialised.droppedPoints > 0 ? (
            <p role="status" className="mt-1 text-xs text-muted-foreground">
              {materialised.droppedPoints} row
              {materialised.droppedPoints === 1 ? '' : 's'} omitted (missing or
              non-numeric values).
            </p>
          ) : null}
          {materialised.sampling ? (
            <p role="status" className="mt-1 text-xs text-muted-foreground">
              Showing {materialised.sampling.sampledCount} of{' '}
              {materialised.sampling.totalCount} points. Statistics use all{' '}
              {materialised.sampling.analysisCount} observations.
            </p>
          ) : null}
          {materialised.fit ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {materialised.fit.error
                ? `OLS fit unavailable (${materialised.fit.error.replaceAll('_', ' ')}).`
                : `OLS ${materialised.fit.equation} · R² = ${formatScientific(materialised.fit.r2)} · n = ${materialised.fit.n}`}
            </p>
          ) : null}
        </div>
      )}
      {showTableAlternative &&
      materialised.state.kind === 'ok' &&
      materialised.rows.length > 0 ? (
        <ChartTableAlternative materialised={materialised} />
      ) : null}
    </ChartFrame>
  )
}

function MeasuredPlotHeight({
  children,
  fallback = 480,
}: {
  children: (height: number) => React.ReactNode
  fallback?: number
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [height, setHeight] = React.useState(fallback)
  React.useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const apply = () => {
      const next = Math.floor(node.getBoundingClientRect().height)
      if (next > 0) setHeight(Math.max(160, next))
    }
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={ref} className="h-full min-h-0 w-full">
      {children(height)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plot
// ---------------------------------------------------------------------------

function ChartPlot({
  spec,
  materialised,
  height,
  facets,
  facetTotal,
  selectionProps,
}: {
  spec: ChartSpec | null
  materialised: MaterialisedChart
  height: number
  facets?: FacetedChart[]
  facetTotal?: number
  selectionProps: PlotSelectionProps
}) {
  const type = spec?.type ?? 'line'
  if (facets && facets.length > 0) {
    return (
      <div className="w-full">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {facets.map((facet) => (
            <div
              key={facet.value}
              className="rounded-md border p-2"
              aria-label={`Facet ${facet.value}`}
            >
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {facet.value}
              </p>
              <ChartPlot
                spec={spec}
                materialised={facet.chart}
                height={height * 0.7}
                selectionProps={selectionProps}
              />
            </div>
          ))}
        </div>
        {facetTotal !== undefined && facetTotal > facets.length ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Showing {facets.length} of {facetTotal} groups; narrow the data or
            pick a facet column with fewer values.
          </p>
        ) : null}
      </div>
    )
  }

  if (type === 'histogram') {
    return (
      <HistogramPlot
        series={materialised.series}
        height={height}
        xLabel={spec?.display.axes.x.label ?? 'Bin start'}
        yLabel="Count"
        selectionProps={selectionProps}
      />
    )
  }
  if (type === 'violin' || type === 'box') {
    return (
      <BoxPlotChart
        series={materialised.series}
        height={height}
        logScale={spec?.display.axes.y.scale === 'log'}
        selectionProps={selectionProps}
      />
    )
  }
  if (type === 'heatmap') {
    if (!materialised.heatmap)
      return (
        <ChartStateMessage tone="muted">
          No heatmap grid available.
        </ChartStateMessage>
      )
    return (
      <HeatmapPlot
        heatmap={materialised.heatmap}
        valueLabel={materialised.yLabel}
        selectionProps={selectionProps}
      />
    )
  }
  if (
    type === 'bar' ||
    type === 'grouped_bar' ||
    type === 'stacked_bar' ||
    type === 'summary'
  ) {
    return (
      <BarPlotChart
        series={materialised.series}
        height={height}
        stacking={type === 'stacked_bar' ? 'stacked' : 'grouped'}
        xLabel={materialised.xLabel}
        yLabel={materialised.yLabel}
        yUnit={materialised.yUnit}
        ariaLabel={`${type.replace(/_/g, ' ')} chart. ${describeSeries(materialised)}`}
        annotations={spec?.display.annotations ?? []}
        references={spec?.overlays.references ?? []}
        selectionProps={selectionProps}
      />
    )
  }
  return (
    <PackageFigurePlot
      spec={spec}
      materialised={materialised}
      height={height}
      selectionProps={selectionProps}
    />
  )
}

/**
 * The package's v3 figure, rendered by `FigureSvg`, with a transparent hit
 * layer over the model's point positions so the shared selection model still
 * follows a click or the arrow keys (the package figure itself is static).
 */
function PackageFigurePlot({
  spec,
  materialised,
  height,
  selectionProps,
}: {
  spec: ChartSpec | null
  materialised: MaterialisedChart
  height: number
  selectionProps: PlotSelectionProps
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(640)
  React.useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) return
    const apply = () => {
      const next = Math.floor(node.getBoundingClientRect().width)
      if (next > 0) setWidth(Math.max(240, next))
    }
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const figure = React.useMemo(
    () =>
      spec ? buildPackageFigure(spec, materialised, { width, height }) : null,
    [spec, materialised, width, height],
  )
  if (!figure)
    return (
      <ChartStateMessage tone="muted">
        This chart has no numeric x/y points to plot.
      </ChartStateMessage>
    )
  const xScale = spec?.display.axes.x.scale ?? 'linear'
  const yScale = spec?.display.axes.y.scale ?? 'linear'
  const plot = figure.plot
  const yPx = (value: number) => {
    const px = figureValueToPx(figure, 'y', yScale, value)
    return Math.min(plot.y + plot.height, Math.max(plot.y, px))
  }
  const xPx = (value: number) => figureValueToPx(figure, 'x', xScale, value)
  const references = spec?.overlays.references ?? []
  const annotations = spec?.display.annotations ?? []
  const errorPoints = materialised.series.flatMap((series) =>
    series.points
      .filter(
        (point) => point.x !== null && point.y !== null && point.yError != null,
      )
      .map((point) => ({ series, point })),
  )
  return (
    <div
      ref={containerRef}
      role="group"
      tabIndex={0}
      aria-label={figure.ariaLabel}
      className="relative w-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ height }}
      onKeyDown={(event) =>
        handlePlotKeyDown(event, materialised, selectionProps)
      }
    >
      <FigureSvg figure={figure} ariaLabel={figure.ariaLabel} />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      >
        {/* Marks the package's figure model has no primitive for: shaded
            reference bands, an identity line, annotations and error bars. */}
        <g pointerEvents="none">
          {references.map((overlay, index) => {
            if (overlay.kind === 'band') {
              return overlay.axis === 'y' ? (
                <rect
                  key={`band-${index}`}
                  x={plot.x}
                  width={plot.width}
                  y={yPx(overlay.hi)}
                  height={Math.max(0, yPx(overlay.lo) - yPx(overlay.hi))}
                  fill="var(--muted)"
                  fillOpacity={0.25}
                />
              ) : (
                <rect
                  key={`band-${index}`}
                  y={plot.y}
                  height={plot.height}
                  x={xPx(overlay.lo)}
                  width={Math.max(0, xPx(overlay.hi) - xPx(overlay.lo))}
                  fill="var(--muted)"
                  fillOpacity={0.25}
                />
              )
            }
            if (overlay.kind === 'identity') {
              const [d0, d1] = figure.x.domain
              return (
                <line
                  key={`identity-${index}`}
                  x1={xPx(d0)}
                  y1={yPx(d0)}
                  x2={xPx(d1)}
                  y2={yPx(d1)}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="2 6"
                />
              )
            }
            return null
          })}
          {errorPoints.map(({ series, point }, index) => {
            const cx = xPx(point.x as number)
            const hi = yPx((point.y as number) + (point.yError as number))
            const lo = yPx((point.y as number) - (point.yError as number))
            return (
              <g
                key={`error-${series.identifier}-${index}`}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
              >
                <line x1={cx} x2={cx} y1={hi} y2={lo} />
                <line x1={cx - 3} x2={cx + 3} y1={hi} y2={hi} />
                <line x1={cx - 3} x2={cx + 3} y1={lo} y2={lo} />
              </g>
            )
          })}
          {annotations.map((annotation, index) => {
            const cx = xPx(annotation.x)
            const cy = yPx(annotation.y)
            return (
              <g key={`annotation-${index}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill="var(--foreground)"
                  stroke="var(--background)"
                />
                <text
                  x={cx}
                  y={cy - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--muted-foreground)"
                >
                  {annotation.label}
                </text>
              </g>
            )
          })}
        </g>
        {figure.series.flatMap((series) =>
          series.points.map((point) =>
            point.py === undefined ? null : (
              <circle
                key={`${series.id}-${point.rowId ?? point.index}`}
                cx={point.px}
                cy={point.py}
                r={9}
                fill="transparent"
                className="cursor-pointer"
                onClick={() =>
                  selectionProps.onSelect({
                    seriesIdentifier: series.id,
                    index: point.index,
                  })
                }
              />
            ),
          ),
        )}
      </svg>
    </div>
  )
}

function handlePlotKeyDown(
  event: React.KeyboardEvent,
  materialised: MaterialisedChart,
  selectionProps: PlotSelectionProps,
) {
  const series = materialised.series.at(0)
  if (series === undefined || series.points.length === 0) return
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  event.preventDefault()
  const current = selectionProps.selection
  const index =
    current?.seriesIdentifier === series.identifier ? current.index : 0
  const next =
    event.key === 'ArrowRight'
      ? Math.min(series.points.length - 1, index + 1)
      : Math.max(0, index - 1)
  selectionProps.onSelect({ seriesIdentifier: series.identifier, index: next })
}

// ---------------------------------------------------------------------------
// Legend + tabular alternative + state messages
// ---------------------------------------------------------------------------

function ChartLegend({ series }: { series: MaterialisedSeries[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {series.map((s, i) => {
        const { marker, colour } = seriesStyle(i)
        return (
          <li key={s.identifier} className="flex items-center gap-1.5">
            <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
              {marker === 'square' ? (
                <rect x={1.5} y={1.5} width={7} height={7} fill={colour} />
              ) : marker === 'triangle' ? (
                <polygon points="5,1 9.5,9 0.5,9" fill={colour} />
              ) : (
                <circle cx={5} cy={5} r={3.5} fill={colour} />
              )}
            </svg>
            <span>{s.label}</span>
          </li>
        )
      })}
    </ul>
  )
}

function ChartTableAlternative({
  materialised,
}: {
  materialised: MaterialisedChart
}) {
  const cols = [
    { key: 'series', label: 'Series' },
    { key: 'x', label: materialised.xLabel },
    { key: 'y', label: materialised.yLabel },
    { key: 'yError', label: 'Error' },
  ]
  const rows = materialised.series.flatMap((s) =>
    s.points.map((p) => ({
      series: s.label,
      x: p.x,
      y: p.y,
      yError: p.yError,
    })),
  )
  return (
    <details className="group mt-3">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Show data table ({rows.length} points)
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b">
              {cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="px-2 py-1 text-left font-medium text-muted-foreground"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="odd:bg-background">
                <td className="border-b px-2 py-1">{r.series}</td>
                <td className="border-b px-2 py-1 font-mono tabular-nums">
                  {formatScientific(r.x)}
                </td>
                <td className="border-b px-2 py-1 font-mono tabular-nums">
                  {formatScientific(r.y)}
                </td>
                <td className="border-b px-2 py-1 font-mono tabular-nums">
                  {formatScientific(r.yError ?? null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function ChartStateMessage({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'warning' | 'error' | 'muted'
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border p-4 text-xs',
        tone === 'error' &&
          'border-destructive/40 bg-destructive/5 text-destructive',
        tone === 'warning' && 'border-warning/40 bg-warning/10 text-foreground',
        tone === 'muted' &&
          'border-dashed border-input bg-muted/20 text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Descriptions for screen readers
// ---------------------------------------------------------------------------

function describeSeries(materialised: MaterialisedChart): string {
  const parts = materialised.series.map(
    (s) => `${s.label}: ${s.points.length} points`,
  )
  return `${materialised.series.length} series — ${parts.join('; ')}.`
}

function describeState(materialised: MaterialisedChart): string {
  switch (materialised.state.kind) {
    case 'missing_dataset':
      return 'No dataset is referenced. Select a dataset to plot this chart.'
    case 'missing_field':
      return `The dataset is missing field(s): ${materialised.state.fields.join(', ')}. Update the field mappings or the dataset.`
    case 'dataset_too_large':
      return `This Dataset has ${materialised.state.rowCount} rows, above the ${materialised.state.limit}-row analysis limit. Filter or aggregate before plotting.`
    case 'empty_dataset':
      return 'The dataset has no rows matching the current filters.'
    case 'log_scale_invalid':
      return `The ${materialised.state.axis}-axis is set to log scale but ${materialised.state.invalidCount} point(s) are non-positive. Switch to linear or filter out non-positive values.`
    case 'stale':
      return materialised.state.detail
    default:
      return ''
  }
}

function describeChart(
  spec: ChartSpec | null,
  materialised: MaterialisedChart,
  frozen: FrozenChart | null,
): string {
  const type = spec?.type ?? 'chart'
  const state = materialised.state
  if (state.kind !== 'ok')
    return `${type} chart — ${describeState(materialised)}`
  const seriesPart = describeSeries(materialised)
  const provenancePart = frozen
    ? frozen.datasetProvenance
        .map(
          (p) =>
            `dataset ${p.datasetId.slice(0, 8)} (${p.rowCount} rows, checksum ${p.checksum.slice(0, 8)})`,
        )
        .join(', ')
    : ''
  const frozenPart = frozen
    ? ` Frozen snapshot taken ${frozen.frozenAt}; provenance: ${provenancePart}.`
    : ' Live: re-reads the current dataset.'
  return `${type} chart of ${materialised.yLabel} against ${materialised.xLabel}. ${seriesPart}${frozenPart}`
}

export { CHART_PALETTE }
