// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DATASET_PRUNE_BATCH_LIMIT,
  startDatasetRetentionScheduler,
  stopDatasetRetentionScheduler,
  sweepDatasetRetention,
} from './dataset-retention-scheduler.server'
import type {
  RetentionConnection,
  RetentionLog,
} from './dataset-retention-scheduler.server'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
})

function fakeConnection(prunedCount = 0, calls: string[] = []) {
  const conn: RetentionConnection = {
    query: (async (text: string, values?: unknown[]) => {
      calls.push(text)
      void values
      return { rows: [{ result: { prunedCount, pruned: [] } }] }
    }) as RetentionConnection['query'],
    end: vi.fn(async () => {}),
  }
  return { conn, calls }
}

function silentLog(): RetentionLog {
  return { info: vi.fn(), warn: vi.fn() }
}

beforeEach(() => {
  stopDatasetRetentionScheduler()
  delete process.env.SHEETBASE_SCHEDULER_ENABLED
})

afterEach(() => {
  stopDatasetRetentionScheduler()
  vi.useRealTimers()
  delete process.env.SHEETBASE_SCHEDULER_ENABLED
})

describe('sweepDatasetRetention', () => {
  it('calls the prune RPC with the batch limit and returns the pruned count', async () => {
    const calls: string[] = []
    const values: unknown[][] = []
    const conn: RetentionConnection = {
      query: (async (text: string, params?: unknown[]) => {
        calls.push(text)
        values.push(params ?? [])
        return { rows: [{ result: { prunedCount: 3, pruned: [] } }] }
      }) as RetentionConnection['query'],
      end: vi.fn(async () => {}),
    }
    const deps = { connect: async () => conn }

    const pruned = await sweepDatasetRetention(deps, 250)

    expect(pruned).toBe(3)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('api.prune_dataset_versions($1)')
    expect(values[0]).toEqual([250])
    expect(conn.end).toHaveBeenCalledTimes(1)
  })

  it('uses the bounded default batch limit when none is supplied', async () => {
    const values: unknown[][] = []
    const conn: RetentionConnection = {
      query: (async (_text: string, params?: unknown[]) => {
        values.push(params ?? [])
        return { rows: [{ result: { prunedCount: 0, pruned: [] } }] }
      }) as RetentionConnection['query'],
      end: vi.fn(async () => {}),
    }

    await sweepDatasetRetention({ connect: async () => conn })

    expect(values[0]).toEqual([DATASET_PRUNE_BATCH_LIMIT])
  })
})

describe('startDatasetRetentionScheduler', () => {
  it('swallows a sweep failure, logs it, and keeps the interval running', async () => {
    vi.useFakeTimers()
    // Explicit enable is required to run under a test runner.
    process.env.SHEETBASE_SCHEDULER_ENABLED = 'true'
    let attempt = 0
    const connect = vi.fn(async (): Promise<RetentionConnection> => {
      attempt += 1
      if (attempt === 1) throw new Error('database unavailable')
      return fakeConnection(2).conn
    })
    const log = silentLog()

    startDatasetRetentionScheduler({
      deps: { connect },
      intervalMs: 60_000,
      log,
    })

    await vi.advanceTimersByTimeAsync(5_000) // boot sweep: fails
    await vi.advanceTimersByTimeAsync(60_000) // next interval: succeeds

    expect(connect).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('dataset retention sweep failed', {
      error: 'database unavailable',
      durationMs: expect.any(Number),
    })
    expect(log.info).toHaveBeenCalledTimes(1)
    expect(log.info).toHaveBeenCalledWith('dataset retention sweep complete', {
      prunedCount: 2,
      durationMs: expect.any(Number),
    })
  })

  it('does not start under a test runner unless explicitly enabled', async () => {
    vi.useFakeTimers()
    const connect = vi.fn(async () => fakeConnection().conn)

    startDatasetRetentionScheduler({ deps: { connect }, intervalMs: 10 })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(connect).not.toHaveBeenCalled()
  })

  it('is disabled by SHEETBASE_SCHEDULER_ENABLED=false', async () => {
    vi.useFakeTimers()
    process.env.SHEETBASE_SCHEDULER_ENABLED = 'false'
    const connect = vi.fn(async () => fakeConnection().conn)

    startDatasetRetentionScheduler({
      deps: { connect },
      intervalMs: 10,
      log: silentLog(),
    })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(connect).not.toHaveBeenCalled()
  })
})
