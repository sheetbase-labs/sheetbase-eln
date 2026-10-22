import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SandboxSession,
  SandboxUnavailableError,
  connectPipelineSandbox,
} from './pipeline-sandbox.server'
import type { SandboxConnection } from './pipeline-sandbox.server'

vi.mock('#/env.server', () => ({
  env: { PIPELINE_SANDBOX_DATABASE_URL: undefined },
}))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function hangingSandbox(): SandboxConnection & { queries: string[] } {
  const queries: string[] = []
  return {
    queries,
    backendPid: 4242,
    query: vi.fn(async (text: string) => {
      queries.push(text)
      if (text.startsWith('SET statement_timeout'))
        return { rows: [] as never[] }
      return new Promise<never>(() => {})
    }),
    end: vi.fn(async () => {}),
  }
}

describe('SandboxSession', () => {
  it('fails closed when the sandbox login is not configured', async () => {
    await expect(connectPipelineSandbox()).rejects.toBeInstanceOf(
      SandboxUnavailableError,
    )
  })

  it('terminates the backend from the trusted side when a statement outlives its budget', async () => {
    const conn = hangingSandbox()
    const terminate = vi.fn(async () => {})
    const session = new SandboxSession(async () => conn, terminate)
    void session.run('select pg_sleep(1000)', 60).catch(() => {})
    await vi.advanceTimersByTimeAsync(64_000)
    expect(terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(terminate).toHaveBeenCalledWith(4242)
    expect(conn.queries[0]).toBe("SET statement_timeout = '60s'")
  })

  it('does not terminate a statement that finished in time', async () => {
    const conn: SandboxConnection = {
      backendPid: 7,
      query: vi.fn(async () => ({ rows: [{ one: 1 }] })) as never,
      end: vi.fn(async () => {}),
    }
    const terminate = vi.fn(async () => {})
    const session = new SandboxSession(async () => conn, terminate)
    await expect(session.run('select 1 as one', 60)).resolves.toEqual({
      rows: [{ one: 1 }],
    })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(terminate).not.toHaveBeenCalled()
  })

  it('drops the session after a failed statement so the next step starts clean', async () => {
    const end = vi.fn(async () => {})
    let calls = 0
    const session = new SandboxSession(async () => ({
      backendPid: 1,
      query: async (text: string) => {
        if (text.startsWith('SET')) return { rows: [] }
        calls += 1
        throw new Error('boom')
      },
      end,
    }))
    await expect(session.run('select 1', 5)).rejects.toThrow('boom')
    expect(end).toHaveBeenCalledTimes(1)
    await expect(session.run('select 1', 5)).rejects.toThrow('boom')
    expect(calls).toBe(2)
  })
})
