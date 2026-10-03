import { seriesStyle } from '@sheetbase-labs/sheetbase-explorer'

import { formatScientific } from '#/lib/chart-spec'
import type { FrozenBoxStats, MaterialisedSeries } from '#/lib/chart-spec'

/**
 * SCI-01 distribution plots the package's v3 figure has no primitive for:
 * histogram (binned counts) and violin (the ELN draws the group's box summary —
 * the package has no density primitive). Bar, summary, box and heatmap are now
 * drawn by `sheetbase-explorer`'s `FigureSvg` in `chart-renderer`; these
 * renderers share the v3 series tokens (never literal colours) and scientific
 * formatting, and report clicks through the shared selection model so the
 * tabular alternative and the plot stay in sync.
 *
 * Accessibility:
 *  - The histogram is inline SVG with labelled axes and a per-bar `<title>`.
 *  - The violin's box marks carry per-group `<title>` summaries.
 */

/** A selected plot element: one point/bar/bin of one series. */
export interface ChartSelection {
  seriesIdentifier: string
  /** Index within the series points (bin index for histograms). */
  index: number
}

export interface PlotSelectionProps {
  selection: ChartSelection | null
  onSelect: (selection: ChartSelection | null) => void
}

const PLOT_WIDTH = 560
const PLOT_PAD_LEFT = 64
const PLOT_PAD_RIGHT = 16
const PLOT_PAD_TOP = 12
const PLOT_PAD_BOTTOM = 28

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

function describeSeriesCount(series: MaterialisedSeries[]): string {
  const parts = series.map((s) => `${s.label}: ${s.points.length} bins`)
  return `${series.length} series — ${parts.join('; ')}.`
}

// ---------------------------------------------------------------------------
// Histogram (inline SVG)
// ---------------------------------------------------------------------------

function xPositions(series: MaterialisedSeries[]): number[] {
  const set = new Set<number>()
  for (const item of series) {
    for (const point of item.points) {
      if (point.x !== null && point.y !== null) set.add(point.x)
    }
  }
  return [...set].sort((a, b) => a - b)
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
  const ariaLabel = `Histogram. ${describeSeriesCount(series)}`
  const positions = xPositions(series)
  if (positions.length === 0 || series.length === 0)
    return <div role="img" aria-label={ariaLabel} style={{ height }} />

  const perPosition = positions.map((x) => ({
    x,
    values: series.map((s) => {
      const index = s.points.findIndex((p) => p.x === x && p.y !== null)
      return index === -1 ? null : { point: s.points[index], index }
    }),
  }))
  const rawMax = Math.max(
    0,
    ...perPosition.flatMap((position) =>
      position.values.map((entry) => entry?.point.y ?? 0),
    ),
  )
  const pad = (rawMax || 1) * 0.06
  const max = rawMax + pad
  const innerW = PLOT_WIDTH - PLOT_PAD_LEFT - PLOT_PAD_RIGHT
  const innerH = height - PLOT_PAD_TOP - PLOT_PAD_BOTTOM
  const toPx = (v: number) => PLOT_PAD_TOP + innerH - (v / (max || 1)) * innerH

  const band = innerW / positions.length
  const groupWidth = band * 0.72
  const barWidth = groupWidth / series.length
  const ticks = linearTicks(0, max, 4)

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
        {perPosition.map((position, pi) => {
          const center = PLOT_PAD_LEFT + band * pi + band / 2
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
                const x0 = center - groupWidth / 2 + si * barWidth
                const yTop = toPx(value)
                const yBase = toPx(0)
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
                  </g>
                )
              })}
            </g>
          )
        })}
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
          {yLabel}
        </text>
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Violin (the group's box summary, inline SVG)
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
