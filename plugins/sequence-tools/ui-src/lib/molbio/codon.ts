/**
 * Codon optimisation: re-write a coding sequence with the codons a host uses
 * most, then repair what that breaks (restriction sites you want gone, long
 * single-base runs). The usage tables are approximate reference values per
 * thousand codons for the whole genome; they rank codons, they are not a
 * promise of expression.
 */
import { findPattern, reverseComplement } from './dna'
import { enzymeByName } from './enzymes'

export type Host = 'ecoli' | 'human' | 'yeast'

export const HOSTS: readonly { key: Host; name: string }[] = [
  { key: 'ecoli', name: 'E. coli K-12' },
  { key: 'human', name: 'Human' },
  { key: 'yeast', name: 'S. cerevisiae' },
]

const BASES = 'TCAG'

/** Codons in the order TTT, TTC, TTA, TTG, TCT, … (first base, second, third over TCAG). */
const CODON_LIST: string[] = (() => {
  const out: string[] = []

  for (const a of BASES)
    for (const b of BASES) for (const c of BASES) out.push(a + b + c)

  return out
})()

/** Standard code, same order as CODON_LIST. */
const CODE: Record<string, string> = (() => {
  const aa = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG'
  const table: Record<string, string> = {}
  CODON_LIST.forEach((c, i) => (table[c] = aa[i]))

  return table
})()

// Per thousand codons, in CODON_LIST order (TTT TTC TTA TTG TCT TCC TCA TCG TAT TAC TAA TAG TGT TGC TGA TGG, CTT …).
const USAGE: Record<Host, number[]> = {
  ecoli: [
    22.1, 16.0, 14.3, 13.0, 10.4, 9.1, 8.9, 8.5, 17.5, 12.2, 2.0, 0.3, 5.2, 6.1,
    1.0, 13.9, 11.9, 10.2, 4.2, 48.4, 7.5, 5.4, 8.6, 20.9, 12.5, 9.3, 14.6,
    28.4, 20.0, 19.7, 3.8, 5.9, 29.8, 23.7, 6.8, 26.4, 10.3, 22.0, 9.3, 13.7,
    20.6, 21.4, 35.3, 12.4, 9.9, 15.2, 3.6, 2.1, 19.8, 14.3, 11.6, 24.4, 17.1,
    24.2, 21.2, 30.1, 32.7, 19.2, 39.1, 18.7, 25.5, 27.1, 9.5, 11.3,
  ],
  human: [
    17.6, 20.3, 7.7, 12.9, 15.2, 17.7, 12.2, 4.4, 12.2, 15.3, 1.0, 0.8, 10.6,
    12.6, 1.6, 13.2, 13.2, 19.6, 7.2, 39.6, 17.5, 19.8, 16.9, 6.9, 10.9, 15.1,
    12.3, 34.2, 4.5, 10.4, 6.2, 11.4, 16.0, 20.8, 7.5, 22.0, 13.1, 18.9, 15.1,
    6.1, 17.0, 19.1, 24.4, 31.9, 12.1, 19.5, 12.2, 12.0, 11.0, 14.5, 7.1, 28.1,
    18.4, 27.7, 15.8, 7.4, 21.8, 25.1, 29.0, 39.6, 10.8, 22.2, 16.5, 16.5,
  ],
  yeast: [
    26.1, 18.4, 26.2, 27.2, 23.5, 14.2, 18.7, 8.6, 18.8, 14.8, 1.1, 0.5, 8.1,
    4.8, 0.7, 10.4, 12.3, 5.4, 13.4, 10.5, 13.5, 6.8, 18.3, 5.3, 13.6, 7.8,
    27.3, 12.1, 6.4, 2.6, 3.0, 1.7, 30.1, 17.2, 17.8, 20.9, 20.3, 12.7, 17.8,
    8.0, 35.7, 24.8, 41.9, 30.8, 14.2, 9.8, 21.3, 9.2, 22.1, 11.8, 11.8, 10.8,
    21.2, 12.6, 16.2, 6.2, 37.6, 20.2, 45.6, 19.2, 23.9, 9.8, 10.9, 6.0,
  ],
}

/** Relative adaptiveness: usage over the most used synonymous codon, 0 to 1. */
function weights(host: Host) {
  const freq: Record<string, number> = {}
  CODON_LIST.forEach((c, i) => (freq[c] = USAGE[host][i]))
  const best: Record<string, number> = {}

  for (const c of CODON_LIST)
    best[CODE[c]] = Math.max(best[CODE[c]] ?? 0, freq[c])
  const w: Record<string, number> = {}

  for (const c of CODON_LIST) w[c] = freq[c] / best[CODE[c]]

  return w
}

export function codonsFor(aa: string): string[] {
  return CODON_LIST.filter((c) => CODE[c] === aa)
}

