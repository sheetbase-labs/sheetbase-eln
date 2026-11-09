/**
 * A small dose–response plot: the fitted points and the curve on a log-dose
 * axis, drawn as SVG so it needs no chart library.
 */
import { t } from '#/copy'
import type { SampleCurve } from '#/lib/plate-assay'
import { curveValue } from '#/lib/curve-fit'

const W = 360
const H = 200
const PAD = { left: 44, right: 12, top: 10, bottom: 30 }

function valueAt(curve: SampleCurve, x: number): number {
  const A = curve.falling ? curve.top : curve.bottom
  const D = curve.falling ? curve.bottom : curve.top
  const G = curve.asymmetry ?? 1

  const C =
    curve.model === '5pl'
      ? curve.ec50 / (2 ** (1 / G) - 1) ** (1 / curve.hill)
      : curve.ec50

  return curveValue({ A, B: curve.hill, C, D, G }, x, curve.model)
}

export function DoseResponsePlot({ curve }: { curve: SampleCurve }) {
  const xs = curve.points.map((p) => p.x).filter((x) => x > 0)

  if (xs.length < 2) return null
  const lx0 = Math.log10(Math.min(...xs))
  const lx1 = Math.log10(Math.max(...xs))
  const span = lx1 - lx0 || 1
  const ys = curve.points.map((p) => p.y)
  const y0 = Math.min(...ys, curve.bottom, curve.top)
  const y1 = Math.max(...ys, curve.bottom, curve.top)
  const ySpan = y1 - y0 || 1

  const px = (x: number) =>
    PAD.left + ((Math.log10(x) - lx0) / span) * (W - PAD.left - PAD.right)

  const py = (y: number) =>
    H - PAD.bottom - ((y - y0) / ySpan) * (H - PAD.top - PAD.bottom)

  const steps = 60
  const path: string[] = []

  for (let i = 0; i <= steps; i++) {
    const x = 10 ** (lx0 + (span * i) / steps)
    const y = valueAt(curve, x)

    if (!Number.isFinite(y)) continue
    path.push(
      `${path.length === 0 ? 'M' : 'L'}${px(x).toFixed(1)},${py(y).toFixed(1)}`,
    )
  }

  const ticks = [y0, (y0 + y1) / 2, y1]
  const label = t('plates.curves.plotLabel', { label: curve.label })

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full max-w-[420px] text-fg-muted"
    >
      <title>{label}</title>
      {ticks.map((v) => (
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
      <line
        x1={px(
          curve.ec50 > 0
            ? Math.min(Math.max(curve.ec50, 10 ** lx0), 10 ** lx1)
            : 1,
        )}
        x2={px(
          curve.ec50 > 0
            ? Math.min(Math.max(curve.ec50, 10 ** lx0), 10 ** lx1)
            : 1,
        )}
        y1={PAD.top}
        y2={H - PAD.bottom}
        stroke="currentColor"
        strokeDasharray="3 3"
        strokeOpacity={0.5}
      />
      <path
        d={path.join(' ')}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
      />
      {curve.points.map((p) => (
        <circle
          key={p.x}
          cx={px(p.x)}
          cy={py(p.y)}
          r={3.5}
          fill="var(--primary)"
        />
      ))}
      <text x={PAD.left} y={H - 8} fontSize={10} fill="currentColor">
        {Number((10 ** lx0).toPrecision(3))}
      </text>
      <text
        x={W - PAD.right}
        y={H - 8}
        fontSize={10}
        textAnchor="end"
        fill="currentColor"
      >
        {Number((10 ** lx1).toPrecision(3))}
        {curve.concentrationUnit ? ` ${curve.concentrationUnit}` : ''}
      </text>
    </svg>
  )
}
