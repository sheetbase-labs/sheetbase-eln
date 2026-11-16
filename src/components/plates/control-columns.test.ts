import { describe, expect, it } from 'vitest'

import { assignControlColumns, parseColumnList } from './merge-plate'

describe('parseColumnList', () => {
  it('reads numbers, lists and ranges inside the plate', () => {
    expect(parseColumnList('1, 3-5; 24', 24)).toEqual([1, 3, 4, 5, 24])
    expect(parseColumnList('5-3', 12)).toEqual([3, 4, 5])
  })

  it('ignores columns the plate does not have and words', () => {
    expect(parseColumnList('0 13 x 12', 12)).toEqual([12])
    expect(parseColumnList('', 12)).toEqual([])
  })
})

describe('assignControlColumns', () => {
  const wells = ['A1', 'A2', 'B12', 'B11'].map((wellCode) => ({
    wellCode,
    role: 'sample' as const,
    sampleLabel: wellCode,
  }))

  it('marks the named columns as controls', () => {
    const out = assignControlColumns(wells, 12, {
      negative: '1',
      positive: '12',
    })

    expect(out.map((w) => w.role)).toEqual([
      'negative_control',
      'sample',
      'positive_control',
      'sample',
    ])
  })

  it('leaves the plate alone when no column is named', () => {
    expect(
      assignControlColumns(wells, 12, { negative: '', positive: '' }),
    ).toBe(wells)
  })
})
