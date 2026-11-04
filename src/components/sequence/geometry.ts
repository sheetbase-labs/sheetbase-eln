import type { SequenceFeature } from '#/lib/sequence'

/** An interval on a sequence, 1-based and inclusive. */
export interface Span {
  start: number
  end: number
}

/** The stretches a feature covers, splitting one that crosses the origin. */
export function featureSpans(f: SequenceFeature, length: number): Span[] {
  if (f.start <= f.end) {
    return f.parts.length > 1 && f.parts.every((p) => p.start <= p.end)
      ? f.parts.map((p) => ({ start: p.start, end: p.end }))
      : [{ start: f.start, end: f.end }]
  }
  return [
    { start: f.start, end: length },
    { start: 1, end: f.end },
  ]
}

/** Overall size of a feature in bases, wrap-aware. */
export function featureLength(f: SequenceFeature, length: number): number {
  return f.parts.reduce(
    (n, p) =>
      n +
      (p.end >= p.start ? p.end - p.start + 1 : length - p.start + 1 + p.end),
    0,
  )
}

/**
 * Give every feature a lane so features that overlap do not draw on top of
 * each other. Lane 0 is the first free row.
 */
export function assignLanes(
  features: readonly SequenceFeature[],
  length: number,
): Map<number, number> {
  const lanes: number[] = [] // the end of the last feature in each lane
  const out = new Map<number, number>()
  const sorted = [...features].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  )
  for (const f of sorted) {
    const wraps = f.start > f.end
    const start = f.start
    const end = wraps ? length : f.end
    let lane = lanes.findIndex((last) => last < start)
    if (lane < 0) lane = lanes.length
    lanes[lane] = end
    out.set(f.id, lane)
  }
  return out
}

/** A round number of bases between ruler ticks, giving about `target` ticks. */
export function tickStep(span: number, target = 8): number {
  const raw = Math.max(1, span / target)
  const pow = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow
  return 10 * pow
}

export function formatBases(n: number): string {
  return n.toLocaleString('en-GB')
}

const COLOURS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

const TYPE_COLOUR: Record<string, number> = {
  CDS: 0,
  gene: 0,
  promoter: 1,
  terminator: 2,
  rep_origin: 3,
  primer_bind: 4,
  protein_bind: 4,
  regulatory: 1,
  misc_feature: 2,
  misc_recomb: 2,
  sig_peptide: 3,
}

export function featureColour(type: string): string {
  const index = TYPE_COLOUR[type] as number | undefined
  if (index !== undefined) return COLOURS[index]
  let h = 0
  for (const ch of type) h = (h * 31 + ch.charCodeAt(0)) % COLOURS.length
  return COLOURS[h]
}

export function polar(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
}

/** Angle in radians for a 1-based position; 12 o'clock is position 1. */
export function angleAt(pos: number, length: number): number {
  return ((pos - 1) / length) * Math.PI * 2 - Math.PI / 2
}

/**
 * The outline of one feature on a circular map: a ring segment, with an arrow
 * head on the strand's end.
 */
export function ringSegmentPath(opts: {
  cx: number
  cy: number
  inner: number
  outer: number
  startAngle: number
  endAngle: number
  strand: 1 | -1
  arrow: number
}): string {
  const { cx, cy, inner, outer, strand } = opts
  const head = Math.min(opts.arrow, (opts.endAngle - opts.startAngle) * 0.6)
  const mid = (inner + outer) / 2
  const from = strand === 1 ? opts.startAngle : opts.startAngle + head
  const to = strand === 1 ? opts.endAngle - head : opts.endAngle
  const large = to - from > Math.PI ? 1 : 0
  const p = (r: number, a: number) => {
    const { x, y } = polar(cx, cy, r, a)
    return `${x.toFixed(2)} ${y.toFixed(2)}`
  }
  const arc = (r: number, a: number, dir: 0 | 1) =>
    `A ${r} ${r} 0 ${large} ${dir} ${p(r, a)}`
  if (strand === 1) {
    return [
      `M ${p(outer, from)}`,
      arc(outer, to, 1),
      `L ${p(mid, opts.endAngle)}`,
      `L ${p(inner, to)}`,
      arc(inner, from, 0),
      'Z',
    ].join(' ')
  }
  return [
    `M ${p(mid, opts.startAngle)}`,
    `L ${p(outer, from)}`,
    arc(outer, to, 1),
    `L ${p(inner, to)}`,
    arc(inner, from, 0),
    'Z',
  ].join(' ')
}
