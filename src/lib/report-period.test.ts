import { describe, expect, it } from 'vitest'

import {
  addMoney,
  dayEnd,
  dayStart,
  formatHours,
  formatMoney,
  formatMonthKey,
  formatRange,
  formatShare,
  formatTotals,
  isoDay,
  monthKey,
  resolvePeriod,
  startOfDay,
  weekdaysIn,
} from './report-period'

// Wednesday 18 November 2026, 10:30 in London (UTC+0 in winter).
const NOW = new Date('2026-11-18T10:30:00Z')

describe('resolvePeriod', () => {
  it('reads the previous week as Monday to Sunday before this one', () => {
    const range = resolvePeriod('previous_week', NOW, 'Europe/London')
    expect(range.from.toISOString()).toBe('2026-11-09T00:00:00.000Z')
    expect(range.to.toISOString()).toBe('2026-11-16T00:00:00.000Z')
  })

  it('reads the previous month as the whole calendar month before', () => {
    const range = resolvePeriod('previous_month', NOW, 'Europe/London')
    expect(range.from.toISOString()).toBe('2026-09-30T23:00:00.000Z')
    expect(range.to.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  it('wraps to December when the month before is in the last year', () => {
    const range = resolvePeriod(
      'last_month',
      new Date('2027-01-10T12:00:00Z'),
      'UTC',
    )

    expect(range.from.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(range.to.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('counts this month up to the end of today', () => {
    const range = resolvePeriod('this_month', NOW, 'UTC')
    expect(range.from.toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(range.to.toISOString()).toBe('2026-11-19T00:00:00.000Z')
  })

  it('stops the rolling periods at the start of today', () => {
    const seven = resolvePeriod('last_7_days', NOW, 'UTC')
    expect(seven.from.toISOString()).toBe('2026-11-11T00:00:00.000Z')
    expect(seven.to.toISOString()).toBe('2026-11-18T00:00:00.000Z')
    const thirty = resolvePeriod('last_30_days', NOW, 'UTC')
    expect(thirty.from.toISOString()).toBe('2026-10-19T00:00:00.000Z')
  })

  it('follows the clock of the time zone, summer time included', () => {
    // 1 September 2026 starts at 23:00 UTC the evening before in London (BST).
    const range = resolvePeriod(
      'previous_month',
      new Date('2026-09-15T12:00:00Z'),
      'Europe/London',
    )

    expect(range.from.toISOString()).toBe('2026-07-31T23:00:00.000Z')
    expect(range.to.toISOString()).toBe('2026-08-31T23:00:00.000Z')
  })

  it('puts a late evening on the next day east of Greenwich', () => {
    // 23:30 UTC on the 17th is already the 18th in Tokyo.
    expect(isoDay(new Date('2026-11-17T23:30:00Z'), 'Asia/Tokyo')).toBe(
      '2026-11-18',
    )
  })
})

describe('days and months', () => {
  it('turns date fields into a half-open range', () => {
    expect(dayStart('2026-03-01', 'UTC')?.toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    )
    expect(dayEnd('2026-03-31', 'UTC')?.toISOString()).toBe(
      '2026-04-01T00:00:00.000Z',
    )
    expect(dayStart('nonsense', 'UTC')).toBeNull()
    expect(dayEnd('', 'UTC')).toBeNull()
  })

  it('finds the instant a day starts across a clock change', () => {
    // Clocks go forward in London on 29 March 2026.
    expect(
      startOfDay(
        { year: 2026, month: 3, day: 29 },
        'Europe/London',
      ).toISOString(),
    ).toBe('2026-03-29T00:00:00.000Z')
    expect(
      startOfDay(
        { year: 2026, month: 3, day: 30 },
        'Europe/London',
      ).toISOString(),
    ).toBe('2026-03-29T23:00:00.000Z')
  })

  it('names the month a line belongs to in the zone', () => {
    expect(monthKey('2026-10-31T23:30:00Z', 'Europe/London')).toBe('2026-10')
    expect(monthKey('2026-10-31T23:30:00Z', 'Asia/Tokyo')).toBe('2026-11')
    expect(formatMonthKey('2026-11')).toBe('Nov 2026')
    expect(formatMonthKey('bad')).toBe('bad')
  })

  it('counts Monday to Friday over a range', () => {
    const week = {
      from: new Date('2026-11-09T00:00:00Z'),
      to: new Date('2026-11-16T00:00:00Z'),
    }

    expect(weekdaysIn(week, 'UTC')).toBe(5)

    const weekend = {
      from: new Date('2026-11-14T00:00:00Z'),
      to: new Date('2026-11-16T00:00:00Z'),
    }

    expect(weekdaysIn(weekend, 'UTC')).toBe(0)
  })

  it('writes a range with its last day included', () => {
    const range = {
      from: new Date('2026-11-01T00:00:00Z'),
      to: new Date('2026-12-01T00:00:00Z'),
    }

    expect(formatRange(range, 'UTC')).toBe('1 Nov 2026 to 30 Nov 2026')
    expect(
      formatRange(
        {
          from: new Date('2026-11-01T00:00:00Z'),
          to: new Date('2026-11-02T00:00:00Z'),
        },
        'UTC',
      ),
    ).toBe('1 Nov 2026')
  })
})

describe('money and hours', () => {
  it('keeps a total per currency and never mixes them', () => {
    const totals = {}
    addMoney(totals, 10.1, 'GBP')
    addMoney(totals, 20.2, 'GBP')
    addMoney(totals, 5, 'EUR')
    expect(totals).toEqual({ GBP: 30.3, EUR: 5 })
    expect(formatTotals(totals)).toBe('€5.00 · £30.30')
    expect(formatTotals({})).toBe('')
  })

  it('formats amounts, hours and shares', () => {
    expect(formatMoney(1250, 'GBP')).toBe('£1,250.00')
    expect(formatHours(12.5)).toBe('12.5')
    expect(formatHours(3)).toBe('3')
    expect(formatShare(0.426)).toBe('43%')
  })
})
