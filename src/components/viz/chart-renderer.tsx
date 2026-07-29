import * as React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { cn } from '#/lib/utils'
import { ChartFrame } from './chart-frame'
import { CHART_PALETTE, formatScientific } from '#/lib/chart-spec'
import type {
  ChartSpec,
  ChartType,
  FrozenChart,
  MaterialisedChart,
  MaterialisedSeries,
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
    >
      {error ? (
        <ChartStateMessage tone="error">{error}</ChartStateMessage>
      ) : materialised.state.kind !== 'ok' ? (
        <ChartStateMessage tone="warning">
          {describeState(materialised)}
        </ChartStateMessage>
      ) : materialised.series.length === 0 ? (
        <ChartStateMessage tone="muted">No plottable points.</ChartStateMessage>
      ) : (
        <ChartPlot spec={spec} materialised={materialised} />
      )}
      {materialised.state.kind === 'ok' && materialised.rows.length > 0 ? (
        <ChartTableAlternative materialised={materialised} />
      ) : null}
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Plot
// ---------------------------------------------------------------------------

function ChartPlot({
  spec,
  materialised,
}: {
  spec: ChartSpec | null
  materialised: MaterialisedChart
}) {
  const type = spec?.type ?? 'line'
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
      domain={['auto', 'auto']}
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
      domain={['auto', 'auto']}
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
  if (type === 'scatter') {
    chart = (
      <ScatterChart margin={margin} role="img">
        {grid}
        {xAxis}
        {yAxis}
        {tooltip}
        {materialised.series.map((series) => (
          <Scatter
            key={series.identifier}
            name={series.label}
            data={data.filter(
              (row) =>
                row[series.identifier] !== null &&
                row[series.identifier] !== undefined,
            )}
            dataKey={series.identifier}
            fill="var(--popover)"
            stroke={series.color}
            strokeWidth={2}
          >
            {hasErrorBars(series) ? (
              <ErrorBar
                dataKey={`${series.identifier}_error`}
                stroke={series.color}
                strokeWidth={1.5}
              />
            ) : null}
          </Scatter>
        ))}
      </ScatterChart>
    )
  } else if (type === 'bar') {
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
      </LineChart>
    )
  }
  return (
    <div
      role="img"
      aria-label={`${materialised.xLabel} vs ${materialised.yLabel}. ${describeSeries(materialised)}`}
      className="h-[240px] w-full"
    >
      <ResponsiveContainer width="100%" height={240}>
        {chart}
      </ResponsiveContainer>
    </div>
  )
}

function toRechartsData(series: MaterialisedSeries[]) {
  const xMap = new Map<number, Record<string, number | null>>()
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
            `table ${p.tableId} (${p.rowCount} rows, checksum ${p.checksum.slice(0, 8)})`,
        )
        .join(', ')
    : ''
  const frozenPart = frozen
    ? ` Frozen snapshot taken ${frozen.frozenAt}; provenance: ${provenancePart}.`
    : ' Live: re-reads the current dataset.'
  return `${type} chart of ${materialised.yLabel} against ${materialised.xLabel}. ${seriesPart}${frozenPart}`
}

export { CHART_PALETTE }
