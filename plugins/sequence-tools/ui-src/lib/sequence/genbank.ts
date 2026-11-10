import { guessMolecule } from './fasta'
import { SequenceParseError, stripBom } from './model'
import type {
  FeaturePart,
  ParsedSequence,
  SequenceFeature,
  Topology,
} from './model'

/**
 * Read a GenBank location such as `complement(join(1..10,20..30))`, `<1..>50`
 * or `12`. Fuzzy ends are kept as plain positions.
 */
export function parseLocation(raw: string) {
  let text = raw.replace(/\s+/g, '')
  let strand: 1 | -1 = 1
  const comp = /^complement\((.*)\)$/.exec(text)

  if (comp) {
    strand = -1
    text = comp[1]
  }

  const wrapped = /^(?:join|order)\((.*)\)$/.exec(text)
  const segments = wrapped ? splitTop(wrapped[1]) : [text]
  const parts: FeaturePart[] = []

  for (const seg of segments) {
    let s = seg
    const inner = /^complement\((.*)\)$/.exec(s)

    if (inner) {
      strand = -1
      s = inner[1]
    }

    const m = /^[<>]?(\d+)(?:(?:\.\.|\^)[<>]?(\d+))?$/.exec(
      s.replace(/^[A-Za-z0-9_.]+:/, ''),
    )

    if (!m) continue
    const start = Number(m[1])
    parts.push({ start, end: m[2] ? Number(m[2]) : start })
  }

  return { parts, strand }
}

function splitTop(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''

  for (const ch of text) {
    if (ch === '(') depth++

    if (ch === ')') depth--

    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }

  if (cur) out.push(cur)

  return out
}

const LABEL_KEYS = ['label', 'gene', 'product', 'standard_name', 'note']

function labelFor(type: string, q: Record<string, string>): string {
  for (const key of LABEL_KEYS) {
    const v = q[key]

    if (v) return v.length > 60 ? `${v.slice(0, 57)}...` : v
  }

  return type
}

function parseFeatures(
  lines: string[],
  length: number,
  circular: boolean,
): SequenceFeature[] {
  const features: SequenceFeature[] = []
  let current: { type: string; location: string; qual: string[] } | null = null

  const flush = () => {
    if (!current) return
    const { parts, strand } = parseLocation(current.location)

    if (parts.length === 0) {
      current = null

      return
    }

    const qualifiers: Record<string, string> = {}
    let key: string | null = null

    for (const line of current.qual) {
      const m = /^\/([A-Za-z_0-9-]+)(?:=(.*))?$/.exec(line)

      if (m) {
        key = m[1]
        qualifiers[key] = (m.at(2) ?? '').replace(/^"|"$/g, '')
      } else if (key) {
        qualifiers[key] += ` ${line.replace(/"$/, '')}`
      }
    }

    for (const k of Object.keys(qualifiers))
      qualifiers[k] = qualifiers[k].trim()
    const start = parts[0].start
    const end = parts[parts.length - 1].end
    features.push({
      id: features.length,
      type: current.type,
      label: labelFor(current.type, qualifiers),
      strand,
      parts,
      start: Math.min(...parts.map((p) => p.start)),
      end: Math.max(...parts.map((p) => p.end)),
      qualifiers,
    })

    // A join that wraps the origin of a circular sequence runs from its
    // first part's start round to its last part's end.
    if (circular && parts.length > 1 && start > end && end <= length) {
      const f = features[features.length - 1]
      f.start = start
      f.end = end
    }

    current = null
  }

  for (const line of lines) {
    if (/^ {5}\S/.test(line)) {
      flush()
      const m = /^ {5}(\S+)\s+(.*)$/.exec(line)

      if (m) current = { type: m[1], location: m[2], qual: [] }
    } else if (current) {
      const text = line.trim()

      if (text.startsWith('/')) current.qual.push(text)
      else if (current.qual.length > 0)
        current.qual[current.qual.length - 1] += ` ${text}`
      else current.location += text
    }
  }

  flush()

  return features.filter((f) => f.type !== 'source')
}

function parseRecord(block: string[]): ParsedSequence {
  const locus = block.find((l) => l.startsWith('LOCUS')) ?? ''
  const tokens = locus.trim().split(/\s+/)
  const name = tokens[1] ?? 'Sequence'
  const topology: Topology = /\bcircular\b/i.test(locus) ? 'circular' : 'linear'
  const lenMatch = /(\d+)\s+(bp|aa)\b/i.exec(locus)
  const isAa = lenMatch?.[2].toLowerCase() === 'aa'

  const sections: Partial<Record<string, string[]>> = {}
  let section = ''

  for (const line of block) {
    if (/^\S/.test(line)) {
      section = line.split(/\s+/)[0]
      ;(sections[section] ??= []).push(line)
    } else if (section) sections[section]?.push(line)
  }

  const originLines = sections.ORIGIN ?? []

  const residues = originLines
    .slice(1)
    .join('')
    .replace(/[\s\d/]/g, '')
    .toUpperCase()

  const length = residues.length || Number(lenMatch?.[1] ?? 0)

  const definition = (sections.DEFINITION ?? [])
    .map((l) => l.replace(/^DEFINITION/, '').trim())
    .join(' ')
    .replace(/\.$/, '')

  const organismLine = (sections.SOURCE ?? [])
    .find((l) => /^\s+ORGANISM/.test(l))
    ?.replace(/^\s+ORGANISM\s+/, '')
    .trim()

  const featureLines = (sections.FEATURES ?? []).slice(1)

  return {
    name,
    description: definition === '.' ? '' : definition,
    organism: organismLine || null,
    molecule: isAa ? 'protein' : guessMolecule(residues),
    topology,
    length,
    residues,
    features: parseFeatures(featureLines, length, topology === 'circular'),
  }
}

/** Parse a GenBank flat file holding one or more records. */
export function parseGenBank(text: string): ParsedSequence[] {
  const out: ParsedSequence[] = []
  let block: string[] = []

  for (const line of stripBom(text).split(/\r?\n/)) {
    if (line.startsWith('LOCUS') && block.some((l) => l.startsWith('LOCUS'))) {
      out.push(parseRecord(block))
      block = []
    }

    if (line.startsWith('//')) {
      if (block.length) out.push(parseRecord(block))
      block = []
    } else block.push(line)
  }

  if (block.some((l) => l.startsWith('LOCUS'))) out.push(parseRecord(block))

  if (out.length === 0)
    throw new SequenceParseError('No LOCUS line found: not a GenBank file.')

  return out
}
