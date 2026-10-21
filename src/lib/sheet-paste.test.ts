import { describe, expect, it } from 'vitest'

import {
  PASTE_MAX_COLUMNS,
  PASTE_MAX_ROWS,
  parsePastedTable,
} from './sheet-paste'

describe('parsePastedTable', () => {
  it('reads tab-separated text pasted from a spreadsheet', () => {
    const table = parsePastedTable('Sample\tTitre\nS-1\t5.2\nS-2\t4.8\n')
    expect(table?.headers).toEqual(['Sample', 'Titre'])
    expect(table?.rows).toEqual([
      ['S-1', '5.2'],
      ['S-2', '4.8'],
    ])
  })

  it('reads comma-separated text with quoted cells', () => {
    const table = parsePastedTable('Sample,Note\nS-1,"first, repeated"\n')
    expect(table?.rows).toEqual([['S-1', 'first, repeated']])
  })

  it('names a blank header and pads a short row', () => {
    const table = parsePastedTable('Sample,,Note\nS-1,5.2\n')
    expect(table?.headers).toEqual(['Sample', 'Column 2', 'Note'])
    expect(table?.rows).toEqual([['S-1', '5.2', '']])
  })

  it('needs a header and a row', () => {
    expect(parsePastedTable('')).toBeNull()
    expect(parsePastedTable('Sample,Titre\n')).toBeNull()
    expect(parsePastedTable('"unclosed\n1')).toBeNull()
  })

  it('says what it left out when a paste is too large', () => {
    const header = Array.from(
      { length: PASTE_MAX_COLUMNS + 3 },
      (_, i) => `c${i}`,
    ).join(',')
    const rows = Array.from({ length: PASTE_MAX_ROWS + 2 }, () => '1').join(
      '\n',
    )
    const table = parsePastedTable(`${header}\n${rows}\n`)
    expect(table?.headers).toHaveLength(PASTE_MAX_COLUMNS)
    expect(table?.rows).toHaveLength(PASTE_MAX_ROWS)
    expect(table?.clipped).toEqual({ columns: 3, rows: 2 })
  })
})
