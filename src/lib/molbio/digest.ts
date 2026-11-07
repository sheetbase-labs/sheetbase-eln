/**
 * Restriction sites, virtual digests and the gel they would make.
 * All positions are 0-based cut points: a cut at p lies between base p-1 and p.
 */
import { findPattern, mod, reverseComplement } from './dna'
import { ENZYMES, enzymeByName, overhangOf } from './enzymes'
import type { Enzyme } from './enzymes'

export type Topology = 'linear' | 'circular'

export interface Cut {
  enzyme: string
  /** Where the recognition site starts (0-based) on the top strand. */
  siteStart: number
  siteEnd: number
  /** Which strand the recognition sequence reads on. */
  strand: 1 | -1
  /** Top-strand and bottom-strand cut points, in top-strand coordinates. */
  top: number
  bottom: number
}

function isPalindromic(site: string): boolean {
  return reverseComplement(site) === site
}

/** Every cut one enzyme makes. Cuts that fall off a linear end are dropped. */
export function findCuts(
  seq: string,
  topology: Topology,
  enzyme: Enzyme,
): Cut[] {
  const n = seq.length
  const circular = topology === 'circular'
  const L = enzyme.site.length
  const cuts: Cut[] = []
  const place = (
    start: number,
    strand: 1 | -1,
    topOff: number,
    botOff: number,
  ) => {
    const d = botOff - topOff
    let top = start + topOff
    if (circular) top = mod(top, n)
    const bottom = top + d
    if (!circular && (top < 0 || top > n || bottom < 0 || bottom > n)) return
    cuts.push({
      enzyme: enzyme.name,
      siteStart: mod(start, n),
      siteEnd: circular ? mod(start + L, n) : start + L,
      strand,
      top,
      bottom,
    })
  }
  for (const p of findPattern(seq, enzyme.site, circular))
    place(p, 1, enzyme.top, enzyme.bottom)
  if (!isPalindromic(enzyme.site)) {
    const rcSite = reverseComplement(enzyme.site)
    for (const p of findPattern(seq, rcSite, circular))
      place(p, -1, L - enzyme.bottom, L - enzyme.top)
  }
  return cuts.sort((a, b) => a.top - b.top)
}

export interface EnzymeSites {
  enzyme: Enzyme
  cuts: Cut[]
}

/** Sites for a set of enzymes (all known enzymes when none are named). */
export function mapSites(
  seq: string,
  topology: Topology,
  names?: readonly string[],
): EnzymeSites[] {
  const list: Enzyme[] = names
    ? names
        .map((nm) => enzymeByName(nm))
        .filter((e): e is Enzyme => e !== undefined)
    : [...ENZYMES]
  return list.map((enzyme) => ({
    enzyme,
    cuts: findCuts(seq, topology, enzyme),
  }))
}

/** Enzymes that cut exactly once: the ones you can open a plasmid with. */
export function uniqueCutters(sites: EnzymeSites[]): EnzymeSites[] {
  return sites.filter((s) => s.cuts.length === 1)
}

/** One end of a fragment: the single-stranded overhang it leaves. */
export interface FragmentEnd {
  kind: 'blunt' | '5prime' | '3prime'
  /** Overhang bases in top-strand (sense) reading; empty when blunt. */
  sense: string
}

export interface Fragment {
  /** Position on the source of the leftmost base (0-based). */
  start: number
  /** Full double-stranded span in sense reading, overhangs included. */
  seq: string
  left: FragmentEnd
  right: FragmentEnd
  /** Size by top-strand cut points: what a gel shows, in bp. */
  size: number
  /** The enzymes that made its ends (empty ends of a linear source). */
  leftEnzyme: string | null
  rightEnzyme: string | null
}

/** Run a sequence out three times so spans can cross the origin freely. */
function unrolled(
  seq: string,
  circular: boolean,
): { ext: string; off: number } {
  return circular
    ? { ext: seq + seq + seq, off: seq.length }
    : { ext: seq, off: 0 }
}

function endFor(
  ext: string,
  off: number,
  cut: { top: number; bottom: number },
): FragmentEnd {
  const d = cut.bottom - cut.top
  if (d === 0) return { kind: 'blunt', sense: '' }
  const a = Math.min(cut.top, cut.bottom)
  const b = Math.max(cut.top, cut.bottom)
  return {
    kind: d > 0 ? '5prime' : '3prime',
    sense: ext.slice(a + off, b + off),
  }
}

