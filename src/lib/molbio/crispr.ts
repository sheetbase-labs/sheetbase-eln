/**
 * CRISPR guide finding. Every site next to the nuclease's PAM, on either
 * strand, with a plain screen (GC, runs that stop transcription, repeats) and
 * a count of near matches elsewhere in the same sequence. It is a screen to
 * shortlist guides, not a trained activity model: check a chosen guide against
 * the whole genome before ordering.
 */
import { findPattern, gcFraction, mod, reverseComplement } from './dna'

export interface Nuclease {
  key: 'spcas9' | 'sacas9' | 'cas12a'
  name: string
  /** IUPAC PAM, read 5' to 3' on the strand the guide matches. */
  pam: string
  guideLength: number
  /** Which side of the guide the PAM sits on. */
  pamSide: '3prime' | '5prime'
  /** Bases from the PAM-proximal end of the guide to the cut on that strand. */
  cutFromPam: number
}

export const NUCLEASES: readonly Nuclease[] = [
  {
    key: 'spcas9',
    name: 'SpCas9 (NGG)',
    pam: 'NGG',
    guideLength: 20,
    pamSide: '3prime',
    cutFromPam: 3,
  },
  {
    key: 'sacas9',
    name: 'SaCas9 (NNGRRT)',
    pam: 'NNGRRT',
    guideLength: 21,
    pamSide: '3prime',
    cutFromPam: 3,
  },
  {
    key: 'cas12a',
    name: 'Cas12a (TTTV)',
    pam: 'TTTV',
    guideLength: 23,
    pamSide: '5prime',
    cutFromPam: 18,
  },
]

export function nucleaseByKey(key: string): Nuclease | undefined {
  return NUCLEASES.find((n) => n.key === key)
}

export interface Guide {
  /** Guide as it pairs, 5' to 3' on the strand it matches. */
  protospacer: string
  pam: string
  strand: 1 | -1
  /** Top-strand span of the protospacer (1-based, inclusive). */
  start: number
  end: number
  /** The top-strand base after which the nuclease cuts (1-based). */
  cutAfter: number
  gc: number
  /** 0 to 100, higher is better. */
  score: number
  warnings: GuideWarning[]
  /** Other PAM-adjacent sites with this many mismatches (index = mismatches, 0 to maxMismatch). */
  offTargets: number[]
}

export type GuideWarning =
  'lowGc' | 'highGc' | 'terminator' | 'homopolymer' | 'offTargetClose'

interface Site {
  proto: string
  pam: string
  strand: 1 | -1
  /** 0-based start of the protospacer on the top strand. */
  start: number
}

function scan(
  seq: string,
  nuclease: Nuclease,
  circular: boolean,
  strand: 1 | -1,
): Site[] {
  const n = seq.length
  const L = nuclease.guideLength
  const P = nuclease.pam.length
  const span = L + P
  if (n < span) return []
  const strandSeq = strand === 1 ? seq : reverseComplement(seq)
  const out: Site[] = []
  for (const at of findPattern(
    strandSeq,
    nuclease.pamSide === '3prime'
      ? 'N'.repeat(L) + nuclease.pam
      : nuclease.pam + 'N'.repeat(L),
    circular,
  )) {
    const wrapped =
      circular && at + span > n
        ? strandSeq.slice(at) + strandSeq.slice(0, at + span - n)
        : strandSeq.slice(at, at + span)
    const proto =
      nuclease.pamSide === '3prime' ? wrapped.slice(0, L) : wrapped.slice(P)
    const pam =
      nuclease.pamSide === '3prime' ? wrapped.slice(L) : wrapped.slice(0, P)
    const protoAt = nuclease.pamSide === '3prime' ? at : at + P
    // Strand coordinates to top-strand start.
    const start = strand === 1 ? mod(protoAt, n) : mod(n - protoAt - L, n)
    out.push({ proto, pam, strand, start })
  }
  return out
}

function mismatches(a: string, b: string, limit: number): number {
  let m = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && ++m > limit) return m
  }
  return m
}

export interface GuideOptions {
  /** Only guides whose protospacer lies inside this top-strand span (1-based, inclusive). */
  region?: { start: number; end: number }
  /** Most guides to return, best first. */
  limit?: number
  /** Count near matches up to this many mismatches. */
  maxMismatch?: number
}

export function findGuides(
  seqIn: string,
  topology: 'linear' | 'circular',
  nuclease: Nuclease,
  options: GuideOptions = {},
): Guide[] {
  const seq = seqIn.toUpperCase()
  const n = seq.length
  const circular = topology === 'circular'
  const maxMm = options.maxMismatch ?? 3
  const L = nuclease.guideLength
  const sites = [
    ...scan(seq, nuclease, circular, 1),
    ...scan(seq, nuclease, circular, -1),
  ].filter((s) => !/[^ACGT]/.test(s.proto))
  const inRegion = (s: Site) =>
    !options.region ||
    (s.start + 1 >= options.region.start && s.start + L <= options.region.end)
  const scored = sites.filter(inRegion).map((s) => {
    const gc = gcFraction(s.proto)
    const warnings: GuideWarning[] = []
    let score = 100
    if (gc < 0.3) {
      warnings.push('lowGc')
      score -= 30
    } else if (gc < 0.4) score -= 10
    if (gc > 0.8) {
      warnings.push('highGc')
      score -= 30
    } else if (gc > 0.7) score -= 10
    if (s.proto.includes('TTTT')) {
      warnings.push('terminator')
      score -= 40
    }
    if (/(.)\1{4,}/.test(s.proto)) {
      warnings.push('homopolymer')
      score -= 10
    }
    // Seed (the PAM-proximal part) that is mostly one base pairs poorly.
    return { s, gc, warnings, score }
  })
  scored.sort((a, b) => b.score - a.score || a.s.start - b.s.start)
  const top = scored.slice(0, options.limit ?? 20)
  return top.map(({ s, gc, warnings, score }) => {
    const offTargets = new Array<number>(maxMm + 1).fill(0)
    for (const o of sites) {
      if (o === s) continue
      const m = mismatches(s.proto, o.proto, maxMm)
      if (m <= maxMm) offTargets[m]++
    }
    let adj =
      score -
      Math.min(
        30,
        offTargets.slice(1).reduce((a, c, i) => a + c * (maxMm - i), 0) * 3,
      ) -
      offTargets[0] * 20
    if (offTargets[0] > 0 || offTargets.slice(1, 3).some((c) => c > 0))
      warnings.push('offTargetClose')
    adj = Math.max(0, Math.min(100, adj))
    // Cut position on the top strand.
    const protoEndTop = s.start + L // 0-based exclusive
    let cutAfter: number
    if (nuclease.pamSide === '3prime') {
      cutAfter =
        s.strand === 1
          ? protoEndTop - nuclease.cutFromPam
          : s.start + nuclease.cutFromPam
    } else {
      cutAfter =
        s.strand === 1
          ? s.start + nuclease.cutFromPam
          : protoEndTop - nuclease.cutFromPam
    }
    return {
      protospacer: s.proto,
      pam: s.pam,
      strand: s.strand,
      start: s.start + 1,
      end: s.start + L,
      cutAfter: mod(cutAfter - 1, n) + 1,
      gc,
      score: Math.round(adj),
      warnings,
      offTargets,
    }
  })
}
