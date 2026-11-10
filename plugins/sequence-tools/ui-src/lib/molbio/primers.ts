/**
 * Primer design in the manner of Primer3: nearest-neighbour melting
 * temperature (SantaLucia 1998), GC and clamp rules, hairpin and dimer
 * checks, a penalty score, and pair selection for a target region.
 */
import { findPattern, gcFraction, mod, reverseComplement } from './dna'

const R = 1.987 // cal / (mol K)

/** [dH kcal/mol, dS cal/(mol K)] for each dinucleotide, top-strand reading. */
const NN = new Map(
  Object.entries({
    AA: [-7.9, -22.2],
    TT: [-7.9, -22.2],
    AT: [-7.2, -20.4],
    TA: [-7.2, -21.3],
    CA: [-8.5, -22.7],
    TG: [-8.5, -22.7],
    GT: [-8.4, -22.4],
    AC: [-8.4, -22.4],
    CT: [-7.8, -21.0],
    AG: [-7.8, -21.0],
    GA: [-8.2, -22.2],
    TC: [-8.2, -22.2],
    CG: [-10.6, -27.2],
    GC: [-9.8, -24.4],
    GG: [-8.0, -19.9],
    CC: [-8.0, -19.9],
  } satisfies Record<string, [number, number]>),
)

export interface PcrConditions {
  /** Monovalent cations, mM. */
  na: number
  /** Mg2+, mM. */
  mg: number
  dntp: number
  /** Oligo concentration, nM. */
  oligo: number
}

export const DEFAULT_CONDITIONS: PcrConditions = {
  na: 50,
  mg: 1.5,
  dntp: 0.6,
  oligo: 500,
}

function sodiumEquivalent(c: PcrConditions): number {
  const free = Math.max(c.mg - c.dntp, 0)

  return c.na + 120 * Math.sqrt(free)
}

/** Melting temperature in °C. Ambiguous bases are not allowed here. */
export function meltingTemp(
  seq: string,
  conditions: PcrConditions = DEFAULT_CONDITIONS,
): number {
  const s = seq.toUpperCase()

  if (s.length < 2) return 0
  let dH = 0
  let dS = 0

  for (let i = 0; i < s.length - 1; i++) {
    const p = NN.get(s.slice(i, i + 2))

    if (!p) return 0
    dH += p[0]
    dS += p[1]
  }

  for (const end of [s[0], s[s.length - 1]]) {
    if (end === 'G' || end === 'C') {
      dH += 0.1
      dS += -2.8
    } else {
      dH += 2.3
      dS += 4.1
    }
  }

  const selfComp = s === reverseComplement(s)

  if (selfComp) dS += -1.4
  const ct = (conditions.oligo * 1e-9) / (selfComp ? 1 : 4)
  const tm = (dH * 1000) / (dS + R * Math.log(ct)) - 273.15
  // Salt correction on the entropy term (SantaLucia 1998).
  const na = sodiumEquivalent(conditions) / 1000
  const f = 0.368 * (s.length - 1) * Math.log(na)
  const corrected = (dH * 1000) / (dS + f + R * Math.log(ct)) - 273.15

  return Math.round((na === 0.05 ? tm : corrected) * 10) / 10
}

/** Duplex free energy at 37 °C, kcal/mol, for a perfectly paired run. */
export function duplexDeltaG(seq: string): number {
  const s = seq.toUpperCase()
  let dH = 0
  let dS = 0

  for (let i = 0; i < s.length - 1; i++) {
    const p = NN.get(s.slice(i, i + 2))

    if (!p) return 0
    dH += p[0]
    dS += p[1]
  }

  return dH - (310.15 * dS) / 1000
}

export interface DimerResult {
  /** Most stable pairing found, kcal/mol (more negative is worse). */
  deltaG: number
  /** Longest run of bases that pair, in nt. */
  run: number
  /** Whether the 3' end of the first primer takes part. */
  threePrime: boolean
}

/**
 * Best ungapped pairing of `a` with `b` read against each other (a with the
 * reverse complement of b). Pass the same sequence twice for a self-dimer.
 */
