// @vitest-environment node
/**
 * What a plugin screen may do in the app: the plugin's own scopes, a person's
 * yes for a change, and the answer coming back.
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '../data-client'
import type { DataClient } from '../data-client'
import type { SessionAuthDeps } from '../request-auth'
import { checkAppAction } from './app-actions'
import type { ExtensionWire } from './client'
import { handlePluginHost, performHostCall } from './host-route.server'
import type { PluginHostRouteDeps } from './host-route.server'
import { parseExtensionManifest } from './manifest'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
})

const manifest = (scopes: string[]) => ({
  id: 'sheetbase.chemistry',
  name: 'Chemistry',
  version: '1.0.0',
  source: 'package:sheetbase.chemistry',
  capabilities: [],
  scopes,
  contributions: {},
})

/** One row of `api.extensions`, as the plugin host reads it. */
function installRow(
  scopes: string[],
  status: ExtensionWire['status'] = 'enabled',
): ExtensionWire {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: 'w',
    key: 'chemistry',
    name: 'Chemistry',
    version: '1.0.0',
    source: 'package:sheetbase.chemistry',
    manifest: parseExtensionManifest(manifest(scopes)),
    status,
    disabled_points: [],
    credential_id: null,
    created_at: '',
    updated_at: '',
  }
}

interface Fixture {
  installed: ExtensionWire | null
  calls: { name: string; args: z.infer<ReturnType<typeof z.json>> }[]
}

const fixtures: Fixture = { installed: null, calls: [] }

const rpcBody = z.record(z.string(), z.json())

/** The compiled transport a server-side plugin tool runs against. */
function fixtureClient(): DataClient {
  return createDataClient(async (input, init) => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : input, 'http://localhost'),
      init,
    )

    const { pathname } = new URL(request.url)

    if (request.method === 'GET' && pathname === '/api/db/extensions') {
      return Response.json(fixtures.installed ? [fixtures.installed] : [])
    }

    if (request.method === 'POST' && pathname.startsWith('/api/db/rpc/')) {
      fixtures.calls.push({
        name: pathname.slice('/api/db/rpc/'.length),
        args: rpcBody.parse(await request.json()),
      })

      return Response.json([{ id: 'lot-1' }])
    }

    throw new Error(`Unexpected request: ${request.method} ${pathname}`)
  })
}

const auth: SessionAuthDeps = {
  getSession: async () => ({ user: { id: 'u' }, session: { id: 's' } }),
  getWorkspaceForUser: async () => ({ id: 'w' }),
  mintToken: async () => 't',
}

function setup(scopes: string[], status: ExtensionWire['status'] = 'enabled') {
  fixtures.installed = installRow(scopes, status)
  const audit = vi.fn(async () => undefined)

  const deps: PluginHostRouteDeps = {
    auth,
    makeClient: () => fixtureClient(),
    runtime: { audit },
  }

  return { deps, audit }
}

const post = (body: NodeJS.Dict<unknown>) =>
  new Request('http://app/api/plugins/host', {
    method: 'POST',
    body: JSON.stringify({
      extensionKey: 'chemistry',
      point: 'panels',
      ...body,
    }),
  })

const COMPOUND = '22222222-2222-4222-8222-222222222222'

const listLots = {
  name: 'sheetbase.lab.act',
  arguments: {
    action: 'list_compound_lots',
    arguments: { p_compound_id: COMPOUND },
  },
}

const addLot = {
  name: 'sheetbase.lab.act',
  arguments: {
    action: 'add_compound_lot',
    arguments: { p_compound_id: COMPOUND },
  },
}

