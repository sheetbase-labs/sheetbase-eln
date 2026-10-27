import { describe, expect, it } from 'vitest'
import { formatDate } from './format-date'

describe('formatDate', () => {
  it('reads a date as "25 Sep 2026", never "Sept"', () => {
    expect(formatDate('2026-09-25T08:40:00Z')).toBe('25 Sep 2026')
  })

  it('adds the clock when asked', () => {
    expect(formatDate('2026-09-25T08:40:00Z', { time: true })).toMatch(
      /^25 Sep 2026,? \d{2}:\d{2}$/,
    )
  })

  it('leaves the year off when asked', () => {
    expect(formatDate('2026-09-25T08:40:00Z', { year: false })).toBe('25 Sep')
  })

  it('shows a dash for nothing or nonsense', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not a date')).toBe('—')
  })
})
