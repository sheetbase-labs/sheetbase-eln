import { useMemo } from 'react'

import { t } from '#/copy'
import { cn } from '#/lib/utils'
import type { ParsedSequence, SequenceFeature } from '#/lib/sequence'
import {
  angleAt,
  assignLanes,
  featureColour,
  featureLength,
  featureSpans,
  formatBases,
  polar,
  ringSegmentPath,
  tickStep,
} from './geometry'

export interface SequenceMapProps {
  sequence: ParsedSequence
  selectedId: number | null
  onSelect: (id: number | null) => void
  className?: string
}

const UNIT = { dna: 'bp', rna: 'nt', protein: 'aa' } as const

function describe(seq: ParsedSequence): string {
  return t('sequences.viewer.mapLabel', {
    name: seq.name,
    length: formatBases(seq.length),
    unit: UNIT[seq.molecule],
    topology: t(`sequences.summary.${seq.topology}`),
  })
}

function featureTitle(f: SequenceFeature, length: number): string {
  return `${f.label} (${f.type}) ${formatBases(f.start)}..${formatBases(f.end)}, ${formatBases(featureLength(f, length))}`
}

function onKey(action: () => void) {
  return (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
    }
  }
}

/** A plasmid map: the sequence as a ring with its features on it. */
export function CircularMap({
  sequence,
  selectedId,
  onSelect,
  className,
}: SequenceMapProps) {
  const size = 560
  const c = size / 2
  const R = 168
  const { features, length } = sequence
  const lanes = useMemo(() => assignLanes(features, length), [features, length])
  const laneCount = Math.max(1, ...[...lanes.values()].map((l) => l + 1))
  const thick = laneCount > 4 ? 10 : 16
  const gap = thick + 4

  // Labels go outside the ring, longest feature first, skipping any that would
  // sit on top of one already placed. Every feature is in the list below.
  const labels = useMemo(() => {
    const placed: number[] = []
    const out: { f: SequenceFeature; angle: number }[] = []

    const byLength = [...features].sort(
      (a, b) => featureLength(b, length) - featureLength(a, length),
    )

    for (const f of byLength) {
      const spans = featureSpans(f, length)

      const widest = spans.reduce((a, b) =>
        b.end - b.start > a.end - a.start ? b : a,
      )

      const angle = angleAt((widest.start + widest.end) / 2, length)
      const norm = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)

      if (
        placed.every((p) => {
          const d = Math.abs(p - norm)

          return Math.min(d, 2 * Math.PI - d) > 0.16
        })
      ) {
        placed.push(norm)
        out.push({ f, angle })
      }
    }

    return out
  }, [features, length])

  const step = tickStep(length, 12)
  const ticks: number[] = []

  for (let p = step; p < length; p += step) ticks.push(p)
  const innerEdge = R - thick / 2 - (laneCount - 1) * gap

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="group"
      aria-label={describe(sequence)}
      className={cn('block h-auto w-full max-w-[500px]', className)}
      onClick={() => onSelect(null)}
    >
      <circle
        cx={c}
        cy={c}
        r={R}
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth={1.5}
      />
      {ticks.map((p) => {
        const a = angleAt(p, length)
        const a0 = polar(c, c, R + thick / 2 + 2, a)
        const a1 = polar(c, c, R + thick / 2 + 7, a)

        return (
          <line
            key={p}
            x1={a0.x}
            y1={a0.y}
            x2={a1.x}
            y2={a1.y}
            stroke="var(--border-strong)"
          />
        )
      })}
      {ticks
        .filter((_, i) => ticks.length <= 12 || i % 2 === 1)
        .map((p) => {
          const pt = polar(c, c, innerEdge - 20, angleAt(p, length))

          return (
            <text
              key={p}
              x={pt.x}
              y={pt.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="num fill-fg-faint"
              fontSize={10}
            >
              {formatBases(p)}
            </text>
          )
        })}
      {features.map((f) => {
        const lane = lanes.get(f.id) ?? 0
        const r = R - lane * gap
        const spans = featureSpans(f, length)
        const selected = f.id === selectedId

        return (
          <g
            key={f.id}
            role="button"
            tabIndex={0}
            aria-label={featureTitle(f, length)}
            aria-pressed={selected}
            className="cursor-pointer outline-none [&:focus-visible_path]:stroke-fg"
            onClick={(e) => {
              e.stopPropagation()
              onSelect(selected ? null : f.id)
            }}
            onKeyDown={onKey(() => onSelect(selected ? null : f.id))}
          >
            <title>{featureTitle(f, length)}</title>
            {spans.map((s, i) => {
              const start = angleAt(s.start, length)
              const end = angleAt(s.end + 1, length)
              const lastSpan = i === spans.length - 1
              const arrowHere = f.strand === 1 ? lastSpan : i === 0

              return (
                <path
                  key={i}
                  d={ringSegmentPath({
                    cx: c,
                    cy: c,
                    inner: r - thick / 2,
                    outer: r + thick / 2,
                    startAngle: start,
                    endAngle: Math.max(end, start + 0.012),
                    strand: arrowHere ? f.strand : 1,
                    arrow: arrowHere ? 0.07 : 0,
                  })}
                  fill={featureColour(f.type)}
                  fillOpacity={selected ? 1 : 0.85}
                  stroke={selected ? 'var(--foreground)' : 'var(--card)'}
                  strokeWidth={selected ? 2 : 0.75}
                />
              )
            })}
          </g>
        )
      })}
      {labels.map(({ f, angle }) => {
        const outerR = R + thick / 2 + 22
        const p = polar(c, c, outerR, angle)
        const left = Math.cos(angle) < -0.15
        const centre = Math.abs(Math.cos(angle)) <= 0.15

        return (
          <text
            key={f.id}
            x={p.x}
            y={p.y}
            textAnchor={centre ? 'middle' : left ? 'end' : 'start'}
            dominantBaseline="middle"
            fontSize={11}
            className={cn(
              'pointer-events-none',
              f.id === selectedId ? 'fill-fg font-medium' : 'fill-fg-muted',
            )}
          >
            {f.label.length > 22 ? `${f.label.slice(0, 21)}…` : f.label}
          </text>
        )
      })}
      <text
        x={c}
        y={c - 10}
        textAnchor="middle"
        fontSize={15}
        fontWeight={600}
        className="fill-fg"
      >
        {sequence.name.length > 26
          ? `${sequence.name.slice(0, 25)}…`
          : sequence.name}
      </text>
      <text
        x={c}
        y={c + 12}
        textAnchor="middle"
        fontSize={12}
        className="num fill-fg-muted"
      >
        {t(`sequences.summary.length.${sequence.molecule}`, {
          count: sequence.length,
        })}
      </text>
    </svg>
  )
}

