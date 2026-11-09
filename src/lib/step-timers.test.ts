import { describe, expect, it } from 'vitest'

import { validateBlock } from '#/lib/blocks'
import {
  finishedTimers,
  formatCountdown,
  formatDuration,
  nextEndInMs,
  remainingMs,
  stepDurationSeconds,
  toStepTimer,
} from './step-timers'
import type { StepTimerWire } from './step-timers'

const wire: StepTimerWire = {
  id: 't1',
  record_id: 'r1',
  block_id: 'b1',
  label: 'Incubate',
  duration_seconds: 600,
  started_at: '2026-11-04T10:00:00Z',
  ends_at: '2026-11-04T10:10:00Z',
  server_now: '2026-11-04T10:02:00Z',
}

describe('step timer maths', () => {
  it('counts down from the server clock even when this device is wrong', () => {
    // The device thinks it is 09:00; the server said 10:02 at the same moment.
    const received = Date.parse('2026-11-04T09:00:00Z')
    const timer = toStepTimer(wire, received)
    expect(remainingMs(timer, received)).toBe(8 * 60_000)
    expect(remainingMs(timer, received + 8 * 60_000)).toBe(0)
    expect(remainingMs(timer, received + 20 * 60_000)).toBe(0)
  })

  it('finds finished timers and the next end', () => {
    const now = Date.parse('2026-11-04T10:02:00Z')
    const running = toStepTimer(wire, now)

    const done = toStepTimer(
      { ...wire, id: 't2', ends_at: '2026-11-04T10:01:00Z' },
      now,
    )

    expect(finishedTimers([running, done], now).map((t) => t.id)).toEqual([
      't2',
    ])
    expect(nextEndInMs([running, done], now)).toBe(8 * 60_000)
    expect(nextEndInMs([done], now)).toBeNull()
  })

  it('formats countdowns and lengths', () => {
    expect(formatCountdown(90_000)).toBe('1:30')
    expect(formatCountdown(3_725_000)).toBe('1:02:05')
    expect(formatCountdown(500)).toBe('0:01')
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatDuration(90)).toBe('1 min 30 s')
    expect(formatDuration(5400)).toBe('1 h 30 min')
    expect(formatDuration(45)).toBe('45 s')
  })

  it('reads a step duration only when it is usable', () => {
    expect(stepDurationSeconds({ durationSeconds: 1800 })).toBe(1800)
    expect(stepDurationSeconds({ durationSeconds: 0 })).toBeNull()
    expect(stepDurationSeconds({ durationSeconds: 1.5 })).toBeNull()
    expect(stepDurationSeconds({ durationSeconds: '30' })).toBeNull()
    expect(stepDurationSeconds({ durationSeconds: 700_000 })).toBeNull()
    expect(stepDurationSeconds({})).toBeNull()
    expect(stepDurationSeconds(null)).toBeNull()
  })
})

describe('procedure step duration', () => {
  const check = (durationSeconds: unknown) =>
    validateBlock({
      type: 'procedure_step',
      payload: { text: 'Incubate', stepNumber: 1, durationSeconds },
      payloadSchemaVersion: 1,
    })

  it('accepts whole seconds up to a week', () => {
    expect(check(1800).ok).toBe(true)
    expect(check(604_800).ok).toBe(true)
  })

  it('rejects anything else', () => {
    expect(check(0).ok).toBe(false)
    expect(check(-5).ok).toBe(false)
    expect(check(2.5).ok).toBe(false)
    expect(check(604_801).ok).toBe(false)
    expect(check('30').ok).toBe(false)
  })
})
