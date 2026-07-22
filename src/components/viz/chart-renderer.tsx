import * as React from 'react'

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
 * Renders line, scatter and bar charts as accessible SVG using the approved
 * palette and scientific number formatting. No charting dependency: the
 * three initial types fit a single shared axis system, and keeping the SVG
 * in-tree keeps it accessible (every series, point and axis is real DOM a
 * screen reader can traverse via the tabular alternative) and screenshot-
 * stable across environments.
 *
 * Accessibility:
 *  - `ChartFrame` owns the figure semantics (role=figure, labelled title,
 *    sr-only `alt` description).
 *  - The SVG carries `role="img"` and a `<title>`/`<desc>` pair that
 *    summarises the plotted series.
 *  - The tabular alternative (`ChartTableAlternative`) renders the exact
 *    rows the chart plots, so the data is reachable without the visual.
 *  - Series are distinguishable by colour AND dash/symbol so non-colour
 *    perception still works (DESIGN.md "non-colour distinctions").
 */

const PLOT_W = 560
const PLOT_H = 240
const MARGIN = { top: 16, right: 16, bottom: 32, left: 64 }

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
  const allPoints = materialised.series.flatMap((s) => s.points)
  const finiteX = allPoints
    .map((p) => p.x)
    .filter((v): v is number => v !== null)
  const finiteY = allPoints
    .map((p) => p.y)
    .filter((v): v is number => v !== null)
  const xScale = makeScale(finiteX, spec?.display.axes.x.scale ?? 'linear')
  const yScale = makeScale(finiteY, spec?.display.axes.y.scale ?? 'linear')
  const innerW = PLOT_W - MARGIN.left - MARGIN.right
  const innerH = PLOT_H - MARGIN.top - MARGIN.bottom
  const xTicks = makeTicks(xScale, 5)
  const yTicks = makeTicks(yScale, 4)
  const titleId = React.useId()
  const descId = React.useId()
  return (
    <svg
      viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
      className="h-[240px] w-full"
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
    >
      <title id={titleId}>
        {spec?.display.axes.x.label ?? materialised.xLabel} vs{' '}
        {spec?.display.axes.y.label ?? materialised.yLabel}
      </title>
      <desc id={descId}>{describeSeries(materialised)}</desc>
      {/* y gridlines + ticks */}
      {yTicks.map((t) => {
        const y = MARGIN.top + innerH - yScale.toPixels(t)
        return (
          <g key={`y${t}`}>
            <line
              x1={MARGIN.left}
              y1={y}
              x2={PLOT_W - MARGIN.right}
              y2={y}
              stroke="#dfe3e8"
            />
            <text
              x={MARGIN.left - 8}
              y={y + 4}
              textAnchor="end"
              fontSize="11"
              fill="#6b7280"
            >
              {formatScientific(t)}
            </text>
          </g>
        )
      })}
      {/* x ticks */}
      {xTicks.map((t) => {
        const x = MARGIN.left + xScale.toPixels(t)
        return (
          <g key={`x${t}`}>
            <line
              x1={x}
              y1={MARGIN.top}
              x2={x}
              y2={MARGIN.top + innerH}
              stroke="#eef0f3"
            />
            <text
              x={x}
              y={PLOT_H - 10}
              textAnchor="middle"
              fontSize="11"
              fill="#6b7280"
            >
              {formatScientific(t)}
            </text>
          </g>
        )
      })}
      {/* axes labels */}
      <text
        x={MARGIN.left + innerW / 2}
        y={PLOT_H - 0}
        textAnchor="middle"
        fontSize="11"
        fill="#4b5563"
      >
        {axisLabel(materialised.xLabel, materialised.xUnit)}
      </text>
      <text
        x={12}
        y={MARGIN.top + innerH / 2}
        textAnchor="middle"
        fontSize="11"
        fill="#4b5563"
        transform={`rotate(-90 12 ${MARGIN.top + innerH / 2})`}
      >
        {axisLabel(materialised.yLabel, materialised.yUnit)}
      </text>
      {/* series */}
      {materialised.series.map((s, i) => (
        <SeriesGlyph
          key={s.identifier}
          series={s}
          index={i}
          type={type}
          xScale={xScale}
          yScale={yScale}
          innerH={innerH}
        />
      ))}
    </svg>
  )
}

