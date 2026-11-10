import { parseFasta } from './fasta'
import { parseGenBank } from './genbank'
import { SequenceParseError } from './model'
import type { ParsedSequence } from './model'

export * from './model'

export * from './analysis'

export { parseFasta } from './fasta'

export { parseGenBank, parseLocation } from './genbank'

const SEQUENCE_EXTENSIONS = [
  'gb',
  'gbk',
  'genbank',
  'gbff',
  'fa',
  'fasta',
  'fna',
  'faa',
  'fas',
]

/** Accept attribute for a sequence file picker. */
export const SEQUENCE_ACCEPT = SEQUENCE_EXTENSIONS.map((e) => `.${e}`).join(',')

export function isSequenceFileName(name: string): boolean {
  const dot = name.lastIndexOf('.')

  return (
    dot >= 0 && SEQUENCE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())
  )
}

/** Read GenBank or FASTA text, whichever it is. */
export function parseSequenceFile(text: string): ParsedSequence[] {
  const head = text.trimStart().slice(0, 200)

  if (head.startsWith('>')) return parseFasta(text)

  if (/^LOCUS/m.test(text.slice(0, 5000))) return parseGenBank(text)
  throw new SequenceParseError('This is not a GenBank or FASTA file.')
}
