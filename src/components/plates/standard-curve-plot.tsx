/**
 * A standard curve on a log-concentration axis: the fitted curve, the standards
 * as filled points and each sample read off it as an open point. Drawn as SVG so
 * it needs no chart library.
 */
import { t } from '#/copy'
import { curveValue } from '#/lib/curve-fit'
import { formatQuantity } from '#/lib/format-quantity'
import type { QuantifyResult } from '#/lib/plate-quantify'

const W = 420
const H = 220
const PAD = { left: 52, right: 14, top: 10, bottom: 34 }

export function StandardCurvePlot({ result }: { result: QuantifyResult }) {
  const curve = result.curve

  if (!curve || curve.points.length < 2) return null
  const lx0 = Math.log10(curve.lo)
  const lx1 = Math.log10(curve.hi)
  const span = lx1 - lx0 || 1

  const read = result.samples.flatMap((s) =>
    s.status === 'ok' && s.concentration !== null && s.response !== null
      ? [{ x: s.concentration, y: s.response, key: s.key }]
      : [],
  )

  const ys = [...curve.points.map((p) => p.y), ...read.map((p) => p.y)]
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const ySpan = y1 - y0 || 1

  const px = (x: number) =>
    PAD.left + ((Math.log10(x) - lx0) / span) * (W - PAD.left - PAD.right)

  const py = (y: number) =>
    H - PAD.bottom - ((y - y0) / ySpan) * (H - PAD.top - PAD.bottom)

  const path: string[] = []

  for (let i = 0; i <= 60; i++) {
    const x = 10 ** (lx0 + (span * i) / 60)
    const y = curveValue(curve.params, x, curve.model)

    if (!Number.isFinite(y)) continue
    path.push(
      `${path.length === 0 ? 'M' : 'L'}${px(x).toFixed(1)},${py(y).toFixed(1)}`,
    )
  }

  const label = t('features.plateRuns.quantify.curveLabel')

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full max-w-[460px] text-fg-muted"
    >
      <title>{label}</title>
      {[y0, (y0 + y1) / 2, y1].map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={py(v)}
            y2={py(v)}
            stroke="currentColor"
            strokeOpacity={0.15}
          />
          <text
            x={PAD.left - 6}
            y={py(v) + 3}
            textAnchor="end"
            fontSize={10}
            fill="currentColor"
          >
            {Number(v.toPrecision(3))}
          </text>
        </g>
      ))}
      <path
        d={path.join(' ')}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
      />
      {read.map((p) => (
        <circle
          key={p.key}
          cx={px(p.x)}
          cy={py(p.y)}
          r={3.5}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={1.5}
        />
      ))}
      {curve.points.map((p) => (
        <circle
          key={p.x}
          cx={px(p.x)}
          cy={py(p.y)}
          r={3.5}
          fill="var(--primary)"
        />
      ))}
      <text x={PAD.left} y={H - 10} fontSize={10} fill="currentColor">
        {formatQuantity(curve.lo)}
      </text>
      <text
        x={W - PAD.right}
        y={H - 10}
        fontSize={10}
        textAnchor="end"
        fill="currentColor"
      >
        {formatQuantity(curve.hi)}
        {curve.unit ? ` ${curve.unit}` : ''}
      </text>
    </svg>
  )
}
