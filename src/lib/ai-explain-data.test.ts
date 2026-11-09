import { describe, expect, it } from 'vitest'

import {
  chartSuggestionInstruction,
  outliersOf,
  parseChartChoice,
  trendOf,
} from './ai-explain-data'

const points = (ys: number[]) => ys.map((y, i) => ({ x: i, y }))

describe('trendOf', () => {
  it('reads direction from the least-squares slope', () => {
    expect(trendOf(points([1, 2, 3, 4, 5]))).toBe('rising')
    expect(trendOf(points([5, 4, 3, 2, 1]))).toBe('falling')
    expect(trendOf(points([3, 3.1, 2.9, 3, 3.05]))).toBe('flat')
  })
  it('says nothing about fewer than three points', () => {
    expect(trendOf(points([1, 2]))).toBeNull()
  })
})

describe('outliersOf', () => {
  it('flags values beyond 1.5 IQR', () => {
    const found = outliersOf(points([10, 11, 10, 12, 11, 10, 11, 90]))
    expect(found.map((p) => p.y)).toEqual([90])
  })
  it('needs enough points to judge', () => {
    expect(outliersOf(points([1, 2, 90]))).toEqual([])
  })
})

describe('chart suggestion', () => {
  const fields = [
    { fieldId: 'a', label: 'Time', logicalType: 'decimal' },
    { fieldId: 'b', label: 'Titre', logicalType: 'decimal' },
  ]

  const types = ['scatter', 'bar'] as const
  it('lists fields and types for the model', () => {
    const text = chartSuggestionInstruction(fields, types)
    expect(text).toContain('a | Time | decimal')
    expect(text).toContain('scatter, bar')
  })
  it('keeps a pick only when type and fields are real', () => {
    const good =
      '{"type":"scatter","x_field_id":"a","y_field_id":"b","reason":"Two measures."}'

    expect(parseChartChoice(good, fields, types)).toEqual({
      type: 'scatter',
      xFieldId: 'a',
      yFieldId: 'b',
      reason: 'Two measures.',
    })
    expect(
      parseChartChoice('{"type":"pie","y_field_id":"b"}', fields, types),
    ).toBeNull()
    expect(
      parseChartChoice('{"type":"bar","y_field_id":"zzz"}', fields, types),
    ).toBeNull()
    expect(
      parseChartChoice(
        '{"type":"bar","x_field_id":"zzz","y_field_id":"b"}',
        fields,
        types,
      ),
    ).toBeNull()
  })
})
