import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'

import { columnLetters, sheetName, tableCsv, tableXlsx } from './table-file'

describe('tableCsv', () => {
  it('writes a header row, escapes what needs it, and starts with a BOM', () => {
    const csv = tableCsv({
      headers: ['ID', 'Name'],
      rows: [
        ['SMP-1', 'plain'],
        ['SMP-2', 'has, comma and "quotes"'],
        ['SMP-3', null],
      ],
    })
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'ID,Name',
      'SMP-1,plain',
      'SMP-2,"has, comma and ""quotes"""',
      'SMP-3,',
      '',
    ])
  })
})

describe('tableXlsx', () => {
  it('writes one worksheet with numbers, text and booleans typed', () => {
    const files = unzipSync(
      tableXlsx(
        {
          headers: ['ID', 'Qty'],
          rows: [
            ['SMP-1', 12.5],
            ['a & <b>', true],
            [null, 'x'],
          ],
        },
        'Samples',
      ),
    )
    expect(Object.keys(files)).toContain('xl/worksheets/sheet1.xml')
    expect(strFromU8(files['xl/workbook.xml'])).toContain('name="Samples"')
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
    expect(sheet).toContain('<c r="B2"><v>12.5</v></c>')
    expect(sheet).toContain('<c r="B3" t="b"><v>1</v></c>')
    expect(sheet).toContain('a &amp; &lt;b&gt;')
    // An empty cell is left out rather than written as an empty string.
    expect(sheet).not.toContain('r="A4"')
  })
})

describe('helpers', () => {
  it('names columns the way a spreadsheet does', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetters)).toEqual([
      'A',
      'Z',
      'AA',
      'AB',
      'ZZ',
      'AAA',
    ])
  })

  it('keeps a sheet name Excel accepts', () => {
    expect(sheetName('Samples: in/stock?')).toBe('Samples  in stock')
    expect(sheetName('x'.repeat(40))).toHaveLength(31)
    expect(sheetName('  ')).toBe('Sheet1')
  })
})
