import { describe, expect, it } from 'vitest'

import { DataClientError } from '#/lib/data-client'

import { shouldRetryQuery } from './router-context'

describe('shouldRetryQuery', () => {
  it('does not retry a request the server refused', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(
        shouldRetryQuery(0, new DataClientError('x', 'refused', status)),
      ).toBe(false)
    }
  })

  it('retries timeouts, rate limits and server failures up to three times', () => {
    for (const status of [408, 429, 500, 502, 503]) {
      const error = new DataClientError('x', 'failed', status)
      expect(shouldRetryQuery(0, error)).toBe(true)
      expect(shouldRetryQuery(2, error)).toBe(true)
      expect(shouldRetryQuery(3, error)).toBe(false)
    }
  })

  it('retries a network failure', () => {
    expect(shouldRetryQuery(1, new TypeError('Failed to fetch'))).toBe(true)
  })
})
