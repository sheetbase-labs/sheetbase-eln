// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SAMPLE_HOLD_BATCH_LIMIT,
  effectiveHoldDeadline,
  isHoldExceeded,
  parseHoldLimit,
  startSampleHoldScheduler,
  stopSampleHoldScheduler,
  sweepSampleHoldLimits,
} from './sample-hold.server'
import type { HoldConnection, HoldLog } from './sample-hold.server'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
})

const NOW = new Date('2026-09-25T12:00:00.000Z')
const CREATED = '2026-09-20T00:00:00.000Z'

function fakeConnection(exceededCount = 0): HoldConnection {
  return {
    query: (async () => ({
      rows: [{ result: { exceededCount, exceeded: [] } }],
    })) as HoldConnection['query'],
    end: vi.fn(async () => {}),
  }
}

function silentLog(): HoldLog {
  return { info: vi.fn(), warn: vi.fn() }
}

beforeEach(() => {
  stopSampleHoldScheduler()
  delete process.env.SHEETBASE_SCHEDULER_ENABLED
})

afterEach(() => {
  stopSampleHoldScheduler()
  vi.useRealTimers()
  delete process.env.SHEETBASE_SCHEDULER_ENABLED
})

describe('parseHoldLimit', () => {
  it('reads the hold condition, duration, explicit deadline and allowed uses', () => {
    const parsed = parseHoldLimit({
      holdCondition: '2-8 C',
      holdStartedAt: CREATED,
      holdDurationDays: 14,
      holdUntil: '2026-10-04T00:00:00.000Z',
      allowedUseExperimentIds: ['exp-1', 'exp-2', 42],
    })
    expect(parsed.condition).toBe('2-8 C')
    expect(parsed.startedAt).toBe(CREATED)
    expect(parsed.durationDays).toBe(14)
    expect(parsed.until).toBe('2026-10-04T00:00:00.000Z')
    expect(parsed.allowedUseExperimentIds).toEqual(['exp-1', 'exp-2'])
  })

  it('treats empty or wrong-typed values as absent', () => {
    const parsed = parseHoldLimit({
      holdCondition: '   ',
      holdDurationDays: 'not-a-number',
      allowedUseExperimentIds: 'exp-1',
    })
    expect(parsed.condition).toBeNull()
    expect(parsed.durationDays).toBeNull()
    expect(parsed.allowedUseExperimentIds).toEqual([])
  })
})

describe('effectiveHoldDeadline / isHoldExceeded', () => {
  it('uses holdStartedAt plus holdDurationDays', () => {
    const sample = {
      createdAt: CREATED,
      properties: { holdStartedAt: CREATED, holdDurationDays: 14 },
    }
    expect(effectiveHoldDeadline(sample)?.toISOString()).toBe(
      '2026-10-04T00:00:00.000Z',
    )
  })

  it('falls back to the record createdAt for the start', () => {
    const sample = {
      createdAt: CREATED,
      properties: { holdDurationDays: 14 },
    }
    expect(effectiveHoldDeadline(sample)?.toISOString()).toBe(
      '2026-10-04T00:00:00.000Z',
    )
  })

  it('prefers an explicit holdUntil over the duration', () => {
    const sample = {
      createdAt: CREATED,
      properties: {
        holdStartedAt: CREATED,
        holdDurationDays: 14,
        holdUntil: '2026-09-24T00:00:00.000Z',
      },
    }
    expect(effectiveHoldDeadline(sample)?.toISOString()).toBe(
      '2026-09-24T00:00:00.000Z',
    )
    expect(isHoldExceeded(sample, NOW)).toBe(true)
  })

  it('does not exceed before the deadline and does after', () => {
    const sample = {
      createdAt: CREATED,
      properties: {
        holdStartedAt: '2026-09-24T00:00:00.000Z',
        holdDurationDays: 3,
      },
    }
    expect(isHoldExceeded(sample, NOW)).toBe(false)
    expect(isHoldExceeded(sample, new Date('2026-09-28T00:00:00.000Z'))).toBe(
      true,
    )
  })

  it('returns null / false when no hold limit is configured', () => {
    const sample = {
      createdAt: CREATED,
      properties: { holdCondition: '2-8 C' },
    }
    expect(effectiveHoldDeadline(sample)).toBeNull()
    expect(isHoldExceeded(sample, NOW)).toBe(false)
  })
})

describe('sweepSampleHoldLimits', () => {
  it('calls the sweep RPC with the batch limit and returns the exceeded count', async () => {
    const calls: string[] = []
    const values: unknown[][] = []
    const conn: HoldConnection = {
      query: (async (text: string, params?: unknown[]) => {
        calls.push(text)
        values.push(params ?? [])
        return { rows: [{ result: { exceededCount: 3, exceeded: [] } }] }
      }) as HoldConnection['query'],
      end: vi.fn(async () => {}),
    }

    const exceeded = await sweepSampleHoldLimits(
      { connect: async () => conn },
      250,
    )

    expect(exceeded).toBe(3)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('api.sweep_sample_hold_limits($1)')
    expect(values[0]).toEqual([250])
    expect(conn.end).toHaveBeenCalledTimes(1)
  })

  it('uses the bounded default batch limit when none is supplied', async () => {
    const values: unknown[][] = []
    const conn: HoldConnection = {
      query: (async (_text: string, params?: unknown[]) => {
        values.push(params ?? [])
        return { rows: [{ result: { exceededCount: 0, exceeded: [] } }] }
      }) as HoldConnection['query'],
      end: vi.fn(async () => {}),
    }

    await sweepSampleHoldLimits({ connect: async () => conn })

    expect(values[0]).toEqual([SAMPLE_HOLD_BATCH_LIMIT])
  })
})

describe('startSampleHoldScheduler', () => {
  it('swallows a sweep failure, logs it, and keeps the interval running', async () => {
    vi.useFakeTimers()
    process.env.SHEETBASE_SCHEDULER_ENABLED = 'true'
    let attempt = 0
    const connect = vi.fn(async (): Promise<HoldConnection> => {
      attempt += 1
      if (attempt === 1) throw new Error('database unavailable')
      return fakeConnection(2)
    })
    const log = silentLog()

    startSampleHoldScheduler({
      deps: { connect },
      intervalMs: 60_000,
      log,
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(connect).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenCalledWith('sample hold sweep failed', {
      error: 'database unavailable',
      durationMs: expect.any(Number),
    })
    expect(log.info).toHaveBeenCalledWith('sample hold sweep complete', {
      exceededCount: 2,
      durationMs: expect.any(Number),
    })
  })

  it('does not start under a test runner unless explicitly enabled', async () => {
    vi.useFakeTimers()
    const connect = vi.fn(async () => fakeConnection())

    startSampleHoldScheduler({ deps: { connect }, intervalMs: 10 })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(connect).not.toHaveBeenCalled()
  })

  it('is disabled by SHEETBASE_SCHEDULER_ENABLED=false', async () => {
    vi.useFakeTimers()
    process.env.SHEETBASE_SCHEDULER_ENABLED = 'false'
    const connect = vi.fn(async () => fakeConnection())

    startSampleHoldScheduler({
      deps: { connect },
      intervalMs: 10,
      log: silentLog(),
    })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(connect).not.toHaveBeenCalled()
  })
})
