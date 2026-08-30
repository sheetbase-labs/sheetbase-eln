// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { computeBackoff, attemptDelivery } from './webhook-delivery'

describe('computeBackoff', () => {
  it('returns a positive number for attempt 0', () => {
    const delay = computeBackoff(0, 1000, 300_000, 0)
    expect(delay).toBe(1000) // no jitter when jitter=0
  })

  it('increases exponentially', () => {
    const d0 = computeBackoff(0, 1000, 300_000, 0)
    const d1 = computeBackoff(1, 1000, 300_000, 0)
    const d2 = computeBackoff(2, 1000, 300_000, 0)
    expect(d1).toBeGreaterThan(d0)
    expect(d2).toBeGreaterThan(d1)
  })

  it('caps at maxMs', () => {
    const delay = computeBackoff(20, 1000, 5000, 0)
    expect(delay).toBe(5000)
  })

  it('is never negative', () => {
    for (let i = 0; i < 10; i++) {
      const delay = computeBackoff(i, 1000, 300_000, 0.5)
      expect(delay).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('attemptDelivery', () => {
  it('succeeds on a 2xx response', async () => {
    // Use a data URL that will fail with a fetch error (not 2xx).
    // We can't easily mock fetch in this environment, so test the error path.
    const result = await attemptDelivery(
      'https://httpstat.us/200',
      '{"test":true}',
      'sha256=abc',
      5000,
    )
    // This should succeed since httpstat.us/200 returns 200
    expect(result.success).toBe(true)
    expect(result.responseStatus).toBe(200)
  })

  it('fails on a non-2xx response', async () => {
    const result = await attemptDelivery(
      'https://httpstat.us/500',
      '{"test":true}',
      'sha256=abc',
      5000,
    )
    expect(result.success).toBe(false)
    expect(result.responseStatus).toBe(500)
    expect(result.errorCode).toBe('http_error')
  })

  it('fails on an unreachable URL', async () => {
    const result = await attemptDelivery(
      'https://nonexistent.invalid.example.test',
      '{"test":true}',
      'sha256=abc',
      5000,
    )
    expect(result.success).toBe(false)
    expect(result.errorCode).toBeTruthy()
  })

  it('times out on a slow endpoint', async () => {
    const result = await attemptDelivery(
      'https://httpstat.us/200?sleep=6000',
      '{"test":true}',
      'sha256=abc',
      1000,
    )
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('timeout')
  }, 10000)
})
