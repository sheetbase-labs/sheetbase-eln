import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { handleBatchRequest } from './postgrest-batch'
import type { ProxyDeps } from './postgrest-proxy'
import { BATCH_MAX_READS } from './read-batch'

function makeDeps(overrides: Partial<ProxyDeps> = {}) {
  const getSession = vi.fn(async (_headers: Headers) => ({
    user: { id: 'user-1' },
    session: { id: 'session-1' },
  }))

  const getWorkspaceForUser = vi.fn(async () => ({ id: 'workspace-1' }))
  const mintToken = vi.fn(async () => 'minted-jwt')

  const fetchFn = vi.fn<typeof fetch>(
    async (input) =>
      new Response(JSON.stringify([{ url: String(input) }]), {
        status: 200,
        headers: { 'content-range': '0-0/7' },
      }),
  )

  const deps: ProxyDeps = {
    getSession,
    getWorkspaceForUser,
    mintToken,
    upstreamBaseUrl: 'http://upstream:3001',
    fetchFn,
    ...overrides,
  }

  return { deps, getSession, getWorkspaceForUser, mintToken, fetchFn }
}

function batch(
  reads: unknown[],
  headers: Record<string, string> = { cookie: 'session=1' },
): Request {
  return new Request('http://localhost:3000/api/db-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ reads }),
  })
}

const answers = z.object({
  results: z.array(
    z.object({
      status: z.number(),
      body: z.string(),
      contentRange: z.string().nullable(),
    }),
  ),
})

async function resultsOf(response: Response) {
  return answers.parse(await response.json()).results
}

const read = (path: string) => ({ path, method: 'GET', headers: {} })

describe('handleBatchRequest', () => {
  it('answers each read through the proxy, in order, with its own status', async () => {
    const { deps, fetchFn } = makeDeps()

    const response = await handleBatchRequest(
      batch([read('/records?id=eq.1'), read('/projects?id=eq.2')]),
      deps,
    )

    const results = await resultsOf(response)

    expect(results.map((result) => result.status)).toEqual([200, 200])
    expect(results[0]?.body).toContain('/records?id=eq.1')
    expect(results[1]?.body).toContain('/projects?id=eq.2')
    expect(results[0]?.contentRange).toBe('0-0/7')

    // Every read runs against PostgREST as the signed in person's own token.
    for (const [, init] of fetchFn.mock.calls)
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer minted-jwt',
      )
  })

  it('looks the person up once for the whole batch', async () => {
    const { deps, getSession, getWorkspaceForUser, mintToken } = makeDeps()

    await handleBatchRequest(
      batch([read('/records'), read('/projects'), read('/record_links')]),
      deps,
    )

    expect(getSession).toHaveBeenCalledTimes(1)
    expect(getWorkspaceForUser).toHaveBeenCalledTimes(1)
    expect(mintToken).toHaveBeenCalledTimes(1)
  })

  it('passes the cookie on, so the person is the one who is signed in', async () => {
    const { deps, getSession } = makeDeps()

    await handleBatchRequest(batch([read('/records')]), deps)

    expect(getSession.mock.calls[0]?.[0].get('cookie')).toBe('session=1')
  })

  it('gives a signed-out batch a 401 for every read, without reaching PostgREST', async () => {
    const { deps, fetchFn } = makeDeps({ getSession: async () => null })

    const response = await handleBatchRequest(
      batch([read('/records'), read('/projects')]),
      deps,
    )

    const results = await resultsOf(response)

    expect(results.map((result) => result.status)).toEqual([401, 401])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('runs a stable function and refuses one that writes', async () => {
    const { deps, fetchFn } = makeDeps()

    const response = await handleBatchRequest(
      batch([
        { path: '/rpc/record_series', method: 'POST', headers: {}, body: '{}' },
        { path: '/rpc/create_experiment', method: 'POST', headers: {} },
        { path: '/records', method: 'POST', headers: {}, body: '{}' },
      ]),
      deps,
    )

    const results = await resultsOf(response)

    expect(results.map((result) => result.status)).toEqual([200, 400, 400])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('refuses a read that tries to leave the data proxy', async () => {
    const { deps, fetchFn } = makeDeps()

    const response = await handleBatchRequest(
      batch([read('/../internal.user'), read('/records/../../x')]),
      deps,
    )

    const results = await resultsOf(response)

    expect(results.every((result) => result.status === 400)).toBe(true)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a batch that arrives with an API token', async () => {
    const { deps } = makeDeps()

    const response = await handleBatchRequest(
      batch([read('/records')], { authorization: 'Bearer token' }),
      deps,
    )

    expect(response.status).toBe(401)
  })

  it('refuses a body that is not a list of reads, or a list that is too long', async () => {
    const { deps } = makeDeps()

    const notReads = await handleBatchRequest(batch([{ nope: true }]), deps)
    const empty = await handleBatchRequest(batch([]), deps)

    const tooMany = await handleBatchRequest(
      batch(
        Array.from({ length: BATCH_MAX_READS + 1 }, () => read('/records')),
      ),
      deps,
    )

    expect([notReads.status, empty.status, tooMany.status]).toEqual([
      400, 400, 400,
    ])
  })
})
