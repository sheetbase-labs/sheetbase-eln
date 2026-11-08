/**
 * One form for a sequence however it was written down, so two files of the same
 * plasmid give the same registry fingerprint. Pure, so the Python port in
 * plugins/sequence-tools can be tested against it.
 */
import { reverseComplement } from '#/lib/sequence/analysis'
import type { ParsedSequence } from '#/lib/sequence'

/** The least rotation of a string (Booth's algorithm), in linear time. */
export function leastRotation(s: string): string {
  const n = s.length
  if (n < 2) return s
  const doubled = s + s
  const failure = new Array<number>(2 * n).fill(-1)
  let k = 0
  for (let j = 1; j < 2 * n; j++) {
    const c = doubled[j]
    let i = failure[j - k - 1]
    while (i !== -1 && c !== doubled[k + i + 1]) {
      if (c < doubled[k + i + 1]) k = j - i - 1
      i = failure[i]
    }
    if (c !== doubled[k + i + 1]) {
      if (c < doubled[k]) k = j
      failure[j - k] = -1
    } else {
      failure[j - k] = i + 1
    }
  }
  return s.slice(k) + s.slice(0, k)
}

/**
 * One form for a sequence however it was written down: upper case, bases only,
 * the same from either strand, and for a circle the same from any start. Two
 * files of the same plasmid cut at different places give the same text.
 */
export function canonicalSequence(
  residues: string,
  molecule: ParsedSequence['molecule'],
  topology: ParsedSequence['topology'],
): string {
  const seq = residues.toUpperCase().replace(/[^A-Z*]/g, '')
  if (molecule === 'protein') return seq
  const dna = molecule === 'rna' ? seq.replace(/U/g, 'T') : seq
  const forward = topology === 'circular' ? leastRotation(dna) : dna
  const rc = reverseComplement(dna)
  const reverse = topology === 'circular' ? leastRotation(rc) : rc
  return forward <= reverse ? forward : reverse
}

