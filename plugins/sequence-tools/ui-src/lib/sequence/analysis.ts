import type { FeaturePart, ParsedSequence, SequenceSummary } from './model'

const COMPLEMENT = new Map(
  Object.entries({
    A: 'T',
    T: 'A',
    G: 'C',
    C: 'G',
    U: 'A',
    N: 'N',
    R: 'Y',
    Y: 'R',
    K: 'M',
    M: 'K',
    S: 'S',
    W: 'W',
    B: 'V',
    V: 'B',
    D: 'H',
    H: 'D',
  }),
)

export function reverseComplement(seq: string): string {
  let out = ''

  for (let i = seq.length - 1; i >= 0; i--) {
    const ch = seq[i]
    const up = ch.toUpperCase()
    const c = COMPLEMENT.get(up) ?? up
    out += ch === up ? c : c.toLowerCase()
  }

  return out
}

export function gcPercent(seq: string): number | null {
  let gc = 0
  let acgt = 0

  for (const ch of seq) {
    const u = ch.toUpperCase()

    if (u === 'G' || u === 'C') gc++

    if ('ACGTU'.includes(u)) acgt++
  }

  return acgt === 0 ? null : Math.round((gc / acgt) * 1000) / 10
}

/** The residues of a (possibly multi-part, possibly reverse) feature. */
export function featureResidues(
  residues: string,
  parts: FeaturePart[],
  strand: 1 | -1,
): string {
  const joined = parts.map((p) => residues.slice(p.start - 1, p.end)).join('')

  return strand === -1 ? reverseComplement(joined) : joined
}

const CODONS: Record<string, string> = (() => {
  const bases = 'TCAG'
  const aa = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG'
  const table: Record<string, string> = {}
  let i = 0

  for (const a of bases)
    for (const b of bases) for (const c of bases) table[a + b + c] = aa[i++]

  return table
})()

export function translate(dna: string): string {
  const up = dna.toUpperCase().replace(/U/g, 'T')
  let out = ''

  for (let i = 0; i + 3 <= up.length; i += 3)
    out += CODONS[up.slice(i, i + 3)] ?? 'X'

  return out.replace(/\*$/, '')
}

export function summarise(seq: ParsedSequence): SequenceSummary {
  return {
    name: seq.name,
    molecule: seq.molecule,
    topology: seq.topology,
    length: seq.length,
    featureCount: seq.features.length,
    gc: seq.molecule === 'protein' ? null : gcPercent(seq.residues),
  }
}

/** Searchable text for a sequence file: its names, organism and feature labels. */
export function searchText(seqs: ParsedSequence[]): string {
  return seqs
    .map((s) =>
      [
        s.name,
        s.description,
        s.organism,
        ...s.features.map((f) => `${f.label} ${f.type}`),
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n')
}
