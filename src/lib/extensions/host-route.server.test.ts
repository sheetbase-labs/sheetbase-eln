/**
 * What a plugin screen may do in the app: the plugin's own scopes, a person's
 * yes for a change, and the answer coming back.
 */
import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'

import { checkAppAction } from './app-actions'
import { handlePluginHost } from './host-route.server'
import type { PluginHostRouteDeps } from './host-route.server'

vi.mock('../request-auth', () => ({
  realSessionAuthDeps: {},
  requestErrorResponse: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  resolveSessionAuth: async () => ({
    ok: true,
    context: { token: 't', workspaceId: 'w', userId: 'u' },
  }),
}))
vi.mock('../connectors/enterprise/execution.server', () => ({
  createServerDataClient: () => ({}),
}))

const manifest = (scopes: string[]) => ({
  id: 'sheetbase.chemistry',
  name: 'Chemistry',
  version: '1.0.0',
  source: 'package:sheetbase.chemistry',
  capabilities: [],
  scopes,
  contributions: {},
})

let installed: Record<string, unknown> | null = null
vi.mock('./client', () => ({
  listExtensions: async () => (installed ? [installed] : []),
}))

function setup(scopes: string[], status = 'enabled') {
  installed = {
    id: '11111111-1111-4111-8111-111111111111',
    key: 'chemistry',
    status,
    disabled_points: [],
    manifest: manifest(scopes),
  }
  const rpc = vi.fn(async () => [{ id: 'lot-1' }])
  const audit = vi.fn(async () => undefined)
  const deps = {
    auth: {},
    makeClient: () => ({ rpc }) as unknown as DataClient,
    runtime: { audit },
  } as unknown as PluginHostRouteDeps
  return { deps, rpc, audit }
}

const post = (body: Record<string, unknown>) =>
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
  it('runs a read as the person and records it', async () => {
    const { deps, rpc, audit } = setup(['lab:read', 'lab:write'])
    const response = await handlePluginHost(post(listLots), deps)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      result: [{ id: 'lot-1' }],
    })
    expect(rpc).toHaveBeenCalledWith('list_compound_lots', {
      p_compound_id: COMPOUND,
    })
    expect(audit).toHaveBeenCalledOnce()
  })

  it('refuses a change the person was not asked about', async () => {
    const { deps, rpc } = setup(['lab:read', 'lab:write'])
    const response = await handlePluginHost(post(addLot), deps)
    expect(response.status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('runs a confirmed change', async () => {
    const { deps, rpc } = setup(['lab:read', 'lab:write'])
    const response = await handlePluginHost(
      post({ ...addLot, confirmed: true }),
      deps,
    )
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('add_compound_lot', {
      p_compound_id: COMPOUND,
    })
  })

  it('refuses what the plugin never asked for', async () => {
    const { deps, rpc } = setup(['lab:read'])
    const response = await handlePluginHost(
      post({ ...addLot, confirmed: true }),
      deps,
    )
    expect(response.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does nothing while the plugin is off', async () => {
    const { deps, rpc } = setup(['lab:read'], 'disabled')
    const response = await handlePluginHost(post(listLots), deps)
    expect(response.status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
  })
})