export function dimerCheck(a: string, b: string): DimerResult {
  const A = a.toUpperCase()
  const Brc = reverseComplement(b.toUpperCase())
  let best: DimerResult = { deltaG: 0, run: 0, threePrime: false }

  for (let shift = -(Brc.length - 1); shift < A.length; shift++) {
    let runStart = -1

    for (let i = 0; i <= A.length; i++) {
      const j = i - shift
      const pair = i < A.length && j >= 0 && j < Brc.length && A[i] === Brc[j]

      if (pair) {
        if (runStart < 0) runStart = i
      } else if (runStart >= 0) {
        const len = i - runStart

        if (len >= 3) {
          const dg = duplexDeltaG(A.slice(runStart, i))
          // The 3' end of a is its last base, which is pairing when i === A.length.
          const three = i === A.length

          if (dg < best.deltaG || (dg === best.deltaG && three))
            best = {
              deltaG: Math.round(dg * 100) / 100,
              run: Math.max(best.run, len),
              threePrime: best.threePrime || three,
            }
          else best.run = Math.max(best.run, len)

          if (three && dg < -3) best.threePrime = true
        }

        runStart = -1
      }
    }
  }

  return best
}

/** Strongest hairpin: a stem of at least three pairs around a loop of 3+. */
export function hairpinCheck(seq: string): { deltaG: number; stem: number } {
  const s = seq.toUpperCase()
  const n = s.length
  const comp = new Map(Object.entries({ A: 'T', T: 'A', G: 'C', C: 'G' }))
  let best = { deltaG: 0, stem: 0 }

  for (let i = 0; i < n; i++) {
    for (let j = i + 4; j < n; j++) {
      // Grow a stem outwards from the loop between i and j.
      let a = i
      let b = j

      while (a >= 0 && b < n && comp.get(s[a]) === s[b]) {
        a--
        b++
      }

      const stem = i - a

      if (stem >= 3) {
        const dg = duplexDeltaG(s.slice(a + 1, i + 1)) + 3.5 // loop penalty

        if (dg < best.deltaG)
          best = { deltaG: Math.round(dg * 100) / 100, stem }
      }
    }
  }

  return best
}

export function longestRepeat(seq: string): number {
  let best = 0
  let run = 0

  for (let i = 0; i < seq.length; i++) {
    run = i > 0 && seq[i] === seq[i - 1] ? run + 1 : 1
    best = Math.max(best, run)
  }

  return best
}

export interface PrimerReport {
  seq: string
  length: number
  tm: number
  gc: number
  /** Number of G or C among the last five bases. */
  gcClamp: number
  maxRepeat: number
  hairpin: { deltaG: number; stem: number }
  selfDimer: DimerResult
  warnings: string[]
}

export const PRIMER_LIMITS = {
  hairpinDeltaG: -2,
  dimerDeltaG: -6,
  threePrimeDimerDeltaG: -4,
} as const

export function analysePrimer(
  seq: string,
  conditions: PcrConditions = DEFAULT_CONDITIONS,
): PrimerReport {
  const s = seq.toUpperCase().replace(/[^ACGT]/g, '')
  const hairpin = hairpinCheck(s)
  const selfDimer = dimerCheck(s, s)
  const tail = s.slice(-5)
  const gcClamp = Array.from(tail).filter((c) => c === 'G' || c === 'C').length

  const report: PrimerReport = {
    seq: s,
    length: s.length,
    tm: meltingTemp(s, conditions),
    gc: Math.round(gcFraction(s) * 1000) / 10,
    gcClamp,
    maxRepeat: longestRepeat(s),
    hairpin,
    selfDimer,
    warnings: [],
  }

  if (s.length < 15) report.warnings.push('short')

  if (s.length > 35) report.warnings.push('long')

  if (report.gc < 35 || report.gc > 65) report.warnings.push('gc')

  if (gcClamp === 0) report.warnings.push('weakClamp')

  if (gcClamp > 3) report.warnings.push('strongClamp')

  if (report.maxRepeat >= 5) report.warnings.push('repeat')

  if (hairpin.deltaG < PRIMER_LIMITS.hairpinDeltaG)
    report.warnings.push('hairpin')

  if (
    selfDimer.deltaG < PRIMER_LIMITS.dimerDeltaG ||
    (selfDimer.threePrime &&
      selfDimer.deltaG < PRIMER_LIMITS.threePrimeDimerDeltaG)
  )
    report.warnings.push('selfDimer')

  return report
}

// --------------------------------------------------------------------------
// Where a primer binds
// --------------------------------------------------------------------------

export interface BindingSite {
  /** 1: the primer reads like the top strand (a forward primer). -1: it
   * reads like the bottom strand (a reverse primer). */
  strand: 1 | -1
  /** How many 3' bases pair, without a break. */
  paired: number
  /** 5' bases that do not pair (a tail). */
  tail: number
  /** Top-strand span of the paired part: start, and end (exclusive). */
  start: number
  end: number
}

