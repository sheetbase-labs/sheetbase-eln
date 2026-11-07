import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { DataClientError, createDataClient } from '#/lib/data-client'

import { refreshAfterWrites, shouldRetryQuery } from './router-context'

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

describe('refreshAfterWrites', () => {
  it('marks other caches stale after a write, but leaves editing caches alone', async () => {
    vi.useFakeTimers()
    const qc = new QueryClient()
    qc.setQueryData(['ui-port', 'experiments', 'w'], [1])
    qc.setQueryData(['work-items'], [1])
    qc.setQueryData(['notebook', 'blocks', 'r'], [1])
    qc.setQueryData(['sheet-instance', 'i'], [1])
    const stop = refreshAfterWrites(qc, 50, 0)
    const rows = createDataClient(
      async () => new Response('[]', { status: 200 }),
    )
    await rows.patch('records', 'id=eq.1', { title: 'x' })
    await vi.advanceTimersByTimeAsync(60)
    expect(
      qc.getQueryState(['ui-port', 'experiments', 'w'])?.isInvalidated,
    ).toBe(true)
    expect(qc.getQueryState(['work-items'])?.isInvalidated).toBe(true)
    expect(qc.getQueryState(['notebook', 'blocks', 'r'])?.isInvalidated).toBe(
      false,
    )
    expect(qc.getQueryState(['sheet-instance', 'i'])?.isInvalidated).toBe(false)
    stop()
    vi.useRealTimers()
  })

  it('asks the shell to reload counts after a write, but not after a notebook save', async () => {
    vi.useFakeTimers()
    const qc = new QueryClient()
    const heard = vi.fn()
    window.addEventListener('sheetbase:shell-refresh', heard)
    const stop = refreshAfterWrites(qc, 50, 0)
    const rows = createDataClient(
      async () => new Response('[]', { status: 200 }),
    )
    await rows.patch('blocks', 'id=eq.1', { content: 'x' })
    await vi.advanceTimersByTimeAsync(60)
    expect(heard).not.toHaveBeenCalled()
    await rows.patch('records', 'id=eq.1', { title: 'x' })
    await vi.advanceTimersByTimeAsync(60)
    expect(heard).toHaveBeenCalledTimes(1)
    stop()
    window.removeEventListener('sheetbase:shell-refresh', heard)
    vi.useRealTimers()
  })
})