/**
 * Cut a sequence at every site of the chosen enzymes and return the pieces in
 * order. A circular molecule with k cuts gives k pieces; a linear one k + 1.
 */
export function digest(
  seq: string,
  topology: Topology,
  enzymeNames: readonly string[],
): Fragment[] {
  const n = seq.length
  const circular = topology === 'circular'
  const { ext, off } = unrolled(seq, circular)
  const all: Cut[] = []
  for (const nm of enzymeNames) {
    const e = enzymeByName(nm)
    if (e) all.push(...findCuts(seq, topology, e))
  }
  // One cut per top-strand position (two enzymes may share a point).
  const byTop = new Map<number, Cut>()
  for (const c of all) if (!byTop.has(c.top)) byTop.set(c.top, c)
  const cuts = [...byTop.values()].sort((a, b) => a.top - b.top)
  const blunt: FragmentEnd = { kind: 'blunt', sense: '' }

  const make = (
    c1: { top: number; bottom: number; enzyme: string } | null,
    c2: { top: number; bottom: number; enzyme: string } | null,
  ): Fragment => {
    const t1 = c1 ? c1.top : 0
    const t2 = c2 ? c2.top : n
    const lo = Math.min(t1, c1 ? c1.bottom : t1)
    const hi = Math.max(t2, c2 ? c2.bottom : t2)
    return {
      start: mod(lo, n),
      seq: ext.slice(lo + off, hi + off),
      left: c1 ? endFor(ext, off, c1) : blunt,
      right: c2 ? endFor(ext, off, c2) : blunt,
      size: t2 - t1,
      leftEnzyme: c1 ? c1.enzyme : null,
      rightEnzyme: c2 ? c2.enzyme : null,
    }
  }

  if (cuts.length === 0) return [make(null, null)]
  const out: Fragment[] = []
  if (circular) {
    for (let i = 0; i < cuts.length; i++) {
      const c1 = cuts[i]
      const nx = cuts[(i + 1) % cuts.length]
      const c2 =
        i === cuts.length - 1
          ? { top: nx.top + n, bottom: nx.bottom + n, enzyme: nx.enzyme }
          : nx
      out.push(make(c1, c2))
    }
  } else {
    out.push(make(null, cuts[0]))
    for (let i = 0; i < cuts.length - 1; i++)
      out.push(make(cuts[i], cuts[i + 1]))
    out.push(make(cuts[cuts.length - 1], null))
  }
  return out.filter((f) => f.size > 0)
}

// --------------------------------------------------------------------------
// Gel: where the bands would run.
// --------------------------------------------------------------------------

export const LADDER_1KB = [
  10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500,
] as const

export const LADDER_100BP = [
  1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100,
] as const

export interface Band {
  size: number
  /** 0 (top of the gel, wells) to 1 (bottom). */
  position: number
  /** More than one fragment of this size, so the band is brighter. */
  count: number
}

/**
 * Migration is close to linear in log size between the gel's limits. Position
 * is scaled so the largest ladder band sits near 0.1 and the smallest near 0.9.
 */
export function gelPosition(
  size: number,
  ladder: readonly number[] = LADDER_1KB,
): number {
  const hi = Math.log10(Math.max(...ladder))
  const lo = Math.log10(Math.min(...ladder))
  const x = (hi - Math.log10(Math.max(size, 1))) / (hi - lo)
  return Math.min(1, Math.max(0, 0.1 + 0.8 * x))
}

/** Fragments of nearly equal size run as one band. */
export function gelBands(
  sizes: readonly number[],
  ladder: readonly number[] = LADDER_1KB,
  mergeWithin = 0.02,
): Band[] {
  const sorted = [...sizes].sort((a, b) => b - a)
  const bands: Band[] = []
  for (const s of sorted) {
    const last = bands.at(-1)
    if (last && Math.abs(last.size - s) / last.size <= mergeWithin) {
      last.count++
    } else {
      bands.push({ size: s, position: gelPosition(s, ladder), count: 1 })
    }
  }
  return bands
}

export function formatBp(size: number): string {
  if (size < 1000) return `${size} bp`
  const kb = size / 1000
  return `${Number.isInteger(kb) ? kb : kb.toFixed(2).replace(/0+$/, '')} kb`
}

export { overhangOf }