describe('checking an app action', () => {
  it.each([
    null,
    false,
    42,
    {},
    ['list_compound_lots'],
    '__proto__',
    'toString',
  ])('rejects malformed or inherited action names: %j', (action) => {
    expect(checkAppAction(action, { p_compound_id: COMPOUND })).toEqual({
      ok: false,
      message: 'That is not an action Sheetbase offers.',
    })
  })

  it.each([false, 42, [], { p_compound_id: false }])(
    'rejects malformed RPC arguments: %j',
    (argumentsValue) => {
      expect(
        checkAppAction('list_compound_lots', argumentsValue),
      ).toMatchObject({
        ok: false,
        message: expect.stringContaining(
          'Invalid arguments for list_compound_lots:',
        ),
      })
    },
  )

  it('knows reads from writes and refuses what Sheetbase does not offer', () => {
    const read = checkAppAction('list_compound_lots', {
      p_compound_id: COMPOUND,
    })

    expect(read.ok && read.writes).toBe(false)

    const write = checkAppAction('add_compound_lot', {
      p_compound_id: COMPOUND,
    })

    expect(write.ok && write.writes).toBe(true)
    expect(checkAppAction('drop_everything', {}).ok).toBe(false)
    expect(checkAppAction('list_compound_lots', {}).ok).toBe(false)
  })
})

describe('POST /api/plugins/host', () => {
  it.each([
    Infinity,
    NaN,
    undefined,
    1n,
    Symbol('not-json'),
    () => null,
    Object.fromEntries([['__proto__', Infinity]]),
  ])(
    'rejects non-JSON host-call arguments before calling tools: %s',
    async (value) => {
      fixtures.calls = []
      fixtures.installed = installRow(['lab:read'])
      const audit = vi.fn(async () => undefined)

      const outcome = await performHostCall(
        { runtime: { audit } },
        {
          workspaceId: 'w',
          userId: 'u',
          client: fixtureClient(),
          install: installRow(['lab:read']),
          point: 'panels',
          name: listLots.name,
          arguments: { ...listLots.arguments, nested: { value } },
          confirmed: false,
        },
      )

      expect(outcome).toEqual({
        ok: false,
        status: 400,
        code: 'invalid_arguments',
        message: 'The tool arguments must be a JSON object.',
      })
      expect(fixtures.calls).toHaveLength(0)
      expect(audit).not.toHaveBeenCalled()
    },
  )

  it('does not strip unknown JSON keys before strict action validation', async () => {
    fixtures.calls = []
    const { deps } = setup(['lab:read'])

    const response = await handlePluginHost(
      post({
        name: listLots.name,
        arguments: {
          action: listLots.arguments.action,
          arguments: {
            ...listLots.arguments.arguments,
            ...Object.fromEntries([['__proto__', {}]]),
          },
        },
      }),
      deps,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_arguments' },
    })
    expect(fixtures.calls).toHaveLength(0)
  })

  it('runs a read as the person and records it', async () => {
    fixtures.calls = []
    const { deps, audit } = setup(['lab:read', 'lab:write'])
    const response = await handlePluginHost(post(listLots), deps)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      result: [{ id: 'lot-1' }],
    })
    expect(fixtures.calls).toEqual([
      { name: 'list_compound_lots', args: { p_compound_id: COMPOUND } },
    ])
    expect(audit).toHaveBeenCalledOnce()
  })

  it('refuses a change the person was not asked about', async () => {
    fixtures.calls = []
    const { deps } = setup(['lab:read', 'lab:write'])
    const response = await handlePluginHost(post(addLot), deps)

    expect(response.status).toBe(409)
    expect(fixtures.calls).toHaveLength(0)
  })

  it('runs a confirmed change', async () => {
    fixtures.calls = []
    const { deps } = setup(['lab:read', 'lab:write'])

    const response = await handlePluginHost(
      post({ ...addLot, confirmed: true }),
      deps,
    )

    expect(response.status).toBe(200)
    expect(fixtures.calls).toEqual([
      { name: 'add_compound_lot', args: { p_compound_id: COMPOUND } },
    ])
  })

  it('refuses what the plugin never asked for', async () => {
    fixtures.calls = []
    const { deps } = setup(['lab:read'])

    const response = await handlePluginHost(
      post({ ...addLot, confirmed: true }),
      deps,
    )

    expect(response.status).toBe(403)
    expect(fixtures.calls).toHaveLength(0)
  })

  it('does nothing while the plugin is off', async () => {
    fixtures.calls = []
    const { deps } = setup(['lab:read'], 'disabled')
    const response = await handlePluginHost(post(listLots), deps)

    expect(response.status).toBe(409)
    expect(fixtures.calls).toHaveLength(0)
  })
})
