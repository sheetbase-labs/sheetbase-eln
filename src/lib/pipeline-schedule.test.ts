import { describe, expect, it } from 'vitest'

import { nextRunAt, validateScheduleSpec } from './pipeline-schedule'

describe('validateScheduleSpec', () => {
  it('accepts valid interval/daily/event specs', () => {
    expect(validateScheduleSpec('interval', { intervalMinutes: 30 })).toBeNull()
    expect(validateScheduleSpec('daily', { dailyAt: '09:30' })).toBeNull()
    expect(
      validateScheduleSpec('event', {
        eventType: 'dataset_version_created',
        inputName: 'input',
      }),
    ).toBeNull()
  })

  it('rejects invalid specs', () => {
    expect(
      validateScheduleSpec('interval', { intervalMinutes: 0 }),
    ).not.toBeNull()
    expect(
      validateScheduleSpec('interval', { intervalMinutes: 1.5 }),
    ).not.toBeNull()
    expect(validateScheduleSpec('daily', { dailyAt: '25:00' })).not.toBeNull()
    expect(validateScheduleSpec('daily', { dailyAt: '9am' })).not.toBeNull()
    expect(
      validateScheduleSpec('event', { eventType: 'dataset_updated' }),
    ).not.toBeNull()
    expect(
      validateScheduleSpec('event', {
        eventType: 'dataset_version_created',
        inputName: 'Bad!',
      }),
    ).not.toBeNull()
  })
})

describe('nextRunAt', () => {
  it('adds the interval to the reference time', () => {
    const from = new Date('2026-08-28T10:00:00Z')
    const next = nextRunAt('interval', { intervalMinutes: 30 }, from)
    expect(next?.toISOString()).toBe('2026-08-28T10:30:00.000Z')
  })

  it('computes the next daily occurrence today when still ahead', () => {
    // Daily schedules use an explicit IANA time zone (default UTC); assert
    // absolute instants so the test is timezone-agnostic.
    const from = new Date('2026-08-28T09:00:00Z')
    const next = nextRunAt('daily', { dailyAt: '14:30' }, from)
    expect(next?.toISOString()).toBe('2026-08-28T14:30:00.000Z')
  })

  it('rolls to tomorrow when the daily time already passed', () => {
    const from = new Date('2026-08-28T16:00:00Z')
    const next = nextRunAt('daily', { dailyAt: '09:30' }, from)
    expect(next?.toISOString()).toBe('2026-08-29T09:30:00.000Z')
  })

  it('honours an explicit IANA time zone independently of the server zone', () => {
    // 09:00 in Europe/London (UTC+1 in August) = 08:00 UTC.
    const from = new Date('2026-08-28T07:00:00Z')
    const next = nextRunAt(
      'daily',
      { dailyAt: '09:00', timeZone: 'Europe/London' },
      from,
    )
    expect(next?.toISOString()).toBe('2026-08-28T08:00:00.000Z')
  })

  it('rolls across a DST boundary deterministically', () => {
    // 30 March 2026 is after the spring forward (29 March): London is BST
    // (UTC+1). 09:00 BST = 08:00 UTC, and the rollover lands on the 31st.
    const from = new Date('2026-03-30T08:30:00Z')
    const next = nextRunAt(
      'daily',
      { dailyAt: '09:00', timeZone: 'Europe/London' },
      from,
    )
    expect(next?.toISOString()).toBe('2026-03-31T08:00:00.000Z')
  })

  it('rejects an invalid IANA time zone', () => {
    expect(
      validateScheduleSpec('daily', {
        dailyAt: '09:00',
        timeZone: 'Mars/Olympus',
      }),
    ).not.toBeNull()
  })
})
