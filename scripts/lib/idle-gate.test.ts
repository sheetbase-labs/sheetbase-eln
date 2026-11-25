import { describe, expect, it } from 'vitest'

import {
  createIdleGate,
  gateIntervals,
  idleAfterMsFromEnv,
} from './idle-gate.mjs'

describe('idle gate', () => {
  it('goes idle after the window and wakes on a touch', () => {
    let clock = 0
    const gate = createIdleGate({ idleAfterMs: 1000, now: () => clock })

    expect(gate.isIdle()).toBe(false)
    clock = 1000
    expect(gate.isIdle()).toBe(true)
    gate.touch()
    expect(gate.isIdle()).toBe(false)
  })

  it('stays busy while a long-lived connection is open', () => {
    let clock = 0
    const gate = createIdleGate({ idleAfterMs: 1000, now: () => clock })
    const release = gate.hold()

    clock = 5000
    expect(gate.isIdle()).toBe(false)
    release()
    release()
    clock = 5999
    expect(gate.isIdle()).toBe(false)
    clock = 6000
    expect(gate.isIdle()).toBe(true)
  })

  it('reads the window from the environment', () => {
    expect(idleAfterMsFromEnv({})).toBeNull()
    expect(idleAfterMsFromEnv({ SHEETBASE_IDLE_AFTER_MS: '0' })).toBeNull()
    expect(idleAfterMsFromEnv({ SHEETBASE_IDLE_AFTER_MS: 'x' })).toBeNull()
    expect(idleAfterMsFromEnv({ SHEETBASE_IDLE_AFTER_MS: '300000' })).toBe(
      300000,
    )
  })

  it('skips interval ticks only while idle', () => {
    const ticks: Array<() => void> = []

    const target = {
      setInterval: (callback: () => void) => {
        ticks.push(callback)

        return 0
      },
    }

    let clock = 0
    const gate = createIdleGate({ idleAfterMs: 1000, now: () => clock })
    const restore = gateIntervals(gate, target)
    let runs = 0

    target.setInterval(() => {
      runs += 1
    })
    ticks[0]()
    expect(runs).toBe(1)
    clock = 2000
    ticks[0]()
    expect(runs).toBe(1)
    gate.touch()
    ticks[0]()
    expect(runs).toBe(2)
    restore()
  })
})
