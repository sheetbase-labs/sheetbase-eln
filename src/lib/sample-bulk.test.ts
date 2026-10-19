import { describe, expect, it } from 'vitest'

import {
  SAMPLE_BULK_LIMIT,
  duplicateTitles,
  parseBulkSamples,
  splitQuantity,
} from './sample-bulk'

describe('splitQuantity', () => {
  it('reads a number with and without a unit', () => {
    expect(splitQuantity('500 µL')).toEqual({ quantity: 500, unit: 'µL' })
    expect(splitQuantity('2.5mg')).toEqual({ quantity: 2.5, unit: 'mg' })
    expect(splitQuantity('12')).toEqual({ quantity: 12 })
    expect(splitQuantity('1,5 mL')).toEqual({ quantity: 1.5, unit: 'mL' })
  })
  it('rejects text', () => {
    expect(splitQuantity('lots')).toBeNull()
  })
})

describe('parseBulkSamples', () => {
  it('reads a pasted spreadsheet with a header in any column order', () => {
    const text =
      'Location\tName\tQuantity\nFreezer 1\tLysate A\t500 µL\nFreezer 1\tLysate B\t1.5 mL\n'
    const { rows, issues } = parseBulkSamples(text)
    expect(issues).toEqual([])
    expect(rows).toEqual([
      {
        line: 2,
        title: 'Lysate A',
        storageLocation: 'Freezer 1',
        quantity: 500,
        quantityUnit: 'µL',
      },
      {
        line: 3,
        title: 'Lysate B',
        storageLocation: 'Freezer 1',
        quantity: 1.5,
        quantityUnit: 'mL',
      },
    ])
  })

  it('reads a bare list of names positionally', () => {
    const { rows, issues } = parseBulkSamples(
      'Plasmid 1\nPlasmid 2\n\nPlasmid 3',
    )
    expect(issues).toEqual([])
    expect(rows.map((r) => r.title)).toEqual([
      'Plasmid 1',
      'Plasmid 2',
      'Plasmid 3',
    ])
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4])
  })

  it('reads positional columns: name, type, quantity, unit, location', () => {
    const { rows } = parseBulkSamples('Serum 1,serum,200,µL,Shelf 2')
    expect(rows[0]).toMatchObject({
      title: 'Serum 1',
      sampleType: 'serum',
      quantity: 200,
      quantityUnit: 'µL',
      storageLocation: 'Shelf 2',
    })
  })

  it('treats a first row of data as data when it is not all column names', () => {
    const { rows } = parseBulkSamples('Name,Notes\nA,B')
    expect(rows.map((r) => r.title)).toEqual(['Name', 'A'])
  })

  it('reports a row it cannot read with its line and leaves it out', () => {
    const { rows, issues } = parseBulkSamples(
      'Name,Quantity\nGood,5 mL\nBad,lots\n,3',
    )
    expect(rows.map((r) => r.title)).toEqual(['Good'])
    expect(issues).toEqual([
      { line: 3, message: 'Quantity "lots" is not a number.' },
      { line: 4, message: 'Missing a name.' },
    ])
  })

  it('reports empty input', () => {
    expect(parseBulkSamples('  \n ').issues).toEqual([
      { line: 1, message: 'Nothing to register.' },
    ])
  })

  it('caps the list and says so', () => {
    const text = Array.from(
      { length: SAMPLE_BULK_LIMIT + 3 },
      (_, i) => `S${i}`,
    ).join('\n')
    const { rows, issues } = parseBulkSamples(text)
    expect(rows).toHaveLength(SAMPLE_BULK_LIMIT)
    expect(issues[0].message).toContain('at most 500')
  })
})

describe('duplicateTitles', () => {
  it('lists repeated names once', () => {
    const { rows } = parseBulkSamples('A\nB\na\nA')
    expect(duplicateTitles(rows)).toEqual(['a', 'A'])
  })
})
