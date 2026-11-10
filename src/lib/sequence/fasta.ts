import { SequenceParseError, stripBom } from './model'
import type { MoleculeType, ParsedSequence } from './model'

const NUCLEOTIDE = /^[ACGTUNRYKMSWBDHVacgtunrykmswbdhv*-]*$/

export function guessMolecule(residues: string): MoleculeType {
  if (!NUCLEOTIDE.test(residues)) return 'protein'

  return /u/i.test(residues) && !/t/i.test(residues) ? 'rna' : 'dna'
}

/** Parse a FASTA file. Every record becomes one sequence. */
export function parseFasta(text: string): ParsedSequence[] {
  const out: ParsedSequence[] = []
  let header: string | null = null
  let lines: string[] = []

  const flush = () => {
    if (header === null) return

    const residues = lines
      .join('')
      .replace(/[\s\d]/g, '')
      .toUpperCase()

    const [name = '', ...rest] = header.trim().split(/\s+/)
    out.push({
      name: name || 'Sequence',
      description: rest.join(' '),
      organism: null,
      molecule: guessMolecule(residues),
      topology: /circular/i.test(header) ? 'circular' : 'linear',
      length: residues.length,
      residues,
      features: [],
    })
  }

  for (const raw of stripBom(text).split(/\r?\n/)) {
    if (raw.startsWith('>')) {
      flush()
      header = raw.slice(1)
      lines = []
    } else if (header !== null && !raw.startsWith(';')) {
      lines.push(raw)
    }
  }

  flush()

  if (out.every((s) => s.length === 0))
    throw new SequenceParseError('No sequence found in the FASTA file.')

  return out
}