/**
 * Where a primer's 3' end pairs with a template. A site needs at least
 * `minPaired` contiguous 3' bases (default 15) to count; the rest of the
 * primer is its tail.
 */
export function findBindingSites(
  template: string,
  primer: string,
  circular: boolean,
  opts: { minPaired?: number } = {},
): BindingSite[] {
  const p = primer.toUpperCase()
  const minPaired = Math.min(opts.minPaired ?? 15, p.length)
  const seedLen = minPaired
  const seed = p.slice(-seedLen)
  const n = template.length
  const out: BindingSite[] = []

  for (const strand of [1, -1] as const) {
    const t = strand === 1 ? template : reverseComplement(template)

    for (const h of findPattern(t, seed, circular)) {
      let ext = 0
      const lead = p.length - seedLen

      while (ext < lead) {
        const ti = circular ? mod(h - 1 - ext, n) : h - 1 - ext

        if (ti < 0 || t[ti] !== p[lead - 1 - ext]) break
        ext++
      }

      const paired = seedLen + ext
      const tail = p.length - paired
      const start = strand === 1 ? h - ext : n - h - seedLen
      const end = strand === 1 ? h + seedLen : n - h + ext
      out.push({
        strand,
        paired,
        tail,
        start: circular ? mod(start, n) : start,
        end: circular ? mod(end - 1, n) + 1 : end,
      })
    }
  }

  return out
}

export interface PcrProduct {
  /** 0-based start of the amplified template (top strand), end exclusive. */
  start: number
  end: number
  size: number
  seq: string
}

/**
 * Simulate PCR: every product between a forward-binding and a reverse-binding
 * primer. Tails are part of the product, as they are in the tube.
 */
export function simulatePcr(
  template: string,
  forward: string,
  reverse: string,
  circular: boolean,
  maxSize = 20000,
): PcrProduct[] {
  const n = template.length
  const t = template.toUpperCase()
  const fw = forward.toUpperCase()
  const rv = reverse.toUpperCase()
  const fSites = findBindingSites(t, fw, circular).filter((s) => s.strand === 1)

  const rSites = findBindingSites(t, rv, circular).filter(
    (s) => s.strand === -1,
  )

  const out: PcrProduct[] = []

  for (const f of fSites) {
    for (const r of rSites) {
      let span = r.end - f.start

      if (circular && span <= 0) span += n

      if (span <= 0) continue

      const body = circular
        ? (t + t).slice(f.start, f.start + span)
        : t.slice(f.start, r.end)

      const seq =
        fw.slice(0, f.tail) + body + reverseComplement(rv.slice(0, r.tail))

      if (seq.length > maxSize) continue
      out.push({ start: f.start, end: r.end, size: seq.length, seq })
    }
  }

  return out.sort((a, b) => a.size - b.size)
}

// --------------------------------------------------------------------------
// Design
// --------------------------------------------------------------------------

export interface DesignOptions {
  /** Smallest, best and largest primer length. */
  minLen: number
  optLen: number
  maxLen: number
  minTm: number
  optTm: number
  maxTm: number
  minGc: number
  maxGc: number
  /** Largest allowed Tm gap within a pair. */
  maxTmDiff: number
  minProduct: number
  maxProduct: number
  requireClamp: boolean
  conditions: PcrConditions
  /** How many pairs to return. */
  count: number
}

export const DEFAULT_DESIGN: DesignOptions = {
  minLen: 18,
  optLen: 20,
  maxLen: 27,
  minTm: 57,
  optTm: 60,
  maxTm: 63,
  minGc: 40,
  maxGc: 60,
  maxTmDiff: 3,
  minProduct: 100,
  maxProduct: 2000,
  requireClamp: true,
  conditions: DEFAULT_CONDITIONS,
  count: 5,
}

export interface PrimerCandidate extends PrimerReport {
  /** 0-based start on the template (top strand), end exclusive. */
  start: number
  end: number
  strand: 1 | -1
  penalty: number
}

export interface PrimerPair {
  forward: PrimerCandidate
  reverse: PrimerCandidate
  productSize: number
  tmDiff: number
  pairDimer: DimerResult
  penalty: number
  warnings: string[]
}

