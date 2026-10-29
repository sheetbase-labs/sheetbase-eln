import { describe, expect, it } from 'vitest'

import {
  columnKeyFromName,
  columnNameFromHeader,
  inferImportColumns,
} from './import-infer'

const rows = [
  {
    Well: 'A1',
    'Sample ID': '0412',
    'Read time': '2026-10-28T14:02:00',
    'Signal (RFU)': '18231.4',
    'Conc [nM]': '0.5',
    Replicate: '1',
    Passed: 'yes',
    Day: '2026-10-28',
    Notes: '',
  },
  {
    Well: 'A2',
    'Sample ID': '0413',
    'Read time': '2026-10-28T14:03:00',
    'Signal (RFU)': '1.8e4',
    'Conc [nM]': '1',
    Replicate: '2',
    Passed: 'no',
    Day: '2026-10-29',
    Notes: '',
  },
]

describe('inferImportColumns', () => {
  const columns = inferImportColumns(Object.keys(rows[0]), rows)
  const by = (source: string) => columns.find((item) => item.source === source)!

  it('reads types from the values', () => {
    expect(by('Well').type).toBe('text')
    expect(by('Read time').type).toBe('timestamp')
    expect(by('Signal (RFU)').type).toBe('decimal')
    expect(by('Conc [nM]').type).toBe('decimal')
    expect(by('Replicate').type).toBe('integer')
    expect(by('Passed').type).toBe('boolean')
    expect(by('Day').type).toBe('date')
  })

  it('keeps identifiers with leading zeros as text', () => {
    expect(by('Sample ID').type).toBe('text')
  })

  it('reads a unit from the header for numbers only', () => {
    expect(by('Signal (RFU)')).toMatchObject({ name: 'Signal', unit: 'RFU' })
    expect(by('Conc [nM]')).toMatchObject({ name: 'Conc', unit: 'nM' })
    expect(by('Well').unit).toBeNull()
  })

  it('leaves out a column that is empty throughout', () => {
    expect(by('Notes').keep).toBe(false)
    expect(by('Notes').emptyCount).toBe(2)
    expect(by('Well').keep).toBe(true)
  })

  it('gives each column a unique machine key', () => {
    const dup = inferImportColumns(
      ['Signal (A)', 'Signal (B)', '2nd read'],
      [{ 'Signal (A)': '1', 'Signal (B)': '2', '2nd read': '3' }],
    )
    expect(dup.map((item) => item.key)).toEqual([
      'signal',
      'signal_2',
      'c_2nd_read',
    ])
  })

  it('falls back to text when types are mixed', () => {
    const mixed = inferImportColumns(['x'], [{ x: '1' }, { x: 'high' }])
    expect(mixed[0].type).toBe('text')
  })

  it('treats a big whole number as a decimal, not an integer', () => {
    const big = inferImportColumns(['n'], [{ n: '123456789012345678901' }])
    expect(big[0].type).toBe('decimal')
  })
})

describe('names and keys', () => {
  it('names a blank header by its position', () => {
    expect(columnNameFromHeader('', 3)).toBe('Column 4')
  })
  it('makes a key that starts with a letter', () => {
    expect(columnKeyFromName('1st pass', new Set())).toBe('c_1st_pass')
    expect(columnKeyFromName('Viability %', new Set())).toBe('viability')
  })
})
