// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { channelBody } from './notification-channels'
import { computeBackoff, attemptDelivery } from './webhook-delivery'

// This suite exercises pure delivery helpers, but the module imports the
// server env for its live engine defaults. Mock the boundary so the file
// collects without process env (CI unit jobs carry no DATABASE_URL).
vi.mock('#/env.server', () => ({
  env: { DATABASE_URL: 'postgresql://localhost:5432/test' },
}))

vi.mock('./webhook-http.server', () => ({
  safeWebhookFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}))

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
  // Hermetic: global fetch is stubbed per test (the SSRF URL validator
  // still runs against the real URL string). example.com passes the
  // syntactic checks without any network or DNS.
  const HOOK = 'https://example.com/hook'

  it('succeeds on a 2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok', { status: 200 })),
    )
    try {
      const result = await attemptDelivery(
        HOOK,
        '{"test":true}',
        'sha256=abc',
        5000,
      )
      expect(result.success).toBe(true)
      expect(result.responseStatus).toBe(200)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('posts a Teams card, not the signed JSON, to a Teams destination', async () => {
    // PIPE-05's check: a run summary reaches a Teams channel. The destination's type decides
    // the body, so what arrives is a MessageCard the channel can render - posting the signed
    // JSON would be a 400 the engine could not tell from a transient failure.
    const seen: Array<{ url: string; body: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        seen.push({ url, body: init.body })
        return new Response('1', { status: 200 })
      }),
    )
    try {
      const body = channelBody('teams', {
        schemaVersion: '1',
        eventType: 'pipeline.run.completed',
        eventId: 'event-1',
        workspaceId: 'ws-1',
        runId: 'run-1',
        definitionVersionId: 'dv-1',
        result: { rowCount: 3, outputLabel: 'Turbidity results' },
      })
      const result = await attemptDelivery(HOOK, body, 'sha256=abc', 5000)
      expect(result.success).toBe(true)
      expect(seen[0].url).toBe(HOOK)
      const card = JSON.parse(seen[0].body)
      expect(card['@type']).toBe('MessageCard')
      expect(seen[0].body).toContain('run-1')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('fails on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('err', { status: 500 })),
    )
    try {
      const result = await attemptDelivery(
        HOOK,
        '{"test":true}',
        'sha256=abc',
        5000,
      )
      expect(result.success).toBe(false)
      expect(result.responseStatus).toBe(500)
      expect(result.errorCode).toBe('http_error')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('fails on an unreachable URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    try {
      const result = await attemptDelivery(
        HOOK,
        '{"test":true}',
        'sha256=abc',
        5000,
      )
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('delivery_error')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('times out on a slow endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init?: { signal?: AbortSignal }) => {
        // Executor form: tsconfig lib predates Promise.withResolvers (ES2024).
        const hanging = new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(
              new DOMException('The operation was aborted.', 'AbortError'),
            ),
          )
        })
        return hanging
      }),
    )
    try {
      const result = await attemptDelivery(
        HOOK,
        '{"test":true}',
        'sha256=abc',
        1000,
      )
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('timeout')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