function penaltyFor(r: PrimerReport, o: DesignOptions): number {
  let p = Math.abs(r.tm - o.optTm) * 1.0

  if (r.tm < o.minTm) p += (o.minTm - r.tm) * 3

  if (r.tm > o.maxTm) p += (r.tm - o.maxTm) * 3
  p += Math.abs(r.length - o.optLen) * 0.25
  p += Math.abs(r.gc - 50) * 0.05
  p += r.warnings.length * 2

  if (r.hairpin.deltaG < 0) p += -r.hairpin.deltaG * 0.5

  if (r.selfDimer.deltaG < 0) p += -r.selfDimer.deltaG * 0.3

  return Math.round(p * 100) / 100
}

function candidatesAt(
  template: string,
  anchor: number,
  strand: 1 | -1,
  o: DesignOptions,
  window: number,
): PrimerCandidate[] {
  const out: PrimerCandidate[] = []
  const n = template.length

  for (let len = o.minLen; len <= o.maxLen; len++) {
    for (let shift = 0; shift <= window; shift++) {
      let start: number
      let end: number
      let seq: string

      if (strand === 1) {
        start = anchor + shift
        end = start + len

        if (start < 0 || end > n) continue
        seq = template.slice(start, end)
      } else {
        end = anchor - shift
        start = end - len

        if (start < 0 || end > n) continue
        seq = reverseComplement(template.slice(start, end))
      }

      if (/[^ACGT]/.test(seq)) continue
      const r = analysePrimer(seq, o.conditions)

      if (r.tm < o.minTm - 4 || r.tm > o.maxTm + 4) continue

      if (r.gc < o.minGc - 5 || r.gc > o.maxGc + 5) continue

      if (o.requireClamp && r.gcClamp === 0) continue

      if (r.maxRepeat >= 5) continue
      out.push({ ...r, start, end, strand, penalty: penaltyFor(r, o) })
    }
  }

  return out.sort((a, b) => a.penalty - b.penalty).slice(0, 40)
}

/**
 * Design primer pairs that amplify `target` (0-based, end exclusive) of the
 * template. The forward primer starts at or after `target.start` and the
 * reverse ends at or before `target.end`, so the product always contains the
 * target when `flank` is non-zero and primers may sit outside it.
 */
export function designPrimers(
  template: string,
  target: { start: number; end: number },
  options: Partial<DesignOptions> = {},
  opts: { flank?: number } = {},
): PrimerPair[] {
  const o: DesignOptions = { ...DEFAULT_DESIGN, ...options }
  const t = template.toUpperCase()
  const flank = opts.flank ?? 0
  // With flanks the primers sit up to `flank` bases outside the target.
  const fwdAnchor = target.start - flank
  const revAnchor = target.end + flank
  const window = Math.max(flank, 30)
  const fwd = candidatesAt(t, Math.max(0, fwdAnchor), 1, o, window)
  const rev = candidatesAt(t, Math.min(t.length, revAnchor), -1, o, window)
  const pairs: PrimerPair[] = []

  for (const f of fwd) {
    for (const r of rev) {
      const size = r.end - f.start

      if (size < o.minProduct || size > o.maxProduct) continue

      if (flank === 0 && (f.start < target.start || r.end > target.end))
        continue
      const tmDiff = Math.abs(f.tm - r.tm)

      if (tmDiff > o.maxTmDiff) continue
      const pairDimer = dimerCheck(f.seq, r.seq)
      const warnings: string[] = []

      if (
        pairDimer.deltaG < PRIMER_LIMITS.dimerDeltaG ||
        (pairDimer.threePrime &&
          pairDimer.deltaG < PRIMER_LIMITS.threePrimeDimerDeltaG)
      )
        warnings.push('pairDimer')

      const penalty =
        f.penalty +
        r.penalty +
        tmDiff * 1.5 +
        (pairDimer.deltaG < 0 ? -pairDimer.deltaG * 0.4 : 0) +
        warnings.length * 5

      pairs.push({
        forward: f,
        reverse: r,
        productSize: size,
        tmDiff: Math.round(tmDiff * 10) / 10,
        pairDimer,
        penalty: Math.round(penalty * 100) / 100,
        warnings,
      })
    }
  }

  pairs.sort((a, b) => a.penalty - b.penalty)
  // Keep variety: one pair per distinct forward primer first.
  const seen = new Set<string>()
  const picked: PrimerPair[] = []

  for (const p of pairs) {
    if (seen.has(p.forward.seq)) continue
    seen.add(p.forward.seq)
    picked.push(p)

    if (picked.length >= o.count) break
  }

  return picked
}

/** A primer with a 5' tail added (restriction site, overlap, Golden Gate arm). */
export function withTail(tail: string, primer: string): string {
  return `${tail.toUpperCase()}${primer.toUpperCase()}`
}
