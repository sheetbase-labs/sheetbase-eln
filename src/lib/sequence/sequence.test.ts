import { describe, expect, it } from 'vitest'

import {
  featureResidues,
  gcPercent,
  isSequenceFileName,
  parseFasta,
  parseGenBank,
  parseLocation,
  parseSequenceFile,
  reverseComplement,
  searchText,
  summarise,
  translate,
} from './index'

const GENBANK = `LOCUS       pTest                     60 bp    DNA     circular SYN 01-JAN-2026
DEFINITION  Test plasmid.
SOURCE      synthetic construct
  ORGANISM  synthetic construct
FEATURES             Location/Qualifiers
     source          1..60
                     /organism="synthetic construct"
     promoter        1..10
                     /label=T7 promoter
     CDS             11..22
                     /label=GFP
                     /note="a long note that
                     wraps onto a second line"
     CDS             complement(30..41)
                     /gene="bla"
     misc_feature    join(55..60,1..4)
                     /label=wraps
ORIGIN
        1 taatacgact atggtgagca aggagctgtt caccggcgtg gtgcccatcc tggtcgagct
//
`

describe('parseGenBank', () => {
  const [seq] = parseGenBank(GENBANK)
  it('reads the header', () => {
    expect(seq.name).toBe('pTest')
    expect(seq.topology).toBe('circular')
    expect(seq.molecule).toBe('dna')
    expect(seq.length).toBe(60)
    expect(seq.description).toBe('Test plasmid')
    expect(seq.organism).toBe('synthetic construct')
  })
  it('reads features, skipping the source', () => {
    expect(seq.features.map((f) => f.label)).toEqual([
      'T7 promoter',
      'GFP',
      'bla',
      'wraps',
    ])
    expect(seq.features[1].qualifiers.note).toBe(
      'a long note that wraps onto a second line',
    )
    expect(seq.features[2].strand).toBe(-1)
  })
  it('flags a feature that crosses the origin', () => {
    const wrap = seq.features[3]
    expect(wrap.start).toBe(55)
    expect(wrap.end).toBe(4)
  })
  it('reads several records', () => {
    expect(parseGenBank(`${GENBANK}${GENBANK}`)).toHaveLength(2)
  })
  it('rejects other text', () => {
    expect(() => parseGenBank('hello')).toThrow()
  })
})

describe('parseFasta', () => {
  it('reads records and guesses the molecule', () => {
    const out = parseFasta('>a first\nACGT\nACGT\n>b\nMKTAYIAK\n')
    expect(out[0]).toMatchObject({ name: 'a', description: 'first', length: 8 })
    expect(out[1].molecule).toBe('protein')
  })
})

describe('parseSequenceFile', () => {
  it('detects the format', () => {
    expect(parseSequenceFile('>x\nAC')[0].name).toBe('x')
    expect(parseSequenceFile(GENBANK)[0].name).toBe('pTest')
    expect(() => parseSequenceFile('nope')).toThrow(/not a GenBank/)
  })
  it('recognises file names', () => {
    expect(isSequenceFileName('pUC19.GB')).toBe(true)
    expect(isSequenceFileName('data.csv')).toBe(false)
  })
})

describe('parseLocation', () => {
  it('handles complement, join and fuzzy ends', () => {
    expect(parseLocation('complement(join(1..5,9..12))')).toEqual({
      strand: -1,
      parts: [
        { start: 1, end: 5 },
        { start: 9, end: 12 },
      ],
    })
    expect(parseLocation('<3..>9').parts).toEqual([{ start: 3, end: 9 }])
    expect(parseLocation('7').parts).toEqual([{ start: 7, end: 7 }])
  })
})

describe('analysis', () => {
  it('reverse complements and translates', () => {
    expect(reverseComplement('AACG')).toBe('CGTT')
    expect(translate('ATGGTGAGCTAA')).toBe('MVS')
  })
  it('counts GC and summarises', () => {
    expect(gcPercent('GGCC')).toBe(100)
    const [seq] = parseGenBank(GENBANK)
    expect(summarise(seq)).toMatchObject({ length: 60, featureCount: 4 })
    expect(searchText([seq])).toContain('T7 promoter')
    expect(featureResidues(seq.residues, seq.features[1].parts, 1)).toBe(
      'ATGGTGAGCAAG',
    )
  })
})
