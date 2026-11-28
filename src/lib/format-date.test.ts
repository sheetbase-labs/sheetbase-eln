import { describe, expect, it } from 'vitest'
import {
  formatAgo,
  formatDate,
  formatDay,
  formatLongDay,
  formatMonth,
  formatRange,
  formatWeekday,
} from './format-date'

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

describe('the shared date formatters', () => {
  const at = '2026-09-25T08:40:00Z'

  it('writes a day, a weekday and a month one way', () => {
    expect(formatDay(at, { timeZone: 'UTC' })).toBe('25 Sep')
    expect(formatDay(at, { weekday: true, timeZone: 'UTC' })).toBe('Fri 25 Sep')
    expect(formatMonth(at, { timeZone: 'UTC' })).toBe('Sep')
    expect(formatMonth(at, { year: true, timeZone: 'UTC' })).toBe('Sep 2026')
    expect(formatLongDay(at, { timeZone: 'UTC' })).toBe('Friday 25 September')
    expect(formatWeekday(at, { day: true, timeZone: 'UTC' })).toBe('Fri 25')
  })

  it('reads a bare calendar day without moving it', () => {
    expect(formatDate('2026-09-25', { timeZone: 'Pacific/Honolulu' })).toBe(
      '25 Sep 2026',
    )
  })

  it('takes milliseconds as well as strings and dates', () => {
    expect(formatDay(Date.parse(at), { timeZone: 'UTC' })).toBe('25 Sep')
  })

  it('names the zone for audit times', () => {
    expect(formatDate(at, { time: true, timeZone: 'UTC', zone: true })).toMatch(
      /^25 Sep 2026,? 08:40 UTC$/,
    )
  })

  it('writes a range once per day', () => {
    expect(
      formatRange(at, '2026-09-25T10:00:00Z', { time: true, timeZone: 'UTC' }),
    ).toMatch(/^25 Sep, 08:40–10:00$/)
    expect(formatRange(at, '2026-10-02T10:00:00Z', { timeZone: 'UTC' })).toBe(
      '25 Sep – 2 Oct',
    )
  })

  it('says how long ago in one style, then falls back to the date', () => {
    const now = new Date('2026-09-25T12:00:00Z')

    expect(formatAgo('2026-09-25T11:59:30Z', now)).toBe('just now')
    expect(formatAgo('2026-09-25T11:54:00Z', now)).toBe('6m ago')
    expect(formatAgo('2026-09-25T06:00:00Z', now)).toBe('6h ago')
    expect(formatAgo('2026-09-23T12:00:00Z', now)).toBe('2d ago')
    expect(formatAgo('2026-09-04T12:00:00Z', now)).toBe('3w ago')
    expect(formatAgo('2026-09-25T15:00:00Z', now)).toBe('in 3h')
    expect(formatAgo('2026-06-01T12:00:00Z', now)).toMatch(/Jun 2026$/)
  })
})
