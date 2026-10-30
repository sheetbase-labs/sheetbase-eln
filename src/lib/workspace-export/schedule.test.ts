import { describe, expect, it } from 'vitest'

import {
  BACKUP_DEFAULTS,
  RETRY_AFTER_FAILURE_MS,
  backupIsDue,
  staleAfterMs,
} from './schedule'

const now = new Date('2026-10-30T12:00:00Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000)
const never = { lastSucceededAt: null, lastFailedAt: null }

describe('backupIsDue', () => {
  it('is due when none has been made', () => {
    expect(backupIsDue(BACKUP_DEFAULTS, never, now)).toBe(true)
  })

  it('is never due when switched off', () => {
    expect(
      backupIsDue({ ...BACKUP_DEFAULTS, enabled: false }, never, now),
    ).toBe(false)
  })

  it('waits for the period after a good backup', () => {
    const last = (h: number) => ({
      lastSucceededAt: hoursAgo(h),
      lastFailedAt: null,
    })
    expect(backupIsDue(BACKUP_DEFAULTS, last(10), now)).toBe(false)
    expect(backupIsDue(BACKUP_DEFAULTS, last(24), now)).toBe(true)
    const weekly = { ...BACKUP_DEFAULTS, frequency: 'weekly' as const }
    expect(backupIsDue(weekly, last(24 * 3), now)).toBe(false)
    expect(backupIsDue(weekly, last(24 * 7), now)).toBe(true)
  })

  it('backs off after a failure, then tries again', () => {
    const failedAgo = (h: number) => ({
      lastSucceededAt: hoursAgo(48),
      lastFailedAt: hoursAgo(h),
    })
    expect(backupIsDue(BACKUP_DEFAULTS, failedAgo(1), now)).toBe(false)
    expect(
      backupIsDue(
        BACKUP_DEFAULTS,
        failedAgo(RETRY_AFTER_FAILURE_MS / 3_600_000 + 1),
        now,
      ),
    ).toBe(true)
  })

  it('ignores a failure older than the last success', () => {
    expect(
      backupIsDue(
        BACKUP_DEFAULTS,
        { lastSucceededAt: hoursAgo(30), lastFailedAt: hoursAgo(40) },
        now,
      ),
    ).toBe(true)
  })
})

describe('staleAfterMs', () => {
  it('allows the period plus a retry', () => {
    expect(staleAfterMs(BACKUP_DEFAULTS)).toBeGreaterThan(24 * 3_600_000)
    expect(
      staleAfterMs({ ...BACKUP_DEFAULTS, frequency: 'weekly' }),
    ).toBeGreaterThan(7 * 24 * 3_600_000)
  })
})
