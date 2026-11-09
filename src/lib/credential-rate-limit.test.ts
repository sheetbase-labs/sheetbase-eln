import { describe, expect, it } from 'vitest'

import { createCredentialRateLimiter } from './credential-rate-limit'

const MINUTE = 60_000

describe('credential rate limiter', () => {
  it('locks a prefix after five failures and unlocks after the lock', () => {
    const limiter = createCredentialRateLimiter()

    for (let i = 0; i < 4; i += 1) limiter.recordFailure('abcd1234', 0)
    expect(limiter.isLocked('abcd1234', 0)).toBe(false)
    limiter.recordFailure('abcd1234', 0)
    expect(limiter.isLocked('abcd1234', 14 * MINUTE)).toBe(true)
    expect(limiter.isLocked('abcd1234', 16 * MINUTE)).toBe(false)
  })

  it('clears a prefix on success', () => {
    const limiter = createCredentialRateLimiter()

    for (let i = 0; i < 5; i += 1) limiter.recordFailure('abcd1234', 0)
    limiter.clear('abcd1234')
    expect(limiter.isLocked('abcd1234', 0)).toBe(false)
  })

  it('keeps prefixes apart', () => {
    const limiter = createCredentialRateLimiter()

    for (let i = 0; i < 5; i += 1) limiter.recordFailure('aaaa0000', 0)
    expect(limiter.isLocked('bbbb1111', 0)).toBe(false)
  })

  it('sweeps out expired prefixes that never come back', () => {
    const limiter = createCredentialRateLimiter({ sweepAbove: 100 })

    for (let i = 0; i < 500; i += 1) limiter.recordFailure(`p${i}`, 0)
    expect(limiter.size()).toBe(500)
    // A failure after the window sweeps the expired entries out.
    limiter.recordFailure('fresh', 16 * MINUTE)
    expect(limiter.size()).toBe(1)
  })

  it('keeps locked and recent prefixes through a sweep', () => {
    const limiter = createCredentialRateLimiter({ sweepAbove: 10 })

    for (let i = 0; i < 5; i += 1) limiter.recordFailure('locked', 10 * MINUTE)

    for (let i = 0; i < 20; i += 1) limiter.recordFailure(`old${i}`, 0)
    limiter.recordFailure('recent', 14 * MINUTE)
    limiter.recordFailure('trigger', 16 * MINUTE)
    expect(limiter.isLocked('locked', 16 * MINUTE)).toBe(true)
    expect(limiter.size()).toBe(3)
  })

  it('sweeps at most once a minute while the store is large', () => {
    const limiter = createCredentialRateLimiter({ sweepAbove: 10 })

    for (let i = 0; i < 20; i += 1) limiter.recordFailure(`a${i}`, 0)
    limiter.recordFailure('b', 16 * MINUTE) // sweeps the a-entries
    expect(limiter.size()).toBe(1)

    // Entries already past their window, recorded with an earlier clock.
    for (let i = 0; i < 20; i += 1) limiter.recordFailure(`c${i}`, MINUTE)
    limiter.recordFailure('d', 16 * MINUTE + 30_000)
    expect(limiter.size()).toBe(22) // within the minute: no second sweep
    limiter.recordFailure('e', 17 * MINUTE + 1)
    expect(limiter.size()).toBe(3) // b, d and e remain
  })
})
