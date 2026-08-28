import { describe, expect, it } from 'vitest'

import {
  createRateLimiter,
  defaultRateLimitOptions,
} from './rate-limit'

describe('fixed-window rate limiter', () => {
  it('allows up to the cap inside one window', () => {
    const limiter = createRateLimiter({ maxRequests: 3, windowSeconds: 60 })
    const t = 1_000_000
    expect(limiter.hit('k', t).allowed).toBe(true)
    expect(limiter.hit('k', t).allowed).toBe(true)
    expect(limiter.hit('k', t).allowed).toBe(true)
    const blocked = limiter.hit('k', t)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('resets on the next window', () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowSeconds: 60 })
    const t = 1_000_000
    expect(limiter.hit('k', t).allowed).toBe(true)
    expect(limiter.hit('k', t).allowed).toBe(false)
    // 60 s later: a new window.
    expect(limiter.hit('k', t + 61_000).allowed).toBe(true)
  })

  it('keys principals independently', () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowSeconds: 60 })
    const t = 1_000_000
    expect(limiter.hit('a', t).allowed).toBe(true)
    expect(limiter.hit('a', t).allowed).toBe(false)
    expect(limiter.hit('b', t).allowed).toBe(true)
  })
})

describe('defaultRateLimitOptions', () => {
  it('falls back to safe defaults for missing or invalid values', () => {
    expect(defaultRateLimitOptions({})).toEqual({
      maxRequests: 600,
      windowSeconds: 60,
    })
    expect(
      defaultRateLimitOptions({
        SHEETBASE_RATE_LIMIT_MAX: 0,
        SHEETBASE_RATE_LIMIT_WINDOW_SECONDS: -5,
      }),
    ).toEqual({ maxRequests: 0, windowSeconds: -5 })
  })
})
