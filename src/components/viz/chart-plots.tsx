import { seriesStyle } from '@sheetbase-labs/sheetbase-explorer'

import { cn } from '#/lib/utils'
import { formatScientific } from '#/lib/chart-spec'
import type {
  ChartAnnotation,
  FrozenBoxStats,
  HeatmapMatrix,
  MaterialisedSeries,
  ReferenceOverlay,
} from '#/lib/chart-spec'

/**
 * SCI-01 distribution and grid plots: histogram (binned counts), bar and
 * summary plots (categorical measures), box (Tukey five-number summaries) and
 * heatmap (aggregated value grid). They render inside `ChartFrame` next to the
 * package point/line figures in `chart-renderer`, share the v3 series tokens
 * (never literal colours) and scientific formatting, and report clicks through
 * the shared selection model so the tabular alternative and the plot stay in
 * sync.
 *
 * The package's `FigureSvg` has primitives for markers and polylines only, so
 * bar-shaped marks are drawn here from the materialised points — see COMP-07's
 * `deferred` note.
 *
 * Accessibility:
 *  - Bar plots and box plots are inline SVG with labelled axes and per-mark
 *    `<title>`/`aria-label` summaries.
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
// Bar plots (bar, grouped_bar, stacked_bar, summary)
// ---------------------------------------------------------------------------

const PLOT_WIDTH = 560
const PLOT_PAD_LEFT = 64
const PLOT_PAD_RIGHT = 16
const PLOT_PAD_TOP = 12
const PLOT_PAD_BOTTOM = 28

function xPositions(series: MaterialisedSeries[]): number[] {
  const set = new Set<number>()
  for (const item of series) {
    for (const point of item.points) {
      if (point.x !== null && point.y !== null) set.add(point.x)
    }
  }
  return [...set].sort((a, b) => a - b)
}

function errorExtent(point: { y: number | null; yError?: number | null }): {
  lo: number
  hi: number
} | null {
  if (point.y === null || point.yError === null || point.yError === undefined)
    return null
  return { lo: point.y - point.yError, hi: point.y + point.yError }
}

export function BarPlotChart({
  series,
  height,
  stacking,
  xLabel,
  yLabel,
  yUnit,
  ariaLabel,
  annotations = [],
  references = [],
  selectionProps,
}: {
  series: MaterialisedSeries[]
  height: number
  /** `stacked` sums the series per x; otherwise they sit side by side. */
  stacking: 'grouped' | 'stacked'
  xLabel: string
  yLabel: string
  yUnit?: string
  ariaLabel: string
  /** Text labels pinned at data coordinates (Cartesian types only). */
  annotations?: ChartAnnotation[]
  /** Horizontal/vertical reference lines and shaded bands. */
  references?: ReferenceOverlay[]
  selectionProps: PlotSelectionProps
}) {
  const positions = xPositions(series)
  const plottable = positions.length > 0 && series.length > 0
  if (!plottable)
    return <div role="img" aria-label={ariaLabel} style={{ height }} />

  const perPosition = positions.map((x) => {
    const values: Array<{
      point: MaterialisedSeries['points'][number]
      index: number
    } | null> = series.map((s) => {
      const index = s.points.findIndex((p) => p.x === x && p.y !== null)
      return index === -1 ? null : { point: s.points[index], index }
    })
    const stackedTotal = values.reduce(
      (acc, entry) => acc + (entry?.point.y ?? 0),
      0,
    )
    const tops = values.map((entry) => {
      const error = entry ? errorExtent(entry.point) : null
      return error ? error.hi : (entry?.point.y ?? 0)
    })
    const bottoms = values.map((entry) => {
      const error = entry ? errorExtent(entry.point) : null
      return error ? error.lo : (entry?.point.y ?? 0)
    })
    return {
      x,
      values,
      hi: stacking === 'stacked' ? stackedTotal : Math.max(...tops, 0),
      lo: Math.min(0, ...bottoms),
    }
  })

  const rawMax = Math.max(0, ...perPosition.map((p) => p.hi))
  const rawMin = Math.min(0, ...perPosition.map((p) => p.lo))
  const pad = (rawMax - rawMin || Math.abs(rawMax) || 1) * 0.06
  const min = rawMin
  const max = rawMax + pad

  const innerW = PLOT_WIDTH - PLOT_PAD_LEFT - PLOT_PAD_RIGHT
  const innerH = height - PLOT_PAD_TOP - PLOT_PAD_BOTTOM
  const toPx = (v: number) =>
    PLOT_PAD_TOP + innerH - ((v - min) / (max - min || 1)) * innerH

  const band = innerW / positions.length
  const groupWidth = band * 0.72
  const barWidth = groupWidth / series.length
  const ticks = linearTicks(min, max, 4)
  const firstCenter = PLOT_PAD_LEFT + band / 2
  const lastCenter = PLOT_PAD_LEFT + band * (positions.length - 1) + band / 2
  const xDataToPx = (v: number) =>
    positions.length <= 1
      ? firstCenter
      : firstCenter +
        ((v - positions[0]) /
          (positions[positions.length - 1] - positions[0] || 1)) *
          (lastCenter - firstCenter)

  return (
    <div role="img" aria-label={ariaLabel} className="w-full">
      <svg
        viewBox={`0 0 ${PLOT_WIDTH} ${height}`}
        style={{ width: '100%', height }}
        role="presentation"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PLOT_PAD_LEFT}
              x2={PLOT_WIDTH - PLOT_PAD_RIGHT}
              y1={toPx(t)}
              y2={toPx(t)}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <text
              x={PLOT_PAD_LEFT - 6}
              y={toPx(t) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {formatScientific(t)}
            </text>
          </g>
        ))}
        <g pointerEvents="none">
          {references.map((overlay, index) => {
            if (overlay.kind !== 'band') return null
            return overlay.axis === 'y' ? (
              <rect
                key={`band-${index}`}
                x={PLOT_PAD_LEFT}
                width={innerW}
                y={toPx(overlay.hi)}
                height={Math.max(0, toPx(overlay.lo) - toPx(overlay.hi))}
                fill="var(--muted)"
                fillOpacity={0.25}
              />
            ) : (
              <rect
                key={`band-${index}`}
                y={PLOT_PAD_TOP}
                height={innerH}
                x={xDataToPx(overlay.lo)}
                width={Math.max(
                  0,
                  xDataToPx(overlay.hi) - xDataToPx(overlay.lo),
                )}
                fill="var(--muted)"
                fillOpacity={0.25}
              />
            )
          })}
        </g>
        {perPosition.map((position, pi) => {
          const center = PLOT_PAD_LEFT + band * pi + band / 2
          let stackTop = 0
          return (
            <g key={position.x}>
              {position.values.map((entry, si) => {
                if (!entry) return null
                const value = entry.point.y ?? 0
                const token = seriesStyle(si).colour
                const selected =
                  selectionProps.selection?.seriesIdentifier ===
                    series[si].identifier &&
                  selectionProps.selection.index === entry.index
                const dimmed = selectionProps.selection !== null && !selected
                const x0 =
                  stacking === 'stacked'
                    ? center - groupWidth / 2
                    : center - groupWidth / 2 + si * barWidth
                const yTop = toPx(
                  stacking === 'stacked' ? stackTop + value : value,
                )
                const yBase = toPx(stacking === 'stacked' ? stackTop : 0)
                if (stacking === 'stacked') stackTop += value
                const error = errorExtent(entry.point)
                return (
                  <g key={series[si].identifier} opacity={dimmed ? 0.45 : 1}>
                    <rect
                      x={x0}
                      y={Math.min(yTop, yBase)}
                      width={barWidth - 1}
                      height={Math.max(1, Math.abs(yBase - yTop))}
                      fill={token}
                      fillOpacity={selected ? 0.95 : 0.82}
                      stroke={selected ? 'var(--foreground)' : 'none'}
                      strokeWidth={selected ? 1.5 : 0}
                      className="cursor-pointer"
                      onClick={() =>
                        selectionProps.onSelect({
                          seriesIdentifier: series[si].identifier,
                          index: entry.index,
                        })
                      }
                    >
                      <title>
                        {`${series[si].label} · ${xLabel} ${formatScientific(position.x)}: ${formatScientific(value)}`}
                      </title>
                    </rect>
                    {error ? (
                      <g stroke={token} strokeWidth={1.5}>
                        <line
                          x1={x0 + (barWidth - 1) / 2}
                          x2={x0 + (barWidth - 1) / 2}
                          y1={toPx(error.hi)}
                          y2={toPx(error.lo)}
                        />
                        <line
                          x1={x0 + (barWidth - 1) / 2 - 4}
                          x2={x0 + (barWidth - 1) / 2 + 4}
                          y1={toPx(error.hi)}
                          y2={toPx(error.hi)}
                        />
                        <line
                          x1={x0 + (barWidth - 1) / 2 - 4}
                          x2={x0 + (barWidth - 1) / 2 + 4}
                          y1={toPx(error.lo)}
                          y2={toPx(error.lo)}
                        />
                      </g>
                    ) : null}
                  </g>
                )
              })}
            </g>
          )
        })}
        {/* Guides and labels the bar marks cannot carry themselves. */}
        <g pointerEvents="none">
          {references.map((overlay, index) => {
            if (overlay.kind === 'hline') {
              const y = toPx(overlay.value)
              return (
                <g key={`hover-${index}`}>
                  <line
                    x1={PLOT_PAD_LEFT}
                    x2={PLOT_WIDTH - PLOT_PAD_RIGHT}
                    y1={y}
                    y2={y}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={PLOT_WIDTH - PLOT_PAD_RIGHT}
                    y={y - 4}
                    textAnchor="end"
                    fontSize={10}
                    fill="var(--muted-foreground)"
                  >
                    {overlay.label}
                  </text>
                </g>
              )
            }
            if (overlay.kind === 'vline') {
              const x = xDataToPx(overlay.value)
              return (
                <g key={`vline-${index}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={PLOT_PAD_TOP}
                    y2={PLOT_PAD_TOP + innerH}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={x}
                    y={PLOT_PAD_TOP + 10}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--muted-foreground)"
                  >
                    {overlay.label}
                  </text>
                </g>
              )
            }
            if (overlay.kind === 'identity') {
              const lo = Math.min(positions[0], min)
              const hi = Math.max(positions[positions.length - 1], max)
              return (
                <line
                  key={`identity-${index}`}
                  x1={xDataToPx(lo)}
                  y1={toPx(lo)}
                  x2={xDataToPx(hi)}
                  y2={toPx(hi)}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="2 6"
                />
              )
            }
            return null
          })}
          {annotations.map((annotation, index) => {
            const cx = xDataToPx(annotation.x)
            const cy = toPx(annotation.y)
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
        <text
          x={PLOT_WIDTH / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize={11}
          fill="var(--muted-foreground)"
        >
          {xLabel}
        </text>
        <text
          x={14}
          y={PLOT_PAD_TOP + innerH / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${PLOT_PAD_TOP + innerH / 2})`}
          fontSize={11}
          fill="var(--muted-foreground)"
        >
          {yUnit ? `${yLabel} (${yUnit})` : yLabel}
        </text>
      </svg>
    </div>
  )
}

export function HistogramPlot({
  series,
  height,
  xLabel,
  yLabel,
  selectionProps,
}: {
  series: MaterialisedSeries[]
  height: number
  xLabel: string
  yLabel: string
  selectionProps: PlotSelectionProps
}) {
  return (
    <BarPlotChart
      series={series}
      height={height}
      stacking="grouped"
      xLabel={xLabel}
      yLabel={yLabel}
      ariaLabel={`Histogram. ${describeSeriesCount(series)}`}
      selectionProps={selectionProps}
    />
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
          const token = seriesStyle(i).colour
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
                stroke={token}
                strokeWidth={1.5}
              />
              <line
                x1={center}
                x2={center}
                y1={toPx(box.q3)}
                y2={toPx(box.hi)}
                stroke={token}
                strokeWidth={1.5}
              />
              <line
                x1={center - boxWidth / 3}
                x2={center + boxWidth / 3}
                y1={toPx(box.lo)}
                y2={toPx(box.lo)}
                stroke={token}
                strokeWidth={1.5}
              />
              <line
                x1={center - boxWidth / 3}
                x2={center + boxWidth / 3}
                y1={toPx(box.hi)}
                y2={toPx(box.hi)}
                stroke={token}
                strokeWidth={1.5}
              />
              {/* IQR box */}
              <rect
                x={center - boxWidth / 2}
                y={toPx(box.q3)}
                width={boxWidth}
                height={Math.max(1, toPx(box.q1) - toPx(box.q3))}
                fill={token}
                fillOpacity={0.25}
                stroke={token}
                strokeWidth={selected ? 2.5 : 1.5}
              />
              {/* median */}
              <line
                x1={center - boxWidth / 2}
                x2={center + boxWidth / 2}
                y1={toPx(box.median)}
                y2={toPx(box.median)}
                stroke={token}
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
                  stroke={token}
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
