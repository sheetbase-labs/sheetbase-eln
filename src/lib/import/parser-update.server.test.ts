// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { SessionAuthDeps } from '#/lib/request-auth'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
  process.env.POSTGREST_URL = 'http://postgrest.test'
})

const { handleParserUpdateRequest } = await import('./parser-update.server')

const rpcArgs = z.record(z.string(), z.json())

interface RpcCall {
  name: string
  args: z.infer<typeof rpcArgs>
  token: string | null
}

/** What the RPC answers next: a status and the response body PostgREST sends. */
interface RpcReply {
  status: number
  body: z.infer<ReturnType<typeof z.json>>
}

const rpcCalls: RpcCall[] = []
let rpcReply: RpcReply = { status: 200, body: null }

/** PostgREST, as the parser route reaches it: the compiled transport, not a stub. */
const fixtureFetch: typeof fetch = async (input, init) => {
  const sent = new Request(
    new URL(input instanceof Request ? input.url : input, 'http://localhost'),
    init,
  )

  const { pathname } = new URL(sent.url)

  if (sent.method === 'POST' && pathname.startsWith('/rpc/')) {
    rpcCalls.push({
      name: pathname.slice('/rpc/'.length),
      args: rpcArgs.parse(await sent.json()),
      token: sent.headers.get('authorization')?.replace(/^Bearer /, '') ?? null,
    })

    return Response.json(rpcReply.body, { status: rpcReply.status })
  }

  throw new Error(`Unexpected request: ${sent.method} ${pathname}`)
}

vi.stubGlobal('fetch', fixtureFetch)

const signedIn: SessionAuthDeps = {
  getSession: async () => ({
    user: { id: 'user-1' },
    session: { id: 'session-1' },
  }),
  getWorkspaceForUser: async () => ({ id: 'workspace-1' }),
  mintToken: async () => 'scoped-token',
}

const FILE = '00000000-0000-4000-8000-000000000456'

function request(extra = {}) {
  return new Request('http://app.invalid/api/parsers/request-update', {
    method: 'POST',
    body: JSON.stringify({ fileId: FILE, ...extra }),
  })
}

beforeEach(() => {
  rpcCalls.length = 0
  rpcReply = { status: 200, body: null }
})

it('does not accept client-selected recipients, failure state or resolution', async () => {
  for (const extra of [
    { recipientUserId: 'other' },
    { parser_failure: {} },
    { resolved: true },
  ]) {
    expect(
      (await handleParserUpdateRequest(request(extra), signedIn)).status,
    ).toBe(400)
  }

  expect(rpcCalls).toEqual([])
})

it('passes only retained identity through the claims-bound authority and requires confirmation', async () => {
  rpcReply = {
    status: 200,
    body: { id: FILE, parser_failure: { requestedAt: '2026-10-04T10:00:00Z' } },
  }
  expect(
    await (await handleParserUpdateRequest(request(), signedIn)).json(),
  ).toEqual({
    ok: true,
    fileId: FILE,
  })
  expect(rpcCalls).toEqual([
    {
      name: 'request_parser_update',
      args: { p_file_id: FILE },
      token: 'scoped-token',
    },
  ])
  rpcReply = {
    status: 200,
    body: { id: FILE, parser_failure: null },
  }
  expect((await handleParserUpdateRequest(request(), signedIn)).status).toBe(
    502,
  )
})

it('does not report request success for a missing or denied SQL operation', async () => {
  for (const status of [404, 403]) {
    rpcReply = { status, body: { message: 'Unavailable' } }
    expect((await handleParserUpdateRequest(request(), signedIn)).status).toBe(
      status,
    )
  }
})
