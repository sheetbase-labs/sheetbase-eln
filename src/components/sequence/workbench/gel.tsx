/**
 * A gel as it would look: a ladder lane and one lane per digest, with bands
 * where the fragments would run and brighter where several share a size.
 */
import { t } from '#/copy'
import { LADDER_100BP, LADDER_1KB, formatBp, gelBands } from '#/lib/molbio'
import { cn } from '#/lib/utils'

export interface GelLane {
  label: string
  sizes: readonly number[]
}

export function Gel({
  lanes,
  ladder,
  className,
}: {
  lanes: readonly GelLane[]
  ladder: '1kb' | '100bp'
  className?: string
}) {
  const marker = ladder === '1kb' ? LADDER_1KB : LADDER_100BP
  const all: GelLane[] = [
    { label: t('molbio.gel.ladder'), sizes: marker },
    ...lanes,
  ]
  const laneW = 74
  const padX = 56
  const W = padX + all.length * laneW + 16
  const H = 330
  const top = 42
  const bottom = 18
  const y = (pos: number) => top + pos * (H - top - bottom)
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t('molbio.gel.label', { count: lanes.length })}
      className={cn('block h-auto w-full max-w-xl rounded-md', className)}
      style={{ background: 'var(--gel-bg)' }}
    >
      {all.map((lane, li) => {
        const cx = padX + li * laneW + laneW / 2
        const isLadder = li === 0
        const bands = gelBands(lane.sizes, marker)
        return (
          <g key={`${lane.label}-${li}`}>
            <rect
              x={cx - 24}
              y={top - 12}
              width={48}
              height={8}
              rx={2}
              fill="var(--gel-well)"
            />
            <text
              x={cx}
              y={top - 20}
              textAnchor="middle"
              fill="var(--gel-label)"
              className="text-[10px]"
            >
              {lane.label.length > 11
                ? `${lane.label.slice(0, 10)}…`
                : lane.label}
            </text>
            {bands.map((b) => (
              <g key={b.size}>
                <rect
                  x={cx - 22}
                  y={y(b.position) - 2}
                  width={44}
                  height={isLadder ? 3 : 4}
                  rx={1.5}
                  fill={isLadder ? 'var(--gel-ladder)' : 'var(--gel-band)'}
                  opacity={isLadder ? 0.8 : Math.min(1, 0.65 + b.count * 0.18)}
                />
                {isLadder ? (
                  <text
                    x={padX - 6}
                    y={y(b.position) + 3}
                    textAnchor="end"
                    fill="var(--gel-ladder)"
                    className="text-[9px]"
                  >
                    {formatBp(b.size)}
                  </text>
                ) : (
                  <title>
                    {b.count > 1
                      ? t('molbio.gel.bandMany', {
                          size: formatBp(b.size),
                          count: b.count,
                        })
                      : formatBp(b.size)}
                  </title>
                )}
              </g>
            ))}
          </g>
        )
      })}
    </svg>
  )
}
