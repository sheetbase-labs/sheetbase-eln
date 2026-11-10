/**
 * Pairwise alignment of DNA with affine gaps (Gotoh): global for two
 * sequences that should match end to end, local for a read against a larger
 * reference. Big references are cropped around the best k-mer diagonal first,
 * so a 1 kb Sanger read against a 12 kb plasmid stays fast.
 */
import { reverseComplement } from './dna'

export interface AlignOptions {
  mode: 'global' | 'local'
  match: number
  mismatch: number
  gapOpen: number
  gapExtend: number
}

export const DEFAULT_ALIGN: AlignOptions = {
  mode: 'local',
  match: 2,
  mismatch: -3,
  gapOpen: -5,
  gapExtend: -2,
}

export interface Alignment {
  score: number
  /** Aligned stretches, 0-based, end exclusive. */
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
  /** Gapped rows, same length, '-' for a gap. */
  alignedA: string
  alignedB: string
  matches: number
  mismatches: number
  /** Gap columns. */
  gaps: number
  /** Matches over aligned columns, 0 to 1. */
  identity: number
}

const NEG = -1e9

export function alignPair(
  a: string,
  b: string,
  options: Partial<AlignOptions> = {},
): Alignment {
  const o = { ...DEFAULT_ALIGN, ...options }
  const A = a.toUpperCase()
  const B = b.toUpperCase()
  const n = A.length
  const m = B.length
  const local = o.mode === 'local'
  const W = m + 1
  const size = (n + 1) * W
  const H = new Int32Array(size)
  const E = new Int32Array(size)
  const F = new Int32Array(size)
  // Traceback: H: 0 diag, 1 from E, 2 from F, 3 stop. E/F: 0 open, 1 extend.
  const tH = new Uint8Array(size)
  const tE = new Uint8Array(size)
  const tF = new Uint8Array(size)

  H[0] = 0
  E[0] = NEG
  F[0] = NEG

  for (let j = 1; j <= m; j++) {
    const i = 0
    const k = i * W + j

    if (local) {
      H[k] = 0
      tH[k] = 3
    } else {
      H[k] = o.gapOpen + o.gapExtend * (j - 1)
      tH[k] = 1
    }

    E[k] = H[k]
    tE[k] = j === 1 ? 0 : 1
    F[k] = NEG
  }

  for (let i = 1; i <= n; i++) {
    const k = i * W

    if (local) {
      H[k] = 0
      tH[k] = 3
    } else {
      H[k] = o.gapOpen + o.gapExtend * (i - 1)
      tH[k] = 2
    }

    F[k] = H[k]
    tF[k] = i === 1 ? 0 : 1
    E[k] = NEG
  }

  let best = 0
  let bi = 0
  let bj = 0

  for (let i = 1; i <= n; i++) {
    const ai = A[i - 1]

    for (let j = 1; j <= m; j++) {
      const k = i * W + j
      // E: gap in A (consumes B), from the left.
      const eOpen = H[k - 1] + o.gapOpen
      const eExt = E[k - 1] + o.gapExtend

      if (eExt > eOpen) {
        E[k] = eExt
        tE[k] = 1
      } else {
        E[k] = eOpen
        tE[k] = 0
      }

      // F: gap in B (consumes A), from above.
      const fOpen = H[k - W] + o.gapOpen
      const fExt = F[k - W] + o.gapExtend

      if (fExt > fOpen) {
        F[k] = fExt
        tF[k] = 1
      } else {
        F[k] = fOpen
        tF[k] = 0
      }

      const bj1 = B[j - 1]
      const sub = ai === bj1 || ai === 'N' || bj1 === 'N' ? o.match : o.mismatch
      let h = H[k - W - 1] + sub
      let t = 0

      if (E[k] > h) {
        h = E[k]
        t = 1
      }

      if (F[k] > h) {
        h = F[k]
        t = 2
      }

      if (local && h <= 0) {
        h = 0
        t = 3
      }

      H[k] = h
      tH[k] = t

      if (local && h > best) {
        best = h
        bi = i
        bj = j
      }
    }
  }

  if (!local) {
    bi = n
    bj = m
    best = H[n * W + m]
  }

  // Traceback.
  let i = bi
  let j = bj
  let state = 0 // 0 H, 1 E, 2 F
  const ra: string[] = []
  const rb: string[] = []

  while (i > 0 || j > 0) {
    const k = i * W + j

    if (state === 0) {
      const t = tH[k]

      if (t === 3) break

      if (t === 0) {
        ra.push(A[i - 1])
        rb.push(B[j - 1])
        i--
        j--
      } else {
        state = t
      }
    } else if (state === 1) {
      ra.push('-')
      rb.push(B[j - 1])
      const ext = tE[k] === 1
      j--
      state = ext ? 1 : 0
    } else {
      ra.push(A[i - 1])
      rb.push('-')
      const ext = tF[k] === 1
      i--
      state = ext ? 2 : 0
    }

    if (!local && i === 0 && j === 0) break
  }

  const alignedA = ra.reverse().join('')
  const alignedB = rb.reverse().join('')
  let matches = 0
  let mismatches = 0
  let gaps = 0

  for (let c = 0; c < alignedA.length; c++) {
    if (alignedA[c] === '-' || alignedB[c] === '-') gaps++
    else if (
      alignedA[c] === alignedB[c] ||
      alignedA[c] === 'N' ||
      alignedB[c] === 'N'
    )
      matches++
    else mismatches++
  }

  const cols = alignedA.length

  return {
    score: best,
    aStart: i,
    aEnd: bi,
    bStart: j,
    bEnd: bj,
    alignedA,
    alignedB,
    matches,
    mismatches,
    gaps,
    identity: cols === 0 ? 0 : matches / cols,
  }
}

