import * as React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { cn } from '#/lib/utils'
import { ChartFrame } from './chart-frame'
import { BoxPlotChart, HeatmapPlot, HistogramPlot } from './chart-plots'
import type { ChartSelection, PlotSelectionProps } from './chart-plots'
import { CHART_PALETTE, formatScientific } from '#/lib/chart-spec'
import type {
  AxisDisplay,
  ChartAnnotation,
  ChartSpec,
  ChartType,
  FacetedChart,
  FrozenChart,
  MaterialisedChart,
  MaterialisedSeries,
  ReferenceOverlay,
} from '#/lib/chart-spec'

/**
 * SCI-004 — Chart renderer inside `ChartFrame` (decision 0029).
 *
 * Renders line, scatter and bar charts using the approved palette and
 * scientific number formatting.
 *
 * Accessibility:
 *  - `ChartFrame` owns the figure semantics (role=figure, labelled title,
 *    sr-only `alt` description).
 *  - The plot carries an accessible label that summarises the plotted series.
 *  - The tabular alternative (`ChartTableAlternative`) renders the exact
 *    rows the chart plots, so the data is reachable without the visual.
 *  - Series are distinguishable by colour AND dash/symbol so non-colour
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
    <ChartLegend series={materialised.series} type={spec?.type ?? 'line'} />
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
      className={className}
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
        <div
          className={
            fillPlot ? 'flex h-full min-h-0 flex-col' : undefined
          }
        >
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
              {materialised.transformInvalidCount === 1 ? '' : 's'} could not
              be transformed
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
  const data = toRechartsData(materialised.series)
  const xScale = spec?.display.axes.x.scale ?? 'linear'
  const yScale = spec?.display.axes.y.scale ?? 'linear'
  const margin = { top: 16, right: 16, bottom: 32, left: 64 }
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
  const xAxis = (
    <XAxis
      dataKey="x"
      type="number"
      scale={xScale}
      domain={axisDomain(spec?.display.axes.x)}
      reversed={Boolean(spec?.display.axes.x.reverse)}
      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
      axisLine={{ stroke: 'var(--border)' }}
      tickLine={false}
      label={{
        value: axisLabel(materialised.xLabel, materialised.xUnit),
        position: 'bottom',
        fontSize: 11,
        fill: 'var(--muted-foreground)',
      }}
      tickFormatter={(value) => formatScientific(value)}
    />
  )
  const yAxis = (
    <YAxis
      type="number"
      scale={yScale}
      domain={axisDomain(spec?.display.axes.y)}
      reversed={Boolean(spec?.display.axes.y.reverse)}
      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
      axisLine={false}
      tickLine={false}
      tickFormatter={(value) => formatScientific(value)}
      label={{
        value: axisLabel(materialised.yLabel, materialised.yUnit),
        angle: -90,
        position: 'insideLeft',
        fontSize: 11,
        fill: 'var(--muted-foreground)',
      }}
    />
  )
  const references = referenceOverlayNodes(spec?.overlays.references, data)
  const tooltip = (
    <Tooltip
      contentStyle={{
        background: 'var(--popover)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontSize: 12,
      }}
      formatter={(value) => formatScientific(Number(value))}
    />
  )
  let chart: React.ReactNode
  if (type === 'histogram') {
    return (
      <HistogramPlot
        spec={spec}
        series={materialised.series}
        height={height}
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
  const annotations: ChartAnnotation[] = spec?.display.annotations ?? []
  const annotationDots = annotations.map((a, i) => (
    <ReferenceDot
      key={i}
      x={a.x}
      y={a.y}
      r={4}
      fill="var(--foreground)"
      stroke="var(--background)"
      label={{
        value: a.label,
        position: 'top',
        fontSize: 10,
        fill: 'var(--muted-foreground)',
      }}
    />
  ))
  if (type === 'scatter' || type === 'scatter_line' || type === 'connected_scatter' || type === 'strip') {
    // A fitted-curve overlay needs mixed point+line rendering, which only
    // ComposedChart provides; plain scatters keep the lighter chart.
    const connect =
      type === 'scatter_line' || type === 'connected_scatter'
    const hasFitLine =
      connect || materialised.series.some((s) => s.renderAs === 'line')
    const scatterChildren = (
      <>
        {grid}
        {xAxis}
        {yAxis}
        {tooltip}
        {materialised.series.map((series) =>
          series.renderAs === 'line' || connect ? (
            <Line
              key={series.identifier}
              dataKey={series.identifier}
              name={series.label}
              type="linear"
              stroke={series.color}
              strokeWidth={2}
              strokeDasharray={series.renderAs === 'line' ? '6 4' : undefined}
              dot={series.renderAs === 'line' ? false : { r: 3 }}
              isAnimationActive={false}
            />
          ) : (
            <Scatter
              key={series.identifier}
              name={series.label}
              dataKey={series.identifier}
              fill="var(--popover)"
              stroke={series.color}
              strokeWidth={2}
              onClick={(_data, index) =>
                selectionProps.onSelect({
                  seriesIdentifier: series.identifier,
                  index,
                })
              }
            />
          ),
        )}
        {references}
        {annotationDots}
      </>
    )
    if (hasFitLine) {
      chart = (
        <ComposedChart data={data} margin={margin} role="img">
          {scatterChildren}
        </ComposedChart>
      )
    } else {
      chart = (
        <ScatterChart margin={margin} role="img">
          {scatterChildren}
        </ScatterChart>
      )
    }
  } else if (
    type === 'bar' ||
    type === 'grouped_bar' ||
    type === 'stacked_bar' ||
    type === 'summary'
  ) {
    const stackId = type === 'stacked_bar' ? 'stack' : undefined
    chart = (
      <BarChart data={data} margin={margin} role="img">
        {grid}
        {xAxis}
        {yAxis}
        {tooltip}
        {materialised.series.map((series) => (
          <Bar
            key={series.identifier}
            dataKey={series.identifier}
            name={series.label}
            fill={series.color}
            opacity={0.85}
            stackId={stackId}
            onClick={(_data, index) =>
              selectionProps.onSelect({
                seriesIdentifier: series.identifier,
                index,
              })
            }
          >
            {hasErrorBars(series) ? (
              <ErrorBar
                dataKey={`${series.identifier}_error`}
                stroke={series.color}
                strokeWidth={1.5}
              />
            ) : null}
          </Bar>
        ))}
        {references}
        {annotationDots}
      </BarChart>
    )
  } else {
    chart = (
      <LineChart data={data} margin={margin} role="img">
        {grid}
        {xAxis}
        {yAxis}
        {tooltip}
        {materialised.series.map((series) => (
          <Line
            key={series.identifier}
            type="monotone"
            dataKey={series.identifier}
            name={series.label}
            stroke={series.color}
            strokeWidth={2}
            dot={{
              r: 3,
              fill: 'var(--popover)',
              stroke: series.color,
              strokeWidth: 2,
            }}
            activeDot={{ r: 5 }}
          >
            {hasErrorBars(series) ? (
              <ErrorBar
                dataKey={`${series.identifier}_error`}
                stroke={series.color}
                strokeWidth={1.5}
              />
            ) : null}
          </Line>
        ))}
        {references}
      </LineChart>
    )
  }
  return (
    <div
      role="img"
      tabIndex={0}
      aria-label={`${materialised.xLabel} vs ${materialised.yLabel}. ${describeSeries(materialised)}`}
      className="w-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ height }}
      onKeyDown={(event) =>
        handlePlotKeyDown(event, materialised, selectionProps)
      }
    >
      <ResponsiveContainer
        width="100%"
        height={height}
        initialDimension={{ width: 640, height }}
      >
        {chart}
      </ResponsiveContainer>
    </div>
  )
}

function axisDomain(
  axis: AxisDisplay | undefined,
): [number | 'auto', number | 'auto'] {
  return [axis?.min ?? 'auto', axis?.max ?? 'auto']
}

function referenceOverlayNodes(
  overlays: ReferenceOverlay[] | undefined,
  data: Array<Record<string, number | null | undefined>>,
) {
  if (!overlays?.length) return null
  const xs = data
    .map((row) => (typeof row.x === 'number' ? row.x : null))
    .filter((value): value is number => value !== null)
  const xMin = xs.length ? Math.min(...xs) : 0
  const xMax = xs.length ? Math.max(...xs) : 1
  return overlays.map((overlay, index) => {
    const key = `ref-${index}`
    if (overlay.kind === 'hline') {
      return (
        <ReferenceLine
          key={key}
          y={overlay.value}
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          label={{ value: overlay.label, position: 'right', fontSize: 10 }}
        />
      )
    }
    if (overlay.kind === 'vline') {
      return (
        <ReferenceLine
          key={key}
          x={overlay.value}
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          label={{ value: overlay.label, position: 'top', fontSize: 10 }}
        />
      )
    }
    if (overlay.kind === 'band') {
      return overlay.axis === 'y' ? (
        <ReferenceArea
          key={key}
          y1={overlay.lo}
          y2={overlay.hi}
          fill="var(--muted)"
          fillOpacity={0.25}
          strokeOpacity={0}
        />
      ) : (
        <ReferenceArea
          key={key}
          x1={overlay.lo}
          x2={overlay.hi}
          fill="var(--muted)"
          fillOpacity={0.25}
          strokeOpacity={0}
        />
      )
    }
    return (
      <ReferenceLine
        key={key}
        segment={[
          { x: xMin, y: xMin },
          { x: xMax, y: xMax },
        ]}
        stroke="var(--muted-foreground)"
        strokeDasharray="2 6"
        label={{
          value: overlay.label ?? 'identity',
          position: 'insideTopRight',
          fontSize: 10,
        }}
      />
    )
  })
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

function toRechartsData(series: MaterialisedSeries[]) {
  const xMap = new Map<number, Record<string, number | null | undefined>>()
  for (const item of series) {
    for (const point of item.points) {
      if (point.x === null || point.y === null) continue
      const row = xMap.get(point.x) ?? { x: point.x }
      row[item.identifier] = point.y
      if (point.yError !== null && point.yError !== undefined)
        row[`${item.identifier}_error`] = point.yError
      xMap.set(point.x, row)
    }
  }
  return Array.from(xMap.values()).sort(
    (a, b) => (a.x as number) - (b.x as number),
  )
}

function hasErrorBars(series: MaterialisedSeries) {
  return series.points.some(
    (point) => point.yError !== null && point.yError !== undefined,
  )
}

// ---------------------------------------------------------------------------
// Legend + tabular alternative + state messages
// ---------------------------------------------------------------------------

function ChartLegend({
  series,
  type,
}: {
  series: MaterialisedSeries[]
  type: ChartType
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {series.map((s, i) => (
        <li key={s.identifier} className="flex items-center gap-1.5">
          {type === 'bar' ? (
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-[2px]"
              style={{ backgroundColor: s.color }}
            />
          ) : type === 'scatter' ? (
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full border-2"
              style={{ borderColor: s.color, backgroundColor: 'white' }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4"
              style={{
                backgroundColor: s.color,
                borderTop: `2px ${i % 2 === 1 ? 'dashed' : 'solid'} ${s.color}`,
              }}
            />
          )}
          <span>{s.label}</span>
        </li>
      ))}
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

function axisLabel(label: string, unit?: string) {
  return unit ? `${label} (${unit})` : label
}

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
