import { describe, expect, it } from 'vitest'

import { buildFillText, onlyIsoDate, parseFillResponse } from './assist-fill'
import { PAGE_AI_MAX_TEXT_CHARS } from './page-ai'

const fields = [
  { key: 'name', label: 'Material' },
  { key: 'lot', label: 'Lot number' },
  { key: 'expiry', label: 'Expiry', hint: 'date as YYYY-MM-DD' },
]

describe('parseFillResponse', () => {
  it('keeps known fields from a JSON object, even inside a code fence', () => {
    const answer =
      'Here you go:\n```json\n{"name":"PBS","lot":4821,"x":"no"}\n```'

    expect(parseFillResponse(answer, fields)).toEqual({
      name: 'PBS',
      lot: '4821',
    })
  })
  it('drops blanks, nested values and over-long values', () => {
    const answer = JSON.stringify({
      name: ' ',
      lot: { a: 1 },
      expiry: 'x'.repeat(600),
    })

    expect(parseFillResponse(answer, fields)).toEqual({})
  })
  it('returns nothing for a reply that is not JSON', () => {
    expect(parseFillResponse('I could not find any', fields)).toEqual({})
    expect(parseFillResponse('{ broken', fields)).toEqual({})
  })
})

describe('buildFillText', () => {
  it('lists the fields and keeps the whole prompt within the limit', () => {
    const text = buildFillText(fields, 'a'.repeat(50_000))
    expect(text).toContain('- expiry: Expiry (date as YYYY-MM-DD)')
    expect(text.length).toBeLessThanOrEqual(PAGE_AI_MAX_TEXT_CHARS)
  })
})

describe('onlyIsoDate', () => {
  it('accepts only year-month-day', () => {
    expect(onlyIsoDate('2027-03-01')).toBe('2027-03-01')
    expect(onlyIsoDate('1 March 2027')).toBeNull()
  })
})
