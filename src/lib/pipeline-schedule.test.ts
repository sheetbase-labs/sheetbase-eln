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
    // Daily schedules use server-local wall-clock time; assert local
    // components so the test is timezone-agnostic.
    const from = new Date(2026, 7, 28, 9, 0, 0)
    const next = nextRunAt('daily', { dailyAt: '14:30' }, from)
    expect(next).not.toBeNull()
    expect(next!.getFullYear()).toBe(2026)
    expect(next!.getMonth()).toBe(7)
    expect(next!.getDate()).toBe(28)
    expect(next!.getHours()).toBe(14)
    expect(next!.getMinutes()).toBe(30)
  })

  it('rolls to tomorrow when the daily time already passed', () => {
    const from = new Date(2026, 7, 28, 16, 0, 0)
    const next = nextRunAt('daily', { dailyAt: '09:30' }, from)
    expect(next).not.toBeNull()
    expect(next!.getDate()).toBe(29)
    expect(next!.getHours()).toBe(9)
    expect(next!.getMinutes()).toBe(30)
  })
})