// --------------------------------------------------------------------------
// Aligning reads to a template
// --------------------------------------------------------------------------

/** Start of the window of `ref` worth aligning a read to, from shared k-mers. */
function seedWindow(
  ref: string,
  read: string,
  circular: boolean,
): { start: number; end: number } | null {
  const k = 11

  if (read.length < k) return null
  const text = circular ? ref + ref.slice(0, read.length) : ref
  const index = new Map<string, number[]>()

  for (let i = 0; i + k <= text.length; i++) {
    const w = text.slice(i, i + k)
    const list = index.get(w)

    if (list) list.push(i)
    else index.set(w, [i])
  }

  const votes = new Map<number, number>()

  for (let i = 0; i + k <= read.length; i++) {
    const hits = index.get(read.slice(i, i + k))

    if (!hits || hits.length > 20) continue

    for (const p of hits) {
      const diag = Math.round((p - i) / 64) * 64
      votes.set(diag, (votes.get(diag) ?? 0) + 1)
    }
  }

  let bestDiag: number | null = null
  let bestVotes = 0

  for (const [d, v] of votes)
    if (v > bestVotes) {
      bestVotes = v
      bestDiag = d
    }

  if (bestDiag === null || bestVotes < 3) return null
  const pad = 200

  return {
    start: Math.max(0, bestDiag - pad),
    end: Math.min(text.length, bestDiag + read.length + pad),
  }
}

export interface ReadAlignment extends Alignment {
  strand: 1 | -1
  /** Reference span on the template (0-based, end exclusive; may wrap). */
  refStart: number
  refEnd: number
}

/**
 * Align a read to a template on whichever strand fits better. Returns null
 * when the read does not align convincingly (fewer than 20 matching bases).
 */
export function alignRead(
  template: string,
  read: string,
  circular: boolean,
  options: Partial<AlignOptions> = {},
): ReadAlignment | null {
  const ref = template.toUpperCase()
  const n = ref.length
  const results: ReadAlignment[] = []

  for (const strand of [1, -1] as const) {
    const q =
      strand === 1 ? read.toUpperCase() : reverseComplement(read.toUpperCase())

    let offset = 0
    let window = ref

    if (n * q.length > 6_000_000) {
      const w = seedWindow(ref, q, circular)

      if (!w) continue
      offset = w.start
      window = (circular ? ref + ref : ref).slice(w.start, w.end)
    }

    const aln = alignPair(window, q, { ...options, mode: 'local' })

    if (aln.matches < 20) continue
    results.push({
      ...aln,
      strand,
      refStart: (aln.aStart + offset) % n,
      refEnd: aln.aEnd + offset,
    })
  }

  if (results.length === 0) return null
  results.sort((x, y) => y.score - x.score)

  return results[0]
}

/** Consensus-style difference list between the aligned rows. */
export interface Difference {
  kind: 'mismatch' | 'insertion' | 'deletion'
  /** 0-based position on the reference (the first base affected). */
  refPos: number
  /** 0-based position on the query (read as aligned); for a deletion, the
   * read base just after it. */
  queryPos: number
  ref: string
  query: string
}

export function differences(
  aln: Alignment,
  refOffset = 0,
  queryOffset = 0,
): Difference[] {
  const out: Difference[] = []
  let r = aln.aStart + refOffset
  let q = aln.bStart + queryOffset
  let c = 0
  const rows = aln.alignedA.length

  while (c < rows) {
    const x = aln.alignedA[c]
    const y = aln.alignedB[c]

    if (x === '-') {
      let s = ''
      const qp = q

      while (c < rows && aln.alignedA[c] === '-') {
        s += aln.alignedB[c]
        q++
        c++
      }

      out.push({
        kind: 'insertion',
        refPos: r,
        queryPos: qp,
        ref: '',
        query: s,
      })
      continue
    }

    if (y === '-') {
      let s = ''
      const rp = r

      while (c < rows && aln.alignedB[c] === '-') {
        s += aln.alignedA[c]
        r++
        c++
      }

      out.push({ kind: 'deletion', refPos: rp, queryPos: q, ref: s, query: '' })
      continue
    }

    if (x !== y && x !== 'N' && y !== 'N')
      out.push({ kind: 'mismatch', refPos: r, queryPos: q, ref: x, query: y })
    r++
    q++
    c++
  }

  return out
}