function SeriesGlyph({
  series,
  index,
  type,
  xScale,
  yScale,
  innerH,
}: {
  series: MaterialisedSeries
  index: number
  type: ChartType
  xScale: Scale
  yScale: Scale
  innerH: number
}) {
  const color = series.color
  // Dash pattern rotates through a small set so non-colour perception
  // still distinguishes series (DESIGN.md non-colour distinctions).
  const dashes = ['', '6 5', '2 4', '10 5 2 5']
  const dash = dashes[index % dashes.length]
  const pts = series.points
    .map((p) => {
      if (p.x === null || p.y === null) return null
      const px = MARGIN.left + xScale.toPixels(p.x)
      const py = MARGIN.top + innerH - yScale.toPixels(p.y)
      return { px, py, p }
    })
    .filter(
      (
        v,
      ): v is {
        px: number
        py: number
        p: (typeof series.points)[number]
      } => v !== null,
    )
  if (pts.length === 0) return null
  if (type === 'bar') {
    const innerW = PLOT_W - MARGIN.left - MARGIN.right
    const barW = Math.max(2, innerW / (pts.length * 2))
    const baseY = MARGIN.top + innerH - yScale.toPixels(yScale.min)
    return (
      <g>
        {pts.map(({ px, py, p }, i) => {
          const h = Math.max(0, baseY - py)
          return (
            <g key={i}>
              <rect
                x={px - barW / 2}
                y={py}
                width={barW}
                height={h}
                fill={color}
                opacity={0.85}
              />
              {p.yError !== null && p.yError !== undefined ? (
                <ErrorBar
                  cx={px}
                  cy={py}
                  yError={p.yError}
                  yScale={yScale}
                  color={color}
                />
              ) : null}
            </g>
          )
        })}
      </g>
    )
  }
  if (type === 'scatter') {
    return (
      <g>
        {pts.map(({ px, py, p }, i) => (
          <g key={i}>
            <circle
              cx={px}
              cy={py}
              r={3.5}
              fill="white"
              stroke={color}
              strokeWidth={2}
            />
            {p.yError !== null && p.yError !== undefined ? (
              <ErrorBar
                cx={px}
                cy={py}
                yError={p.yError}
                yScale={yScale}
                color={color}
              />
            ) : null}
          </g>
        ))}
      </g>
    )
  }
  // line (default)
  const poly = pts.map(({ px, py }) => `${px},${py}`).join(' ')
  return (
    <g>
      <polyline
        points={poly}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray={dash}
      />
      {pts.map(({ px, py, p }, i) => (
        <g key={i}>
          <circle
            cx={px}
            cy={py}
            r={3}
            fill="white"
            stroke={color}
            strokeWidth={2}
          />
          {p.yError !== null && p.yError !== undefined ? (
            <ErrorBar
              cx={px}
              cy={py}
              yError={p.yError}
              yScale={yScale}
              color={color}
            />
          ) : null}
        </g>
      ))}
    </g>
  )
}

function ErrorBar({
  cx,
  cy,
  yError,
  yScale,
  color,
}: {
  cx: number
  cy: number
  yError: number
  yScale: Scale
  color: string
}) {
  const half = yScale.toPixels(yError) - yScale.toPixels(0)
  const top = cy - half
  const bottom = cy + half
  return (
    <g stroke={color} strokeWidth={1.5}>
      <line x1={cx} y1={top} x2={cx} y2={bottom} />
      <line x1={cx - 3} y1={top} x2={cx + 3} y2={top} />
      <line x1={cx - 3} y1={bottom} x2={cx + 3} y2={bottom} />
    </g>
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
// Scales + ticks
// ---------------------------------------------------------------------------

interface Scale {
  min: number
  max: number
  toPixels: (v: number) => number
}

function makeScale(values: number[], scale: 'linear' | 'log'): Scale {
  if (values.length === 0) {
    return { min: 0, max: 1, toPixels: () => 0 }
  }
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (scale === 'log') {
    const pos = values.filter((v) => v > 0)
    min = pos.length ? Math.min(...pos) : 1
    max = pos.length ? Math.max(...pos) : 10
    // Pad to nice log decades.
    min = Math.pow(10, Math.floor(Math.log10(min)))
    max = Math.pow(10, Math.ceil(Math.log10(max)))
    const logMin = Math.log10(min)
    const logMax = Math.log10(max)
    const innerW = PLOT_W - MARGIN.left - MARGIN.right
    return {
      min,
      max,
      toPixels: (v) => {
        if (v <= 0) return 0
        const t = (Math.log10(v) - logMin) / (logMax - logMin || 1)
        return t * innerW
      },
    }
  }
  if (min === max) {
    min = min - 1
    max = max + 1
  }
  // Pad linear by 5%.
  const pad = (max - min) * 0.05
  min = min - pad
  max = max + pad
  const span = max - min || 1
  const innerW = PLOT_W - MARGIN.left - MARGIN.right
  return {
    min,
    max,
    toPixels: (v) => ((v - min) / span) * innerW,
  }
}

function makeTicks(scale: Scale, count: number): number[] {
  if (scale.min === scale.max) return [scale.min]
  const step = (scale.max - scale.min) / count
  const ticks: number[] = []
  for (let i = 0; i <= count; i++) {
    ticks.push(scale.min + step * i)
  }
  return ticks
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
