// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBackgroundSweep } from './background-sweep.server'

const sweep = createBackgroundSweep('background-sweep-test')

afterEach(() => {
  sweep.stop()
})

describe('background sweep', () => {
  it('stays off under a test runner unless it is switched on', () => {
    vi.useFakeTimers()

    const tick = vi.fn(() => Promise.resolve())
    sweep.start(tick, 1_000)
    vi.advanceTimersByTime(10_000)

    expect(tick).not.toHaveBeenCalled()
  })

  it('runs shortly after boot and then on the interval, once per process', () => {
    vi.stubEnv('SHEETBASE_SCHEDULER_ENABLED', 'true')
    vi.useFakeTimers()

    const tick = vi.fn(() => Promise.resolve())
    sweep.start(tick, 60_000)
    sweep.start(tick, 60_000)
    vi.advanceTimersByTime(5_000)

    expect(tick).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60_000)

    expect(tick).toHaveBeenCalledTimes(2)
  })

  it('can start again once stopped', () => {
    vi.stubEnv('SHEETBASE_SCHEDULER_ENABLED', 'true')
    vi.useFakeTimers()

    const tick = vi.fn(() => Promise.resolve())
    sweep.start(tick, 60_000)
    sweep.stop()
    sweep.start(tick, 60_000)
    vi.advanceTimersByTime(5_000)

    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('never runs when switched off, even outside tests', () => {
    vi.stubEnv('SHEETBASE_SCHEDULER_ENABLED', 'false')
    vi.useFakeTimers()

    const tick = vi.fn(() => Promise.resolve())
    sweep.start(tick, 1_000)
    vi.advanceTimersByTime(10_000)

    expect(tick).not.toHaveBeenCalled()
  })
})
