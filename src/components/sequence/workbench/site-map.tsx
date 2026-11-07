/**
 * Restriction map: the sequence as a ring or a line, with a mark and a name
 * at every cut of the enzymes you chose.
 */
import { useMemo } from 'react'

import { t } from '#/copy'
import type { Cut } from '#/lib/molbio'
import { cn } from '#/lib/utils'
import { polar, tickStep, formatBases, angleAt } from '../geometry'

export interface MapSite {
  enzyme: string
  /** 0-based top-strand cut point. */
  position: number
  unique: boolean
}

export function sitesFromCuts(
  byEnzyme: readonly { name: string; cuts: readonly Cut[] }[],
): MapSite[] {
  return byEnzyme.flatMap((e) =>
    e.cuts.map((c) => ({
      enzyme: e.name,
      position: c.top,
      unique: e.cuts.length === 1,
    })),
  )
}

/** Spread labels so neighbours do not sit on top of each other. */
function spread(positions: number[], minGap: number): number[] {
  const order = positions.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  const out = [...positions]
  let last = -Infinity
  for (const { p, i } of order) {
    const v = Math.max(p, last + minGap)
    out[i] = v
    last = v
  }
  return out
}

export function SiteMap({
  length,
  topology,
  sites,
  name,
  className,
}: {
  length: number
  topology: 'linear' | 'circular'
  sites: readonly MapSite[]
  name: string
  className?: string
}) {
  const sorted = useMemo(
    () => [...sites].sort((a, b) => a.position - b.position),
    [sites],
  )
  const label = t('molbio.siteMap.label', {
    name,
    count: sorted.length,
  })
  if (length === 0) return null
  return topology === 'circular' ? (
    <Ring length={length} sites={sorted} label={label} className={className} />
  ) : (
    <Line length={length} sites={sorted} label={label} className={className} />
  )
}

function Ring({
  length,
  sites,
  label,
  className,
}: {
  length: number
  sites: readonly MapSite[]
  label: string
  className?: string
}) {
  const W = 760
  const H = 560
  const cx = W / 2
  const cy = H / 2
  const R = 150
  const row = 16
  // Labels sit in a column on each side of the ring, in the order their sites
  // appear, pushed apart so a cluster of cut sites stays readable.
  const placed = useMemo(() => {
    const items = sites.map((s, i) => {
      const a = angleAt(s.position + 1, length)
      const at = polar(cx, cy, R + 20, a)
      return { i, a, side: at.x >= cx ? 1 : -1, y: at.y }
    })
    for (const side of [1, -1]) {
      const column = items
        .filter((it) => it.side === side)
        .sort((x, y) => x.y - y.y)
      let last = -Infinity
      for (const it of column) {
        it.y = Math.max(it.y, last + row)
        last = it.y
      }
      // Pull the column back up if it ran off the bottom.
      let limit = H - 14
      for (const it of [...column].reverse()) {
        it.y = Math.min(it.y, limit)
        limit = it.y - row
      }
    }
    return items
  }, [sites, length, cy])
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label={label}
      className={cn('mx-auto block h-auto w-full max-w-[760px]', className)}
    >
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth={3}
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        className="fill-fg-muted text-[13px]"
      >
        {formatBases(length)} bp
      </text>
      {sites.map((s, i) => {
        const it = placed[i]
        const p1 = polar(cx, cy, R - 7, it.a)
        const p2 = polar(cx, cy, R + 7, it.a)
        const lx = cx + it.side * (R + 70)
        return (
          <g key={`${s.enzyme}-${s.position}`}>
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={s.unique ? 'var(--primary)' : 'var(--muted-foreground)'}
              strokeWidth={s.unique ? 2 : 1.25}
            />
            <polyline
              points={`${p2.x},${p2.y} ${cx + it.side * (R + 40)},${it.y} ${lx - it.side * 4},${it.y}`}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            <text
              x={lx}
              y={it.y}
              textAnchor={it.side === 1 ? 'start' : 'end'}
              dominantBaseline="middle"
              className={cn(
                'text-[11px]',
                s.unique ? 'fill-fg font-medium' : 'fill-fg-muted',
              )}
            >
              {s.enzyme} ({s.position})
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function Line({
  length,
  sites,
  label,
  className,
}: {
  length: number
  sites: readonly MapSite[]
  label: string
  className?: string
}) {
  const W = 1000
  const padX = 40
  const inner = W - padX * 2
  const x = (p: number) => padX + (p / length) * inner
  const labelX = spread(
    sites.map((s) => x(s.position)),
    58,
  )
  // Alternate label rows so close sites stay readable.
  const rows = 3
  const step = tickStep(length, 10)
  const ticks: number[] = []
  for (let p = 0; p <= length; p += step) ticks.push(p)
  const height = 70 + rows * 22
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      role="group"
      aria-label={label}
      className={cn('block h-auto w-full', className)}
    >
      <line
        x1={padX}
        x2={W - padX}
        y1={height - 30}
        y2={height - 30}
        stroke="var(--border-strong)"
        strokeWidth={3}
      />
      {ticks.map((p) => (
        <g key={p}>
          <line
            x1={x(p)}
            x2={x(p)}
            y1={height - 24}
            y2={height - 18}
            stroke="var(--border-strong)"
          />
          <text
            x={x(p)}
            y={height - 5}
            textAnchor="middle"
            className="fill-fg-muted text-[10px]"
          >
            {formatBases(p)}
          </text>
        </g>
      ))}
      {sites.map((s, i) => {
        const row = i % rows
        const ly = 16 + row * 22
        return (
          <g key={`${s.enzyme}-${s.position}`}>
            <line
              x1={x(s.position)}
              x2={labelX[i]}
              y1={height - 30}
              y2={ly + 5}
              stroke={s.unique ? 'var(--primary)' : 'var(--border-strong)'}
              strokeWidth={s.unique ? 1.5 : 1}
            />
            <text
              x={labelX[i]}
              y={ly}
              textAnchor="middle"
              className={cn(
                'text-[11px]',
                s.unique ? 'fill-fg font-medium' : 'fill-fg-muted',
              )}
            >
              {s.enzyme}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
