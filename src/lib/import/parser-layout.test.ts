import { describe, expect, it } from 'vitest'

import { ImportParseError } from '../import-parse'
import { layoutOf, parserLayoutSchema, readWithLayout } from './parser-layout'

describe('readWithLayout', () => {
  it('reads details, skips a banner and finds a header that is not first', () => {
    const file = [
      'Spectro-9 export',
      'Serial: SP9-0042',
      'Operator: ana',
      '',
      'Sample,Abs 280 (AU),Conc (mg/mL)',
      '---',
      'S1,0.52,1.1',
      'S2,0.61,1.4',
      'Total,,',
    ].join('\n')
    const out = readWithLayout(file, {
      headerStartsWith: 'sample',
      readDetails: true,
      ignoreLines: ['---'],
      stopAt: 'Total',
      units: 'header',
    })
    expect(out.headers).toEqual(['Sample', 'Abs 280', 'Conc'])
    expect(out.rows).toEqual([
      { Sample: 'S1', 'Abs 280': '0.52', Conc: '1.1' },
      { Sample: 'S2', 'Abs 280': '0.61', Conc: '1.4' },
    ])
    expect(out.metadata).toMatchObject({
      Serial: 'SP9-0042',
      Operator: 'ana',
      'Abs 280 unit': 'AU',
      'Conc unit': 'mg/mL',
    })
    expect(out.warnings.join(' ')).toContain('Stopped reading')
  })

  it('reads units from a row under the header and decimal commas', () => {
    const out = readWithLayout('Sample;Conc;Temp\n;mg/mL;C\nS1;1,25;37,0\n', {
      units: 'row',
      decimalComma: true,
    })
    expect(out.rows).toEqual([{ Sample: 'S1', Conc: '1.25', Temp: '37.0' }])
    expect(out.metadata).toEqual({ 'Conc unit': 'mg/mL', 'Temp unit': 'C' })
  })

  it('warns instead of mangling numbers when commas separate cells', () => {
    const out = readWithLayout('a,b\n1,2\n', { decimalComma: true })
    expect(out.rows).toEqual([{ a: '1', b: '2' }])
    expect(out.warnings.join(' ')).toContain('Decimal commas')
  })

  it('turns a plate grid into one row per well', () => {
    const out = readWithLayout('Plate 1\n,1,2,3\nA,0.1,0.2,0.3\nB,0.4,,0.6\n', {
      plateGrid: { valueName: 'OD450' },
    })
    expect(out.headers).toEqual(['Well', 'Row', 'Column', 'OD450'])
    expect(out.rows).toHaveLength(5)
    expect(out.rows[0]).toEqual({
      Well: 'A1',
      Row: 'A',
      Column: '1',
      OD450: '0.1',
    })
  })

  it('labels each plate when a file has several', () => {
    const out = readWithLayout('Day 1\n,1,2\nA,1,2\nDay 2\n,1,2\nA,3,4\n', {
      plateGrid: { valueName: 'OD' },
    })
    expect(out.headers[0]).toBe('Plate')
    expect(out.rows.map((r) => r.Plate)).toEqual([
      'Day 1',
      'Day 1',
      'Day 2',
      'Day 2',
    ])
  })

  it('says why a file can’t be read', () => {
    expect(() =>
      readWithLayout('a,b\n1,2', { headerStartsWith: 'Sample' }),
    ).toThrow(/Couldn’t find a header line starting with “Sample”/)
    expect(() =>
      readWithLayout('a,b\n1,2', { plateGrid: { valueName: 'OD' } }),
    ).toThrow(ImportParseError)
    expect(() => readWithLayout('a,b\n1,2', { headerLine: 9 })).toThrow(
      /only 2 lines/,
    )
  })

  it('uses a numbered header line', () => {
    const out = readWithLayout('junk\nmore junk\nx,y\n1,2\n', { headerLine: 3 })
    expect(out.rows).toEqual([{ x: '1', y: '2' }])
  })
})

describe('layoutOf', () => {
  it('returns a valid layout and refuses an invalid one', () => {
    expect(layoutOf({ layout: { units: 'row' } })).toEqual({ units: 'row' })
    expect(layoutOf({ layout: { units: 'bogus' } })).toBeNull()
    expect(layoutOf({})).toBeNull()
    expect(parserLayoutSchema.safeParse({ extra: 1 }).success).toBe(false)
  })
})
