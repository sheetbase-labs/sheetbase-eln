/**
 * Checking a Sanger read against the construct you meant to make.
 */
import { decodeQuality, trimByQuality } from './abif'
import { alignRead, differences } from './align'
import { reverseComplement } from './dna'
import type { SequenceFeature } from '#/lib/sequence'

export interface ReadInput {
  name: string
  bases: string
  quality: readonly number[]
}

export interface ReadMismatch {
  kind: 'mismatch' | 'insertion' | 'deletion'
  /** 1-based position on the expected sequence. */
  position: number
  expected: string
  found: string
  /** Phred quality at the call (the lowest across an insertion). */
  quality: number
  /** Index of the base in the original read (0-based), for finding it on the trace. */
  readIndex: number
  /** Whether the call is good enough to trust as a real difference. */
  confirmed: boolean
  /** Labels of expected-sequence features that sit on this position. */
  features: string[]
}

export type ReadVerdict = 'matches' | 'review' | 'mismatch' | 'noAlignment'

export interface ReadCheck {
  name: string
  verdict: ReadVerdict
  strand: 1 | -1 | null
  /** Kept span of the read after quality trimming (0-based, end exclusive). */
  trimmed: { start: number; end: number }
  meanQuality: number
  /** Span the read covers on the expected sequence (1-based, inclusive). */
  covers: { start: number; end: number } | null
  identity: number
  differences: ReadMismatch[]
}

export const CONFIRM_QUALITY = 30

export function checkRead(
  expected: string,
  topology: 'linear' | 'circular',
  features: readonly SequenceFeature[],
  read: ReadInput,
): ReadCheck {
  const q = [...read.quality]
  const trimmed = trimByQuality(q)
  const kept = read.bases.slice(trimmed.start, trimmed.end)
  const keptQ = q.slice(trimmed.start, trimmed.end)

  const meanQuality =
    keptQ.length === 0
      ? 0
      : Math.round((keptQ.reduce((a, b) => a + b, 0) / keptQ.length) * 10) / 10

  const none: ReadCheck = {
    name: read.name,
    verdict: 'noAlignment',
    strand: null,
    trimmed,
    meanQuality,
    covers: null,
    identity: 0,
    differences: [],
  }

  if (kept.length < 20) return none
  const aln = alignRead(expected, kept, topology === 'circular')

  if (!aln) return none
  const n = expected.length

  // The read as aligned: reversed if it matched the other strand.
  const qualityAt = (queryIndex: number): number => {
    const idx = aln.strand === 1 ? queryIndex : kept.length - 1 - queryIndex

    return keptQ[idx] ?? 0
  }

  // alignRead aligns against the (possibly cropped) window; recompute the
  // reference offset from refStart.
  const diffs = differences(aln, aln.refStart - aln.aStart, 0)

  const labelsAt = (pos0: number): string[] =>
    features.flatMap((f) =>
      f.parts.some((p) => pos0 + 1 >= p.start && pos0 + 1 <= p.end)
        ? [f.label]
        : [],
    )

  const list: ReadMismatch[] = diffs.map((d) => {
    const refPos = ((d.refPos % n) + n) % n
    let quality: number

    if (d.kind === 'deletion') {
      quality = Math.min(qualityAt(d.queryPos - 1), qualityAt(d.queryPos))
    } else if (d.kind === 'insertion') {
      quality = Math.min(
        ...Array.from(d.query, (_, i) => qualityAt(d.queryPos + i)),
      )
    } else quality = qualityAt(d.queryPos)
    const qi = Math.min(Math.max(d.queryPos, 0), kept.length - 1)

    const readIndex =
      trimmed.start + (aln.strand === 1 ? qi : kept.length - 1 - qi)

    return {
      kind: d.kind,
      readIndex,
      position: refPos + 1,
      expected: d.ref,
      found: d.query,
      quality,
      confirmed: quality >= CONFIRM_QUALITY,
      features: labelsAt(refPos),
    }
  })

  const confirmed = list.some((d) => d.confirmed)

  const verdict: ReadVerdict = confirmed
    ? 'mismatch'
    : list.length > 0
      ? 'review'
      : 'matches'

  return {
    name: read.name,
    verdict,
    strand: aln.strand,
    trimmed,
    meanQuality,
    covers: { start: (aln.refStart % n) + 1, end: ((aln.refEnd - 1) % n) + 1 },
    identity: Math.round(aln.identity * 10000) / 10000,
    differences: list,
  }
}

/** Share of a region of the expected sequence (1-based, inclusive) that at
 * least one read covers. */
export function coverageOf(
  checks: readonly ReadCheck[],
  region: { start: number; end: number },
): number {
  const len = region.end - region.start + 1

  if (len <= 0) return 0
  const covered = new Uint8Array(len)

  for (const c of checks) {
    if (!c.covers) continue
    const a = Math.max(c.covers.start, region.start)
    const b = Math.min(c.covers.end, region.end)

    for (let p = a; p <= b; p++) covered[p - region.start] = 1
  }

  return covered.reduce((s, v) => s + v, 0) / len
}

/** A read from the compact form stored in a notebook block. */
export function readFromStored(r: {
  name: string
  bases: string
  quality: string
}): ReadInput {
  return { name: r.name, bases: r.bases, quality: decodeQuality(r.quality) }
}

export { reverseComplement }
