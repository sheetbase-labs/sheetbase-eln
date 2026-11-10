// @vitest-environment node
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import type { ChannelConnection } from './channel-delivery.server'

vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:1/test')

vi.stubEnv('FORMULA_DATABASE_URL', 'postgresql://test:test@localhost:1/test')

vi.stubEnv('BETTER_AUTH_SECRET', 'extension-unit-test-secret-not-for-use')

vi.stubEnv('PGRST_JWT_SECRET', 'extension-unit-test-token-not-for-use')

const { startChannelScheduler, stopChannelScheduler } =
  await import('./channel-delivery.server')

afterEach(() => {
  stopChannelScheduler()
  vi.useRealTimers()
})

afterAll(() => vi.unstubAllEnvs())

describe('channel scheduler lifecycle', () => {
  it('starts only once and can start again after shutdown', async () => {
    vi.useFakeTimers()
    vi.stubEnv('SHEETBASE_SCHEDULER_ENABLED', 'true')

    const connection: ChannelConnection = {
      query: async () => ({ rows: [] }),
      end: async () => undefined,
    }

    const connect = vi.fn(async () => connection)

    const options = {
      deps: { connect, baseUrl: 'https://app.example' },
      intervalMs: 15_000,
    }

    startChannelScheduler(options)
    startChannelScheduler(options)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(connect).toHaveBeenCalledTimes(1)
    stopChannelScheduler()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(connect).toHaveBeenCalledTimes(1)
    startChannelScheduler(options)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(connect).toHaveBeenCalledTimes(2)
  })
})