export function translateCds(dna: string): string {
  let out = ''

  for (let i = 0; i + 3 <= dna.length; i += 3)
    out += CODE[dna.slice(i, i + 3)] ?? 'X'

  return out
}

/** Codon adaptation index: the geometric mean of the weights of the codons used. */
export function adaptationIndex(dna: string, host: Host): number {
  const w = weights(host)
  let sum = 0
  let n = 0

  for (let i = 0; i + 3 <= dna.length; i += 3) {
    const c = dna.slice(i, i + 3)

    if (CODE[c] === '*' || c === 'ATG' || c === 'TGG') continue
    sum += Math.log(Math.max(w[c] ?? 0.01, 0.01))
    n++
  }

  return n === 0 ? 0 : Math.exp(sum / n)
}

export interface CodonOptions {
  host: Host
  /** Enzymes whose sites should not appear in the result. */
  avoidEnzymes?: readonly string[]
  /** Break single-base runs at least this long (default 6, 0 to leave alone). */
  maxRun?: number
  /** Append a stop codon when the input has none (default true). */
  addStop?: boolean
}

export interface CodonResult {
  dna: string
  protein: string
  /** Codon adaptation index of the input DNA, when DNA was given, and of the result. */
  caiBefore: number | null
  caiAfter: number
  gc: number
  /** Codons that differ from the input DNA (0 when protein was given). */
  changed: number
  /** Sites or runs that could not be removed. */
  unresolved: string[]
}

export function optimiseCodons(
  input: { dna: string } | { protein: string },
  options: CodonOptions,
): CodonResult {
  const w = weights(options.host)

  const protein =
    'protein' in input
      ? input.protein.toUpperCase().replace(/[^A-Z*]/g, '')
      : translateCds(input.dna)

  const hasStop = protein.endsWith('*')
  const aas = Array.from(protein.replace(/\*$/, ''))
  const choices = aas.map((a) => codonsFor(a).sort((x, y) => w[y] - w[x]))

  if (choices.some((c) => c.length === 0))
    throw new Error('The protein has a letter that is not an amino acid.')
  const pick = choices.map((c) => c[0])

  const sites = (options.avoidEnzymes ?? [])
    .map((nm) => enzymeByName(nm))
    .filter((e) => e !== undefined)
    .flatMap((e) => {
      const rc = reverseComplement(e.site)

      return rc === e.site ? [e.site] : [e.site, rc]
    })

  const maxRun = options.maxRun ?? 6

  const problems = (dna: string): { at: number; what: string }[] => {
    const out: { at: number; what: string }[] = []

    for (const s of sites)
      for (const at of findPattern(dna, s, false))
        out.push({ at, what: `site ${s}` })

    if (maxRun > 0) {
      const re = new RegExp(`([ACGT])\\1{${maxRun - 1},}`, 'g')

      for (const m of dna.matchAll(re))
        // One entry per base past the limit, so shortening a run counts as progress.
        for (let k = 0; k <= m[0].length - maxRun; k++)
          out.push({ at: m.index + k, what: `run ${m[0]}` })
    }

    return out
  }

  const build = () => pick.join('')
  let dna = build()

  for (let pass = 0; pass < 6; pass++) {
    const found = problems(dna)

    if (found.length === 0) break
    let improved = false

    for (const p of found) {
      const first = Math.max(0, Math.floor(p.at / 3) - 1)
      const lastIdx = Math.min(pick.length - 1, Math.floor((p.at + 12) / 3))

      for (let i = first; i <= lastIdx; i++) {
        const before = problems(build()).length
        const current = pick[i]

        for (const alt of choices[i]) {
          if (alt === current) continue
          pick[i] = alt

          if (problems(build()).length < before) {
            improved = true
            break
          }

          pick[i] = current
        }

        if (problems(build()).length < before) break
      }
    }

    dna = build()

    if (!improved) break
  }

  const unresolved = problems(dna).map((p) => `${p.what} at ${p.at + 1}`)
  const stop = hasStop || options.addStop !== false

  if (stop) dna += options.host === 'human' ? 'TGA' : 'TAA'
  let changed = 0
  let caiBefore: number | null = null

  if ('dna' in input) {
    const src = input.dna.toUpperCase().replace(/[^ACGT]/g, '')
    caiBefore = adaptationIndex(src, options.host)

    for (let i = 0; i < pick.length; i++)
      if (src.slice(i * 3, i * 3 + 3) !== pick[i]) changed++
  }

  const gc =
    Array.from(dna).filter((c) => c === 'G' || c === 'C').length /
    Math.max(1, dna.length)

  return {
    dna,
    protein: protein.replace(/\*$/, ''),
    caiBefore,
    caiAfter: adaptationIndex(dna, options.host),
    gc,
    changed,
    unresolved,
  }
}
