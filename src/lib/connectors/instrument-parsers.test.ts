import { describe, expect, it } from 'vitest'

import {
  DELIMITED_PARSER_ID,
  detectParserId,
  HPLC_PARSER_ID,
  JSON_RECORDS_PARSER_ID,
  parseHplcPeaksCsv,
  parseJsonRecords,
  parsePlateGridCsv,
  parseQpcrResultsCsv,
  PLATE_GRID_PARSER_ID,
  QPCR_PARSER_ID,
} from './instrument-parsers'
import { PLATE_READER_PARSER_ID } from './plate-reader'
import { getParser } from './registry'

const GRID = `# Instrument: SpectraMax
# Plate ID: P-7
,1,2,3
A,0.1,0.2,0.3
B,0.4,0.5,
`

const QPCR = `* Instrument Type = QuantStudio 5
* Block Type = 96-Well 0.2-mL Block

[Sample Setup]
Well,Sample Name
A1,s1

[Results]
Well,Sample Name,Target Name,CT
A1,s1,GAPDH,18.2
A2,s2,GAPDH,Undetermined

[Melt Curve]
Well,Tm
A1,80
`

const HPLC = `Sample Name,Batch 12
Injection Date,2026-10-01
Method,C18 gradient

Peak,Retention Time (min),Area,Height
1,2.31,1204.5,300.1
2,4.88,88.2,12.0
Total,,1292.7,
`

describe('plate grid parser', () => {
  it('flattens the matrix to one row per read well', () => {
    const parsed = parsePlateGridCsv(GRID)
    expect(parsed.headers).toEqual(['Well', 'Row', 'Column', 'Value'])
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.rows[0]).toEqual({
      Well: 'A1',
      Row: 'A',
      Column: '1',
      Value: '0.1',
    })
    expect(parsed.metadata.plate_id).toBe('P-7')
  })

  it('adds a Plate column when several blocks are present', () => {
    const parsed = parsePlateGridCsv(
      `Plate 1\n,1,2\nA,1,2\n\nPlate 2\n,1,2\nA,3,4\n`,
    )
    expect(parsed.headers[0]).toBe('Plate')
    expect(parsed.rows.map((r) => r.Plate)).toEqual([
      'Plate 1',
      'Plate 1',
      'Plate 2',
      'Plate 2',
    ])
  })

  it('rejects files without a grid', () => {
    expect(() => parsePlateGridCsv('a,b\n1,2\n')).toThrow(/plate grid/)
  })
})

describe('qPCR results parser', () => {
  it('reads only the Results section and the preamble metadata', () => {
    const parsed = parseQpcrResultsCsv(QPCR)
    expect(parsed.metadata.instrument_type).toBe('QuantStudio 5')
    expect(parsed.headers).toEqual(['Well', 'Sample Name', 'Target Name', 'CT'])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[1].CT).toBe('Undetermined')
    expect(parsed.warnings.join(' ')).toMatch(/Undetermined/)
  })

  it('accepts a bare table with Well and Cq columns', () => {
    const parsed = parseQpcrResultsCsv('Well\tCq\nA1\t20.1\n')
    expect(parsed.rows).toEqual([{ Well: 'A1', Cq: '20.1' }])
  })

  it('rejects when no results table exists', () => {
    expect(() => parseQpcrResultsCsv('x,y\n1,2\n')).toThrow(/qPCR/)
  })
})

describe('HPLC peak table parser', () => {
  it('splits preamble from peaks and drops the total line', () => {
    const parsed = parseHplcPeaksCsv(HPLC)
    expect(parsed.metadata.sample_name).toBe('Batch 12')
    expect(parsed.metadata.method).toBe('C18 gradient')
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]['Retention Time (min)']).toBe('2.31')
    expect(parsed.warnings).toHaveLength(1)
  })
})

describe('JSON records parser', () => {
  it('reads an array of objects with a stable header union', () => {
    const parsed = parseJsonRecords('[{"a":1},{"a":2,"b":"x"}]')
    expect(parsed.headers).toEqual(['a', 'b'])
    expect(parsed.rows).toEqual([
      { a: '1', b: '' },
      { a: '2', b: 'x' },
    ])
  })

  it('reads rows and flat metadata from an object', () => {
    const parsed = parseJsonRecords(
      '{"metadata":{"Serial No":"S1"},"rows":[{"w":"A1"}]}',
    )
    expect(parsed.metadata.serial_no).toBe('S1')
    expect(parsed.rows).toEqual([{ w: 'A1' }])
  })

  it('fails closed on malformed or non-tabular JSON', () => {
    expect(() => parseJsonRecords('{nope')).toThrow(/isn’t valid JSON/)
    expect(() => parseJsonRecords('{"a":1}')).toThrow(/rows array/)
    expect(() => parseJsonRecords('[1,2]')).toThrow(/object/)
    expect(() => parseJsonRecords('[]')).toThrow(/No data rows/)
  })
})

describe('format detection', () => {
  it('picks the parser from content', () => {
    expect(detectParserId('[{"a":1}]')).toBe(JSON_RECORDS_PARSER_ID)
    expect(detectParserId(QPCR)).toBe(QPCR_PARSER_ID)
    expect(detectParserId(HPLC)).toBe(HPLC_PARSER_ID)
    expect(detectParserId(GRID)).toBe(PLATE_GRID_PARSER_ID)
    expect(detectParserId('# Instrument: X\nWell,Sample,CT\nA1,s,1\n')).toBe(
      PLATE_READER_PARSER_ID,
    )
    expect(detectParserId('a,b\n1,2\n')).toBe(DELIMITED_PARSER_ID)
  })

  it('only returns identities that are registered', () => {
    for (const id of [
      JSON_RECORDS_PARSER_ID,
      QPCR_PARSER_ID,
      HPLC_PARSER_ID,
      PLATE_GRID_PARSER_ID,
      PLATE_READER_PARSER_ID,
      DELIMITED_PARSER_ID,
    ]) {
      expect(getParser(id)).toBeDefined()
    }
  })
})
