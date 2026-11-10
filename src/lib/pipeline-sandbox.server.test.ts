// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'

import {
  SandboxSession,
  SandboxUnavailableError,
  connectPipelineSandbox,
} from './pipeline-sandbox.server'
import type { SandboxConnection } from './pipeline-sandbox.server'

// The deployment environment is validated when `env.server` is first imported.
// No sandbox login is configured here, which is what the first test is about.
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://app:app@localhost:5432/sheetbase'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://app:app@localhost:5432/sheetbase'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
  delete process.env.PIPELINE_SANDBOX_DATABASE_URL
})

// SAFETY: each fake below answers exactly the statements its test makes, and the
// rows it returns are the columns those statements select.
const rowsOf = <T extends QueryResultRow>(rows: QueryResultRow[]): T[] =>
  rows as T[]

beforeEach(() => vi.useFakeTimers())

afterEach(() => vi.useRealTimers())

function hangingSandbox(): SandboxConnection & { queries: string[] } {
  const queries: string[] = []

  return {
    queries,
    backendPid: 4242,
    query: async <T extends QueryResultRow>(text: string) => {
      queries.push(text)

      if (text.startsWith('SET statement_timeout'))
        return { rows: rowsOf<T>([]) }

      return new Promise<never>(() => {})
    },
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
      query: async <T extends QueryResultRow>() => ({
        rows: rowsOf<T>([{ one: 1 }]),
      }),
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
      query: async <T extends QueryResultRow>(text: string) => {
        if (text.startsWith('SET')) return { rows: rowsOf<T>([]) }
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
