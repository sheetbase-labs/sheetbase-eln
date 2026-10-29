import { describe, expect, it } from 'vitest'

import {
  parseImportBytes,
  isXlsxBytes,
  matrixToCsv,
  parseImportText,
  readXlsxMatrices,
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

  it('preserves escaped quotes, quoted newlines, empty cells and CRLF', () => {
    const preview = parseImportText(
      'Sample,Note,Blank\r\nA,"said ""yes""\r\nnext",\r\nB,"",end',
      { format: 'csv' },
    )
    expect(preview.sheets[0]?.rows).toEqual([
      { Sample: 'A', Note: 'said "yes"\r\nnext', Blank: '' },
      { Sample: 'B', Note: '', Blank: 'end' },
    ])
    expect(() => parseImportText('a\n"unfinished')).toThrow(/not closed/)
    expect(() => parseImportText('a\nbad"quote')).toThrow(/Malformed/)
  })

  it('accepts 100,000 rows without spreading them onto the call stack and rejects the next row', () => {
    const text =
      'sample,value\n' +
      Array.from({ length: 100_000 }, (_, i) => `S${i},${i + 0.25}\n`).join('')
    const preview = parseImportText(text, { format: 'csv' })
    expect(preview.sheets[0]?.rows).toHaveLength(100_000)
    expect(preview.sheets[0]?.rows.at(-1)).toEqual({
      sample: 'S99999',
      value: '99999.25',
    })
    expect(() =>
      parseImportText(text + 'overflow,1\n', { format: 'csv' }),
    ).toThrow(/100,000 rows/)
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

describe('workbooks as plain rows', () => {
  it('recognises a workbook by its first bytes', () => {
    expect(isXlsxBytes(new Uint8Array(xlsxFixture()))).toBe(true)
    expect(isXlsxBytes(new TextEncoder().encode('Sample,pH\n'))).toBe(false)
  })

  it('reads every sheet with data as rows and cells, header row included', async () => {
    const sheets = await readXlsxMatrices(xlsxFixture())
    expect(sheets).toEqual([
      {
        name: 'Assay',
        matrix: [
          ['Sample', 'pH'],
          ['A1', '7.4'],
        ],
      },
    ])
  })

  it('writes cells as CSV, quoting commas, quotes and line breaks', () => {
    expect(
      matrixToCsv([
        ['Sample', 'Note'],
        ['A,1', 'said "yes"\nnext'],
      ]),
    ).toBe('Sample,Note\n"A,1","said ""yes""\nnext"\n')
  })
})
