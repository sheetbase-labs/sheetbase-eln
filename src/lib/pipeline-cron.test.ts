import { describe, expect, it } from 'vitest'

import { describeCron, nextCronAfter, parseCron } from './pipeline-cron'

const at = (iso: string) => new Date(iso)

describe('parseCron', () => {
  it('expands lists, ranges and steps', () => {
    const fields = parseCron('*/20 8-10,14 1,15 * 1-5')
    expect(fields?.minutes).toEqual([0, 20, 40])
    expect(fields?.hours).toEqual([8, 9, 10, 14])
    expect(fields?.daysOfMonth).toEqual([1, 15])
    expect(fields?.daysOfWeek).toEqual([1, 2, 3, 4, 5])
    expect(fields?.anyDayOfMonth).toBe(false)
    expect(fields?.anyDayOfWeek).toBe(false)
  })

  it('reads 7 as Sunday', () => {
    expect(parseCron('0 0 * * 7')?.daysOfWeek).toEqual([0])
    expect(parseCron('0 0 * * 0,7')?.daysOfWeek).toEqual([0])
  })

  it('refuses anything that is not five valid fields', () => {
    for (const bad of [
      '',
      '* * * *',
      '* * * * * *',
      '60 * * * *',
      '* 24 * * *',
      '* * 0 * *',
      '* * * 13 *',
      '* * * * 8',
      '5-1 * * * *',
      '*/0 * * * *',
      'a * * * *',
      '*/ * * * *',
    ]) {
      expect(parseCron(bad), bad).toBeNull()
    }
    expect(parseCron(null)).toBeNull()
  })
})

describe('nextCronAfter', () => {
  it('finds the next weekday 09:00 in UTC', () => {
    // Friday 2026-10-23 10:00 -> Monday 2026-10-26 09:00
    expect(
      nextCronAfter('0 9 * * 1-5', 'UTC', at('2026-10-23T10:00:00Z')),
    ).toEqual(at('2026-10-26T09:00:00Z'))
  })

  it('is strictly after the starting instant', () => {
    expect(
      nextCronAfter('0 9 * * *', 'UTC', at('2026-10-21T09:00:00Z')),
    ).toEqual(at('2026-10-22T09:00:00Z'))
  })

  it('keeps wall-clock time across a daylight-saving change', () => {
    // London leaves BST on Sunday 2026-10-25 at 02:00.
    const before = nextCronAfter(
      '30 9 * * *',
      'Europe/London',
      at('2026-10-24T00:00:00Z'),
    )
    const after = nextCronAfter(
      '30 9 * * *',
      'Europe/London',
      at('2026-10-25T09:00:00Z'),
    )
    expect(before).toEqual(at('2026-10-24T08:30:00Z')) // BST, UTC+1
    expect(after).toEqual(at('2026-10-25T09:30:00Z')) // GMT, UTC+0
  })

  it('reads the day on the zone, not on UTC', () => {
    // 23:30 on the 21st in New York is already the 22nd in UTC.
    expect(
      nextCronAfter(
        '0 8 * * *',
        'America/New_York',
        at('2026-10-22T03:30:00Z'),
      ),
    ).toEqual(at('2026-10-22T12:00:00Z'))
  })

  it('matches either day field when both are restricted', () => {
    // The 1st of the month OR any Monday.
    expect(
      nextCronAfter('0 0 1 * 1', 'UTC', at('2026-10-21T00:00:00Z')),
    ).toEqual(at('2026-10-26T00:00:00Z'))
  })

  it('finds 29 February', () => {
    expect(
      nextCronAfter('0 0 29 2 *', 'UTC', at('2026-10-21T00:00:00Z')),
    ).toEqual(at('2028-02-29T00:00:00Z'))
  })

  it('returns null for an invalid or impossible expression', () => {
    expect(nextCronAfter('nope', 'UTC', at('2026-10-21T00:00:00Z'))).toBeNull()
    expect(
      nextCronAfter('0 0 31 2 *', 'UTC', at('2026-10-21T00:00:00Z')),
    ).toBeNull()
  })
})

describe('describeCron', () => {
  it('names the shapes the form offers', () => {
    expect(describeCron('0 9 * * *')).toBe('Daily at 09:00')
    expect(describeCron('30 7 * * 1-5')).toBe('Weekdays at 07:30')
    expect(describeCron('0 6 * * 0,6')).toBe('Weekends at 06:00')
    expect(describeCron('0 9 * * 1')).toBe('Every Monday at 09:00')
    expect(describeCron('0 9 1 * *')).toBe('Monthly on day 1 at 09:00')
  })

  it('shows anything else as written', () => {
    expect(describeCron('*/15 * * * *')).toBe('*/15 * * * *')
    expect(describeCron('0 9 1 * 1')).toBe('0 9 1 * 1')
    expect(describeCron('garbage')).toBe('garbage')
  })
})
