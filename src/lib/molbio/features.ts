/**
 * Moving annotated features along when a sequence is cut, joined, flipped or
 * rotated. Features are the shapes in `#/lib/sequence`: 1-based inclusive
 * parts, a strand, and an overall start and end.
 */
import type { SequenceFeature } from '#/lib/sequence'
import { mod } from './dna'

function rebuild(f: SequenceFeature, parts: SequenceFeature['parts']) {
  const start = Math.min(...parts.map((p) => p.start))
  const end = Math.max(...parts.map((p) => p.end))
  return { ...f, parts, start, end }
}

export function renumber(features: SequenceFeature[]): SequenceFeature[] {
  return features.map((f, i) => ({ ...f, id: i + 1 }))
}

export interface EditOutcome {
  features: SequenceFeature[]
  /** Labels of features the edit cut through, which were removed. */
  removed: string[]
}

/**
 * Replace bases [start, end) (0-based) with `insertLength` new bases and
 * carry the features along. Features wholly inside the replaced span go, as
 * do ones it cuts across; a feature that straddles the edit grows or shrinks.
 */
export function shiftFeaturesForEdit(
  features: readonly SequenceFeature[],
  start: number,
  end: number,
  insertLength: number,
): EditOutcome {
  const delta = insertLength - (end - start)
  const kept: SequenceFeature[] = []
  const removed: string[] = []
  for (const f of features) {
    if (f.start > f.end) {
      // Crosses the origin of a circular molecule: not carried through edits.
      removed.push(f.label)
      continue
    }
    const parts: SequenceFeature['parts'] = []
    let ok = true
    for (const p of f.parts) {
      const ps = p.start - 1
      const pe = p.end
      if (pe <= start) parts.push({ start: p.start, end: p.end })
      else if (ps >= end && !(end === start && ps < start))
        parts.push({ start: p.start + delta, end: p.end + delta })
      else if (ps < start && pe > end)
        parts.push({ start: p.start, end: p.end + delta })
      else if (ps >= start && pe <= end && end > start) ok = false
      else ok = false
    }
    if (ok && parts.length > 0 && parts.every((p) => p.end >= p.start))
      kept.push(rebuild(f, parts))
    else removed.push(f.label)
  }
  return { features: kept, removed }
}

/** Features of the reverse complement of a sequence of length `length`. */
export function flipFeatures(
  features: readonly SequenceFeature[],
  length: number,
): SequenceFeature[] {
  return features.map((f) => {
    const parts = f.parts
      .map((p) => ({ start: length - p.end + 1, end: length - p.start + 1 }))
      .reverse()
    return { ...rebuild(f, parts), strand: f.strand === 1 ? -1 : 1 }
  })
}

/** Features after moving the origin of a circular sequence to `newOrigin`
 * (0-based): base `newOrigin` becomes base 1. Features may now cross it. */
export function rotateFeatures(
  features: readonly SequenceFeature[],
  length: number,
  newOrigin: number,
): SequenceFeature[] {
  return features.map((f) => {
    const parts = f.parts.map((p) => {
      const s = mod(p.start - 1 - newOrigin, length)
      const len =
        p.start <= p.end ? p.end - p.start + 1 : p.end + length - p.start + 1
      return { start: s + 1, end: s + len }
    })
    // A part running past the end wraps: split it.
    const out: SequenceFeature['parts'] = []
    for (const p of parts) {
      if (p.end <= length) out.push(p)
      else {
        out.push({ start: p.start, end: length })
        out.push({ start: 1, end: p.end - length })
      }
    }
    const wrapped = out.length > f.parts.length
    const base = rebuild(f, out)
    return wrapped
      ? { ...base, start: out[0].start, end: out[out.length - 1].end }
      : base
  })
}

/**
 * Features of a piece cut out of a source sequence, for building products.
 * `srcStart` is where the piece begins on the source (0-based), `pieceLength`
 * its length. Only features lying wholly inside the piece come along. When
 * `reverse` is set the piece is reverse-complemented. `skipLeft` drops
 * features that start in the first bases (an overlap already carried by the
 * neighbour); `offset` is where the piece begins in the product.
 */
export function carryFeatures(
  features: readonly SequenceFeature[],
  srcLength: number,
  circular: boolean,
  srcStart: number,
  pieceLength: number,
  opts: { reverse?: boolean; skipLeft?: number; offset?: number } = {},
): SequenceFeature[] {
  const out: SequenceFeature[] = []
  for (const f of features) {
    const parts: SequenceFeature['parts'] = []
    let ok = true
    for (const p of f.parts) {
      const len =
        p.start <= p.end ? p.end - p.start + 1 : p.end + srcLength - p.start + 1
      const rel = circular
        ? mod(p.start - 1 - srcStart, srcLength)
        : p.start - 1 - srcStart
      if (rel < 0 || rel + len > pieceLength) {
        ok = false
        break
      }
      parts.push({ start: rel + 1, end: rel + len })
    }
    if (!ok || parts.length === 0) continue
    let placed = parts
    let strand = f.strand
    if (opts.reverse) {
      placed = parts
        .map((p) => ({
          start: pieceLength - p.end + 1,
          end: pieceLength - p.start + 1,
        }))
        .reverse()
      strand = f.strand === 1 ? -1 : 1
    }
    if (Math.min(...placed.map((p) => p.start)) <= (opts.skipLeft ?? 0))
      continue
    const off = opts.offset ?? 0
    const moved = placed.map((p) => ({
      start: p.start + off,
      end: p.end + off,
    }))
    out.push({ ...rebuild(f, moved), strand })
  }
  return out
}
