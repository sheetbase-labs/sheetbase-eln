import { describe, expect, it } from 'vitest'

import { searchResultGroup } from '#/lib/search'
import type { SearchResult } from '#/lib/search'
import { typeFieldLabel, typeSearchFields } from './search-fields'

function result(fields: Record<string, unknown>): SearchResult {
  return {
    resultType: 'instrument',
    fields,
  } as unknown as SearchResult
}

describe('typeFieldLabel', () => {
  it('names the values a result carries the way a scientist would', () => {
    expect(typeFieldLabel('serial_number')).toBe('Serial number')
    expect(typeFieldLabel('temperature_min_c')).toBe('Min temperature (°C)')
  })

  it('falls back to the key for a value it does not know', () => {
    expect(typeFieldLabel('batch_size')).toBe('Batch size')
  })
})

describe('typeSearchFields', () => {
  it('offers the type values but not the ids of people', () => {
    const results = [
      result({ vendor: 'Thermo', lead: 'user-1', reviewer: 'user-2' }),
    ]
    const fields = typeSearchFields(results, searchResultGroup(results[0]))
    expect(fields.map((f) => [f.id, f.label])).toEqual([
      ['fields.vendor', 'Vendor'],
    ])
  })
})
