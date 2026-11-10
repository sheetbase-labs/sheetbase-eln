/**
 * A Levey-Jennings chart: each run's value in order, against the mean and the
 * ±1, ±2 and ±3 SD lines. Drawn as SVG so it needs no chart library, and read
 * in both themes from the app's colour tokens.
 */
import { t } from '#/copy'
import { chartRange, zoneOf } from '#/lib/run-qc'
import type { QcPointRow, QcSeriesRow } from '#/lib/run-qc'
import { formatDate } from '#/lib/format-date'

/** Rule labels, for the chips and checkboxes that name a QC rule. */
export { ruleLabel } from './run-qc-labels'

const W = 760
const H = 260
const PAD = { left: 56, right: 16, top: 12, bottom: 28 }

const ZONE_FILL = {
  centre: 'var(--primary)',
  warn: 'var(--warning)',
  out: 'var(--destructive)',
  none: 'var(--fg-muted)',
} as const

function short(value: number): string {
  return String(Number(value.toPrecision(4)))
}

export function LeveyJenningsChart({
  series,
  points,
}: {
  series: QcSeriesRow
  points: readonly QcPointRow[]
}) {
  const range = chartRange(series, points)
  const limited = series.mean !== null && series.sd !== null && series.sd > 0
  const count = points.length

  const px = (index: number) =>
    count <= 1
      ? (PAD.left + W - PAD.right) / 2
      : PAD.left + (index / (count - 1)) * (W - PAD.left - PAD.right)

  const py = (value: number) =>
    H -
    PAD.bottom -
    ((value - range.lo) / (range.hi - range.lo)) * (H - PAD.top - PAD.bottom)

  const label = t('quality.runQc.chart.label', { name: series.name })
  const mean = series.mean
  const sd = series.sd

  const line = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p.value).toFixed(1)}`,
    )
    .join(' ')

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full text-fg-muted"
    >
      <title>{label}</title>
      {limited && mean !== null && sd !== null ? (
        <g>
          <rect
            x={PAD.left}
            width={W - PAD.left - PAD.right}
            y={py(mean + 3 * sd)}
            height={py(mean - 3 * sd) - py(mean + 3 * sd)}
            fill="var(--destructive)"
            fillOpacity={0.06}
          />
          <rect
            x={PAD.left}
            width={W - PAD.left - PAD.right}
            y={py(mean + 2 * sd)}
            height={py(mean - 2 * sd) - py(mean + 2 * sd)}
            fill="var(--warning)"
            fillOpacity={0.1}
          />
          <rect
            x={PAD.left}
            width={W - PAD.left - PAD.right}
            y={py(mean + sd)}
            height={py(mean - sd) - py(mean + sd)}
            fill="var(--success)"
            fillOpacity={0.1}
          />
        </g>
      ) : null}
      {range.ticks.map((tick, i) => {
        const k = limited && sd ? Math.round((tick - mean!) / sd) : null
        const isMean = k === 0

        return (
          <g key={`${i}-${tick}`}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={py(tick)}
              y2={py(tick)}
              stroke="currentColor"
              strokeOpacity={isMean ? 0.7 : Math.abs(k ?? 0) === 3 ? 0.45 : 0.2}
              strokeDasharray={isMean ? undefined : '4 3'}
            />
            <text
              x={PAD.left - 8}
              y={py(tick) + 3}
              textAnchor="end"
              fontSize={10}
              fill="currentColor"
            >
              {short(tick)}
            </text>
            {k !== null && k !== 0 ? (
              <text
                x={W - PAD.right - 2}
                y={py(tick) - 3}
                textAnchor="end"
                fontSize={9}
                fill="currentColor"
                fillOpacity={0.8}
              >
                {t('quality.runQc.chart.band', {
                  value: k > 0 ? `+${k}` : `−${Math.abs(k)}`,
                })}
              </text>
            ) : isMean ? (
              <text
                x={W - PAD.right - 2}
                y={py(tick) - 3}
                textAnchor="end"
                fontSize={9}
                fill="currentColor"
                fillOpacity={0.8}
              >
                {t('quality.runQc.chart.mean')}
              </text>
            ) : null}
          </g>
        )
      })}
      {count > 1 ? (
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={1}
        />
      ) : null}
      {points.map((p, i) => {
        const zone = zoneOf(p)
        const fill = ZONE_FILL[zone]

        const title = [
          t('quality.runQc.chart.pointTitle', {
            label: p.label ?? formatDate(p.at, { time: true }),
            value: short(p.value),
          }),
          p.violations.length > 0
            ? t('quality.runQc.chart.pointBroke', {
                rules: p.violations.join(', '),
              })
            : null,
          p.excluded ? t('quality.runQc.chart.pointLeftOut') : null,
        ]
          .filter(Boolean)
          .join(' · ')

        return (
          <g key={p.id}>
            <title>{title}</title>
            {zone === 'out' ? (
              <circle
                cx={px(i)}
                cy={py(p.value)}
                r={7}
                fill="none"
                stroke="var(--destructive)"
                strokeOpacity={0.5}
              />
            ) : null}
            <circle
              cx={px(i)}
              cy={py(p.value)}
              r={3.5}
              fill={p.excluded ? 'var(--surface)' : fill}
              stroke={fill}
              strokeWidth={p.excluded ? 1.5 : 0}
            />
          </g>
        )
      })}
      {count > 0 ? (
        <>
          <text x={PAD.left} y={H - 8} fontSize={10} fill="currentColor">
            {formatDate(points[0].at)}
          </text>
          <text
            x={W - PAD.right}
            y={H - 8}
            fontSize={10}
            textAnchor="end"
            fill="currentColor"
          >
            {formatDate(points[count - 1].at)}
          </text>
        </>
      ) : null}
    </svg>
  )
}
