import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { cn } from '#/lib/utils'
import { formatScientific } from '#/lib/chart-spec'
import type {
  ChartSpec,
  FrozenBoxStats,
  HeatmapMatrix,
  MaterialisedSeries,
} from '#/lib/chart-spec'

/**
 * SCI-01 distribution and grid plots: histogram (binned counts), box
 * (Tukey five-number summaries) and heatmap (aggregated value grid). These
 * render inside `ChartFrame` next to the Cartesian plots in
 * `chart-renderer`, share the approved palette and scientific formatting,
 * and report clicks through the shared selection model so the tabular
 * alternative and the plot stay in sync.
 *
 * Accessibility:
 *  - The histogram is a real recharts bar chart with axis labels.
 *  - The box plot is inline SVG with per-box `<title>` summaries.
 *  - The heatmap is a semantic `<table>` — the visual IS the accessible
 *    alternative, so no separate table is rendered for it.
 */

/** A selected plot element: one point/bar/bin/cell of one series. */
export interface ChartSelection {
  seriesIdentifier: string
  /** Index within the series points (bin index for histograms). */
  index: number
}

export interface PlotSelectionProps {
  selection: ChartSelection | null
  onSelect: (selection: ChartSelection | null) => void
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

export function HistogramPlot({
  spec,
  series,
  height,
  selectionProps,
}: {
  spec: ChartSpec | null
  series: MaterialisedSeries[]
  height: number
  selectionProps: PlotSelectionProps
}) {
  const margin = { top: 16, right: 16, bottom: 32, left: 64 }
  const data = toHistogramData(series)
  return (
    <div
      role="img"
      aria-label={`Histogram. ${describeSeriesCount(series)}`}
      className="w-full"
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={margin} role="img">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="x"
            type="category"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            label={{
              value: spec?.display.axes.x.label ?? 'Bin start',
              position: 'bottom',
              fontSize: 11,
              fill: 'var(--muted-foreground)',
            }}
            tickFormatter={(value) => formatScientific(Number(value))}
          />
          <YAxis
            type="number"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            label={{
              value: 'Count',
              angle: -90,
              position: 'insideLeft',
              fontSize: 11,
              fill: 'var(--muted-foreground)',
            }}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => formatScientific(Number(value))}
            labelFormatter={(label) =>
              `bin ≥ ${formatScientific(Number(label))}`
            }
          />
          {series.map((s) => (
            <Bar
              key={s.identifier}
              dataKey={s.identifier}
              name={s.label}
              fill={s.color}
              opacity={
                selectionProps.selection === null ||
                selectionProps.selection.seriesIdentifier === s.identifier
                  ? 0.85
                  : 0.3
              }
              onClick={(_, index) =>
                selectionProps.onSelect({
                  seriesIdentifier: s.identifier,
                  index,
                })
              }
              className="cursor-pointer"
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function toHistogramData(series: MaterialisedSeries[]) {
  // Histogram bins share edges, so every series has the same x positions.
  const xMap = new Map<number, Record<string, number | null>>()
  for (const item of series) {
    for (const point of item.points) {
      if (point.x === null) continue
      const row = xMap.get(point.x) ?? { x: point.x }
      row[item.identifier] = point.y
      xMap.set(point.x, row)
    }
  }
  return Array.from(xMap.values()).sort(
    (a, b) => (a.x as number) - (b.x as number),
  )
}

// ---------------------------------------------------------------------------
// Box plot (inline SVG)
// ---------------------------------------------------------------------------

export function BoxPlotChart({
  series,
  height,
  logScale,
  selectionProps,
}: {
  series: MaterialisedSeries[]
  height: number
  logScale: boolean
  selectionProps: PlotSelectionProps
}) {
  const boxes: Array<{ series: MaterialisedSeries; box: FrozenBoxStats }> = []
  for (const s of series) {
    const box = s.points[0]?.box
    if (box) boxes.push({ series: s, box })
  }
  if (boxes.length === 0)
    return (
      <div
        role="img"
        aria-label="Box plot with no plottable groups."
        style={{ height }}
      />
    )

  const values = boxes.flatMap(({ box }) => [box.lo, box.hi, ...box.outliers])
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pad = (rawMax - rawMin || Math.abs(rawMax) || 1) * 0.08
  const min = logScale ? Math.max(rawMin - pad, Number.MIN_VALUE) : rawMin - pad
  const max = rawMax + pad

  const width = 560
  const padLeft = 64
  const padRight = 16
  const padTop = 12
  const padBottom = 28
  const innerW = width - padLeft - padRight
  const innerH = height - padTop - padBottom

  const toPx = (v: number): number => {
    if (logScale) {
      const lmin = Math.log10(min)
      const lmax = Math.log10(max)
      const lv = Math.log10(Math.max(v, Number.MIN_VALUE))
      return padTop + innerH - ((lv - lmin) / (lmax - lmin || 1)) * innerH
    }
    return padTop + innerH - ((v - min) / (max - min || 1)) * innerH
  }

  const band = innerW / boxes.length
  const boxWidth = Math.min(48, band * 0.5)
  const ticks = logScale ? logTicks(min, max) : linearTicks(min, max, 4)

  return (
    <div
      role="img"
      aria-label={`Box plot. ${describeSeriesCount(series)}`}
      className="w-full"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height }}
        role="presentation"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={toPx(t)}
              y2={toPx(t)}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <text
              x={padLeft - 6}
              y={toPx(t) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {formatScientific(t)}
            </text>
          </g>
        ))}
        {boxes.map(({ series: s, box }, i) => {
          const center = padLeft + band * i + band / 2
          const selected =
            selectionProps.selection?.seriesIdentifier === s.identifier
          const dimmed = selectionProps.selection !== null && !selected
          const summary = `n=${box.n}; median ${formatScientific(box.median)}; IQR ${formatScientific(box.q1)}–${formatScientific(box.q3)}; whiskers ${formatScientific(box.lo)}–${formatScientific(box.hi)}; outliers ${box.outliers.length}`
          return (
            <g
              key={s.identifier}
              onClick={() =>
                selectionProps.onSelect({
                  seriesIdentifier: s.identifier,
                  index: 0,
                })
              }
              className="cursor-pointer"
              opacity={dimmed ? 0.35 : 1}
            >
              <title>{`${s.label}: ${summary}`}</title>
              {/* whiskers */}
              <line
                x1={center}
                x2={center}
                y1={toPx(box.lo)}
                y2={toPx(box.q1)}
                stroke={s.color}
                strokeWidth={1.5}
              />
              <line
                x1={center}
                x2={center}
                y1={toPx(box.q3)}
                y2={toPx(box.hi)}
                stroke={s.color}
                strokeWidth={1.5}
              />
              <line
                x1={center - boxWidth / 3}
                x2={center + boxWidth / 3}
                y1={toPx(box.lo)}
                y2={toPx(box.lo)}
                stroke={s.color}
                strokeWidth={1.5}
              />
              <line
                x1={center - boxWidth / 3}
                x2={center + boxWidth / 3}
                y1={toPx(box.hi)}
                y2={toPx(box.hi)}
                stroke={s.color}
                strokeWidth={1.5}
              />
              {/* IQR box */}
              <rect
                x={center - boxWidth / 2}
                y={toPx(box.q3)}
                width={boxWidth}
                height={Math.max(1, toPx(box.q1) - toPx(box.q3))}
                fill={s.color}
                fillOpacity={0.25}
                stroke={s.color}
                strokeWidth={selected ? 2.5 : 1.5}
              />
              {/* median */}
              <line
                x1={center - boxWidth / 2}
                x2={center + boxWidth / 2}
                y1={toPx(box.median)}
                y2={toPx(box.median)}
                stroke={s.color}
                strokeWidth={2.5}
              />
              {/* outliers */}
              {box.outliers.map((o, j) => (
                <circle
                  key={j}
                  cx={center}
                  cy={toPx(o)}
                  r={3}
                  fill="var(--popover)"
                  stroke={s.color}
                  strokeWidth={1.5}
                />
              ))}
              <text
                x={center}
                y={height - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {s.label.length > 16 ? `${s.label.slice(0, 15)}…` : s.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function linearTicks(min: number, max: number, count: number): number[] {
  return Array.from(
    { length: count + 1 },
    (_, i) => min + ((max - min) / count) * i,
  )
}

function logTicks(min: number, max: number): number[] {
  const ticks: number[] = []
  const lmin = Math.ceil(Math.log10(min))
  const lmax = Math.floor(Math.log10(max))
  for (let e = lmin; e <= lmax; e++) ticks.push(10 ** e)
  return ticks.length > 0 ? ticks : [min, max]
}

// ---------------------------------------------------------------------------
// Heatmap (semantic table with a sequential colour scale)
// ---------------------------------------------------------------------------

const HEAT_LOW = { r: 240, g: 246, b: 255 }
const HEAT_HIGH = { r: 0, g: 110, b: 220 }

export function heatColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t))
  const r = Math.round(HEAT_LOW.r + (HEAT_HIGH.r - HEAT_LOW.r) * clamped)
  const g = Math.round(HEAT_LOW.g + (HEAT_HIGH.g - HEAT_LOW.g) * clamped)
  const b = Math.round(HEAT_LOW.b + (HEAT_HIGH.b - HEAT_LOW.b) * clamped)
  return `rgb(${r}, ${g}, ${b})`
}

export function HeatmapPlot({
  heatmap,
  valueLabel,
  selectionProps,
}: {
  heatmap: HeatmapMatrix
  valueLabel: string
  selectionProps: PlotSelectionProps
}) {
  const span =
    heatmap.max !== null && heatmap.min !== null
      ? heatmap.max - heatmap.min || 1
      : 1
  const cellMap = new Map(
    heatmap.cells.map((c) => [`${c.x},${c.y}`, c] as const),
  )
  const yLabels = heatmap.yLabels ?? ['']
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs">
        <caption className="sr-only">
          {`Heatmap grid of ${valueLabel} (${heatmap.aggregate}) with ${heatmap.xLabels.length} × ${yLabels.length} cells.`}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1" />
            {heatmap.xLabels.map((label) => (
              <th
                key={label}
                scope="col"
                className="px-2 py-1 text-left font-medium text-muted-foreground"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {yLabels.map((yLabel, y) => (
            <tr key={yLabel} className="odd:bg-background">
              <th
                scope="row"
                className="whitespace-nowrap px-2 py-1 text-left font-medium text-muted-foreground"
              >
                {yLabel}
              </th>
              {heatmap.xLabels.map((xLabel, x) => {
                const cell = cellMap.get(`${x},${y}`)
                const value = cell?.value ?? null
                const background =
                  value === null
                    ? 'var(--muted)'
                    : heatColor((value - (heatmap.min ?? 0)) / span)
                const selected =
                  selectionProps.selection !== null &&
                  selectionProps.selection.seriesIdentifier === 'heatmap' &&
                  selectionProps.selection.index ===
                    y * heatmap.xLabels.length + x
                return (
                  <td key={xLabel} className="p-0">
                    <button
                      type="button"
                      className={cn(
                        'm-0.5 min-w-14 rounded-[4px] px-2 py-1 font-mono tabular-nums transition-[outline]',
                        selected && 'outline outline-2 outline-foreground',
                      )}
                      style={{
                        background,
                        color:
                          value !== null &&
                          (value - (heatmap.min ?? 0)) / span > 0.6
                            ? 'white'
                            : 'var(--foreground)',
                      }}
                      onClick={() =>
                        selectionProps.onSelect(
                          selected
                            ? null
                            : {
                                seriesIdentifier: 'heatmap',
                                index: y * heatmap.xLabels.length + x,
                              },
                        )
                      }
                      aria-pressed={selected}
                      title={
                        cell
                          ? `${xLabel} × ${yLabel}: ${formatScientific(value)} (${cell.count} rows)`
                          : `${xLabel} × ${yLabel}: no data`
                      }
                    >
                      {value === null ? '—' : formatScientific(value)}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-muted-foreground">
        Colour scale {formatScientific(heatmap.min)} →{' '}
        {formatScientific(heatmap.max)}
        {heatmap.aggregate !== 'count'
          ? `; ${heatmap.aggregate} of ${valueLabel}`
          : '; row count'}
        .
      </p>
    </div>
  )
}

function describeSeriesCount(series: MaterialisedSeries[]): string {
  const parts = series.map((s) => `${s.label}: ${s.points.length} bins`)
  return `${series.length} series — ${parts.join('; ')}.`
}
