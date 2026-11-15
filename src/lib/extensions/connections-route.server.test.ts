// @vitest-environment node
/**
 * GET/POST /api/plugins/connections for an operation's settings: listed under
 * the `operations` point, set under scope `operations:<id>`, secrets never read back.
 */
import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'
import type { SessionAuthDeps } from '../request-auth'
import type { PluginConnectionsRouteDeps } from './connections-route.server'
import { buildPluginPackage } from './package'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
  process.env.POSTGREST_URL = 'http://postgrest.test'
})

const { handlePluginConnections } = await import('./connections-route.server')

const files = {
  'plugin.json': JSON.stringify({
    id: 'acme.lookup',
    name: 'Lookup',
    version: '1.0.0',
    description: 'Looks things up.',
    provides: {
      operations: [
        {
          id: 'search',
          title: 'Search',
          description: 'Searches.',
          access: 'read',
          inputs: [{ name: 'query', type: 'text', required: true }],
          outputs: [{ name: 'found', type: 'text', required: true }],
          settings: [
            { name: 'token', label: 'Token', secret: true, required: true },
          ],
          run: 'ops:search',
        },
      ],
    },
  }),
  'python/ops.py': 'def search(input):\n    return {"found": "x"}\n',
}

const EXT = '11111111-1111-4111-8111-111111111111'

const signedIn: SessionAuthDeps = {
  getSession: async () => ({ user: { id: 'u1' }, session: { id: 's1' } }),
  getWorkspaceForUser: async () => ({ id: 'w1' }),
  mintToken: async () => 'token',
}

const unused = async (): Promise<never> => {
  throw new Error('not used by this route')
}

/** A data client that answers the one list and the one capability check the route makes. */
const dataClient: DataClient = {
  // SAFETY: the route lists `extensions` and nothing else, so the rows are the install row below whatever T the caller names.
  list: async <T>() =>
    [
      {
        id: EXT,
        key: 'lookup',
        name: 'Lookup',
        disabled_points: [],
        manifest: buildPluginPackage(files).manifest,
      },
    ] as T[],
  // SAFETY: the route only checks that the capability call does not throw.
  rpc: async <T>() => ({}) as T,
  count: unused,
  insert: unused,
  patch: unused,
  remove: unused,
}

function deps(
  stored: Array<{
    scope: string
    name: string
    value: string
    secret: boolean
  }> = [],
) {
  const save = vi.fn(async () => undefined)
  const audit = vi.fn(async () => undefined)

  const route: PluginConnectionsRouteDeps = {
    auth: signedIn,
    makeClient: () => dataClient,
    store: { list: async () => stored, save },
    audit,
  }

  return { route, save, audit }
}

describe('plugin connections for operations', () => {
  it('lists an operation that asks for settings, with no secret value', async () => {
    const { route } = deps([
      {
        scope: 'operations:search',
        name: 'token',
        value: 'sealed',
        secret: true,
      },
    ])

    const res = await handlePluginConnections(
      new Request('http://x/api/plugins/connections'),
      route,
    )

    const body: { connections: unknown[] } = await res.json()
    expect(body.connections).toHaveLength(1)
    expect(body.connections[0]).toMatchObject({
      point: 'operations',
      itemId: 'search',
      hosts: [],
      settings: [{ name: 'token', secret: true, isSet: true, value: null }],
    })
    expect(JSON.stringify(body)).not.toContain('sealed')
  })

  it('saves under the operations scope and audits names only', async () => {
    const { route, save, audit } = deps()

    const res = await handlePluginConnections(
      new Request('http://x/api/plugins/connections', {
        method: 'POST',
        body: JSON.stringify({
          extensionId: EXT,
          point: 'operations',
          itemId: 'search',
          values: { token: 'sekret-token' },
        }),
      }),
      route,
    )

    expect(res.status).toBe(200)
    expect(save).toHaveBeenCalledWith(
      'w1',
      EXT,
      'operations:search',
      [{ name: 'token', value: 'sekret-token', secret: true }],
      'u1',
    )
    expect(JSON.stringify(audit.mock.calls)).not.toContain('sekret-token')
  })

  it('refuses a setting the operation does not declare', async () => {
    const { route, save } = deps()

    const res = await handlePluginConnections(
      new Request('http://x/api/plugins/connections', {
        method: 'POST',
        body: JSON.stringify({
          extensionId: EXT,
          point: 'operations',
          itemId: 'search',
          values: { other: 'x' },
        }),
      }),
      route,
    )

    expect(res.status).toBe(400)
    expect(save).not.toHaveBeenCalled()
  })
})
