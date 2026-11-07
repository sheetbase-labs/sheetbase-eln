/**
 * Small DNA helpers shared by the molecular biology tools: cleaning input,
 * IUPAC matching and slicing around the origin of a circular molecule.
 */
import { reverseComplement as rc } from '#/lib/sequence'

export const reverseComplement = rc

/** Upper-case DNA letters only (RNA U becomes T); whitespace and digits go. */
export function cleanDna(input: string): string {
  return input
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^ACGTRYKMSWBDHVN]/g, '')
}

export function isPlainDna(input: string): boolean {
  return /^[ACGT]*$/.test(input)
}

/** What each IUPAC code stands for. */
export const IUPAC: Partial<Record<string, string>> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  R: 'AG',
  Y: 'CT',
  K: 'GT',
  M: 'AC',
  S: 'CG',
  W: 'AT',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT',
}

/** True when base `b` (A, C, G, T) is allowed by IUPAC code `code`. */
export function iupacMatches(code: string, b: string): boolean {
  const set = IUPAC[code]
  return set !== undefined && set.includes(b)
}

/** Positions (0-based) where an IUPAC pattern matches the forward strand. */
export function findPattern(
  seq: string,
  pattern: string,
  circular: boolean,
): number[] {
  const n = seq.length
  const m = pattern.length
  if (m === 0 || n === 0 || (!circular && n < m) || (circular && m > n))
    return []
  const hay = circular ? seq + seq.slice(0, m - 1) : seq
  const out: number[] = []
  const last = circular ? n : n - m + 1
  for (let i = 0; i < last; i++) {
    let ok = true
    for (let j = 0; j < m; j++) {
      if (!iupacMatches(pattern[j], hay[i + j])) {
        ok = false
        break
      }
    }
    if (ok) out.push(i)
  }
  return out
}

/** Slice [start, end) of a sequence, wrapping past the end when circular. */
export function wrapSlice(
  seq: string,
  start: number,
  end: number,
  circular: boolean,
): string {
  if (start <= end) return seq.slice(start, end)
  return circular ? seq.slice(start) + seq.slice(0, end) : ''
}

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/** Fraction of G and C, 0 to 1. */
export function gcFraction(seq: string): number {
  if (seq.length === 0) return 0
  let gc = 0
  for (const ch of seq) if (ch === 'G' || ch === 'C') gc++
  return gc / seq.length
}
