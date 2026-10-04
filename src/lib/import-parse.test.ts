import { describe, expect, it } from 'vitest'

import {
  parseImportBytes,
  parseImportText,
  sniffImportFormat,
  zipStore,
} from './import-parse'

function xlsxFixture(): ArrayBuffer {
  return zipStore({
    '[Content_Types].xml': '<?xml version="1.0"?><Types></Types>',
    'xl/workbook.xml':
      '<workbook><sheets><sheet name="Assay" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml':
      '<sst><si><t>Sample</t></si><si><t>pH</t></si><si><t>A1</t></si></sst>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>7.4</v></c></row>
    </sheetData></worksheet>`,
  })
}

describe('import parsers', () => {
  it('parses CSV with quoted commas', () => {
    const preview = parseImportText('Sample,Note\n"A,1",ok\n', {
      format: 'csv',
    })
    expect(preview.sheets[0]?.headers).toEqual(['Sample', 'Note'])
    expect(preview.sheets[0]?.rows[0]).toEqual({ Sample: 'A,1', Note: 'ok' })
  })

  it('parses TSV and clipboard tab text', () => {
    const preview = parseImportText('Sample\tpH\nB\t7.1', {
      format: 'clipboard',
    })
    expect(preview.sheets[0]?.headers).toEqual(['Sample', 'pH'])
    expect(preview.sheets[0]?.rows[0]).toEqual({ Sample: 'B', pH: '7.1' })
  })

  it('parses JSON object arrays', () => {
    const preview = parseImportText(
      JSON.stringify([{ Sample: 'C', pH: 7.2 }]),
      { format: 'json' },
    )
    expect(preview.format).toBe('json')
    expect(preview.sheets[0]?.rows[0]).toEqual({ Sample: 'C', pH: '7.2' })
  })

  it('parses XLSX shared strings and numbers', async () => {
    const preview = await parseImportBytes(xlsxFixture(), {
      fileName: 'assay.xlsx',
    })
    expect(preview.format).toBe('xlsx')
    expect(preview.sheets[0]?.name).toBe('Assay')
    expect(preview.sheets[0]?.rows[0]).toEqual({ Sample: 'A1', pH: '7.4' })
  })

  it('skips a leading instrument metadata block before the header', () => {
    const preview = parseImportText(
      '# Instrument: PR-01\n# Exported: 2026-09-25T08:40:00Z\nsample,well\nSMP-2231,A1\n',
      { format: 'csv' },
    )
    expect(preview.sheets[0]?.headers).toEqual(['sample', 'well'])
    expect(preview.sheets[0]?.rows).toEqual([
      { sample: 'SMP-2231', well: 'A1' },
    ])
  })

  it('keeps a hash-prefixed value that is not a leading comment', () => {
    const preview = parseImportText('sample,note\nA,#N/A\n', {
      format: 'csv',
    })
    expect(preview.sheets[0]?.rows[0]).toEqual({ sample: 'A', note: '#N/A' })
  })

  it('sniffs formats from file names', () => {
    expect(sniffImportFormat('a.xlsx')).toBe('xlsx')
    expect(sniffImportFormat('a.tsv')).toBe('tsv')
    expect(sniffImportFormat('a.json')).toBe('json')
  })
})
