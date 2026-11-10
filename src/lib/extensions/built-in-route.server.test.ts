/**
 * POST /api/plugins/built-in installs the plugins that ship with Sheetbase.
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '../data-client'
import type { SessionAuthDeps } from '../request-auth'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
  process.env.POSTGREST_URL = 'http://postgrest.test'
})

const { handleBuiltInPlugins } = await import('./built-in-route.server')

const signedIn: SessionAuthDeps = {
  getSession: async () => ({
    user: { id: 'u' },
    session: { id: 'session-1' },
  }),
  getWorkspaceForUser: async () => ({ id: 'w' }),
  mintToken: async () => 't',
}

const bodySchema = z.object({ plugins: z.array(z.object({ key: z.string() })) })

/**
 * The PostgREST boundary the route reaches: a real data client over one
 * recorded reply, so the capability check is the request it really makes.
 */
function rpcBoundary(reply: Response) {
  const calls: Array<{ name: string; args: unknown }> = []

  const client = createDataClient(async (input, init) => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : input, 'http://app.test'),
      init,
    )

    calls.push({
      name: request.url.replace('http://app.test/api/db/rpc/', ''),
      args: await request.json(),
    })

    return reply.clone()
  })

  return { client, calls }
}

const post = () =>
  new Request('http://x/api/plugins/built-in', { method: 'POST' })

describe('POST /api/plugins/built-in', () => {
  it('installs the built-in plugins and says what happened', async () => {
    const { client, calls } = rpcBoundary(Response.json({}))

    const response = await handleBuiltInPlugins(post(), {
      auth: signedIn,
      makeClient: () => client,
      ensureBuiltIn: async () => [{ key: 'chemistry', action: 'installed' }],
    })

    const body = bodySchema.parse(await response.json())

    expect(body.plugins).toHaveLength(1)
    expect(calls).toEqual([
      {
        name: 'require_capability',
        args: { p_workspace_id: 'w', p_capability: 'extensions.manage' },
      },
    ])
  })

  it('refuses someone who cannot manage plugins', async () => {
    const { client } = rpcBoundary(
      Response.json({ message: 'not permitted' }, { status: 403 }),
    )

    const response = await handleBuiltInPlugins(post(), {
      auth: signedIn,
      makeClient: () => client,
      ensureBuiltIn: async () => [{ key: 'chemistry', action: 'installed' }],
    })

    expect(response.status).toBe(403)
  })
})
