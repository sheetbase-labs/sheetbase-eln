import { describe, expect, it } from 'vitest'

import {
  createPlateReaderParser,
  parsePlateReaderCsv,
  PLATE_READER_PARSER_ID,
  PLATE_READER_PARSER_VERSION,
} from './plate-reader'
import { formatParserIdentity, getParser, listParsers } from './registry'

const SAMPLE = `# Instrument: QuantStudio 5
# Serial No: QS5-001
# Plate ID: PLT-42

Well,Sample,CT
A1,std-1,18.2
A2,std-2,21.7

# Trailing comment
B1,,`

describe('plate reader CSV parser', () => {
  it('extracts metadata keys normalised to snake_case', () => {
    const parsed = parsePlateReaderCsv(SAMPLE)
    expect(parsed.metadata.instrument).toBe('QuantStudio 5')
    expect(parsed.metadata.serial_no).toBe('QS5-001')
    expect(parsed.metadata.plate_id).toBe('PLT-42')
  })

  it('parses all header columns and rows', () => {
    const parsed = parsePlateReaderCsv(SAMPLE)
    expect(parsed.headers).toEqual(['Well', 'Sample', 'CT'])
    expect(parsed.rows).toHaveLength(3)
    expect(parsed.rows[0]).toEqual({ Well: 'A1', Sample: 'std-1', CT: '18.2' })
  })

  it('keeps empty values empty instead of guessing', () => {
    const parsed = parsePlateReaderCsv(SAMPLE)
    expect(parsed.rows[2].Sample).toBe('')
  })

  it('reports trailing metadata lines as warnings', () => {
    const parsed = parsePlateReaderCsv(SAMPLE)
    expect(parsed.warnings.some((w) => w.includes('Trailing metadata'))).toBe(
      true,
    )
  })

  it('throws on payloads without a table', () => {
    expect(() => parsePlateReaderCsv('# only comments\n')).toThrow(
      /No data rows/,
    )
  })

  it('handles quoted cells containing delimiters', () => {
    const parsed = parsePlateReaderCsv('A,B\n"x,1",2\n')
    expect(parsed.rows[0].A).toBe('x,1')
    expect(parsed.rows[0].B).toBe('2')
  })

  it('is registered under a stable versioned identity', () => {
    const parser = getParser(PLATE_READER_PARSER_ID)
    expect(parser).toBeDefined()
    expect(parser?.version).toBe(PLATE_READER_PARSER_VERSION)
    expect(formatParserIdentity(createPlateReaderParser())).toBe(
      `${PLATE_READER_PARSER_ID}@${PLATE_READER_PARSER_VERSION}`,
    )
    expect(listParsers().map((p) => p.parserId)).toContain(
      PLATE_READER_PARSER_ID,
    )
  })
})