export interface LinearMapProps extends SequenceMapProps {
  /** The window on the sequence, 1-based and inclusive. */
  from: number
  to: number
}

/** A linear map of a stretch of the sequence, with a ruler. */
export function LinearMap({
  sequence,
  selectedId,
  onSelect,
  from,
  to,
  className,
}: LinearMapProps) {
  const W = 1000
  const padX = 24
  const innerW = W - padX * 2
  const { features, length } = sequence
  const span = Math.max(1, to - from + 1)
  const x = (pos: number) => padX + ((pos - from) / span) * innerW
  const lanes = useMemo(() => assignLanes(features, length), [features, length])

  const visible = features.filter((f) =>
    featureSpans(f, length).some((s) => s.end >= from && s.start <= to),
  )

  const laneCount = Math.max(
    1,
    ...visible.map((f) => (lanes.get(f.id) ?? 0) + 1),
  )

  const laneH = 26
  const top = 92
  const height = top + laneCount * laneH + 12
  const step = tickStep(span, 10)
  const ticks: number[] = []

  for (let p = Math.ceil(from / step) * step; p <= to; p += step) ticks.push(p)

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      role="group"
      aria-label={describe(sequence)}
      className={cn('block h-auto w-full', className)}
      onClick={() => onSelect(null)}
    >
      <line
        x1={padX}
        x2={W - padX}
        y1={58}
        y2={58}
        stroke="var(--border-strong)"
        strokeWidth={1.5}
      />
      {ticks.map((p) => (
        <g key={p}>
          <line
            x1={x(p)}
            x2={x(p)}
            y1={52}
            y2={64}
            stroke="var(--border-strong)"
          />
          <text
            x={x(p)}
            y={40}
            textAnchor="middle"
            fontSize={11}
            className="num fill-fg-muted"
          >
            {formatBases(p)}
          </text>
        </g>
      ))}
      {visible.map((f) => {
        const lane = lanes.get(f.id) ?? 0
        const y = top + lane * laneH

        const spans = featureSpans(f, length).filter(
          (s) => s.end >= from && s.start <= to,
        )

        const selected = f.id === selectedId

        const widest = Math.max(
          ...spans.map(
            (s) => x(Math.min(s.end, to) + 1) - x(Math.max(s.start, from)),
          ),
        )

        return (
          <g
            key={f.id}
            role="button"
            tabIndex={0}
            aria-label={featureTitle(f, length)}
            aria-pressed={selected}
            className="cursor-pointer outline-none [&:focus-visible_polygon]:stroke-fg"
            onClick={(e) => {
              e.stopPropagation()
              onSelect(selected ? null : f.id)
            }}
            onKeyDown={onKey(() => onSelect(selected ? null : f.id))}
          >
            <title>{featureTitle(f, length)}</title>
            {spans.map((s, i) => {
              const x0 = x(Math.max(s.start, from))
              const x1 = Math.max(x(Math.min(s.end, to) + 1), x0 + 1.5)
              const h = 18
              const tip = Math.min(9, (x1 - x0) * 0.5)
              const last = i === spans.length - 1
              const arrow = f.strand === 1 ? last : i === 0

              const points =
                !arrow || tip < 2
                  ? `${x0},${y} ${x1},${y} ${x1},${y + h} ${x0},${y + h}`
                  : f.strand === 1
                    ? `${x0},${y} ${x1 - tip},${y} ${x1},${y + h / 2} ${x1 - tip},${y + h} ${x0},${y + h}`
                    : `${x0 + tip},${y} ${x1},${y} ${x1},${y + h} ${x0 + tip},${y + h} ${x0},${y + h / 2}`

              return (
                <polygon
                  key={i}
                  points={points}
                  fill={featureColour(f.type)}
                  fillOpacity={selected ? 1 : 0.85}
                  stroke={selected ? 'var(--foreground)' : 'var(--card)'}
                  strokeWidth={selected ? 2 : 0.75}
                />
              )
            })}
            {widest > f.label.length * 6.4 + 22 ? (
              <text
                x={x(Math.max(spans[0].start, from)) + 8}
                y={y + 13}
                fontSize={11}
                className="pointer-events-none fill-bg"
                style={{ paintOrder: 'stroke' }}
              >
                {f.label}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
