import { describe, expect, it } from 'vitest'

import { formatListDate } from './list-date'

const now = new Date('2026-09-25T08:40:00Z')

describe('formatListDate', () => {
  it('shows the time for today', () => {
    expect(formatListDate('2026-09-25T07:32:00Z', now)).toMatch(/^\d\d:\d\d$/)
  })

  it('says Yesterday for the day before', () => {
    expect(formatListDate('2026-09-24T12:00:00Z', now)).toBe('Yesterday')
  })

  it('shows day and month for earlier this year, with the year otherwise', () => {
    expect(formatListDate('2026-09-21T12:00:00Z', now)).toBe('21 Sep')
    expect(formatListDate('2025-10-01T12:00:00Z', now)).toBe('1 Oct 2025')
  })

  it('shows a dash when there is no date', () => {
    expect(formatListDate(null, now)).toBe('—')
  })
})
