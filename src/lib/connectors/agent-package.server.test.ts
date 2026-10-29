import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'
import type { SessionAuthDeps } from '../request-auth'
import { handleAgentPackage } from './agent-package.server'
import type { AgentPackageDeps } from './agent-package.server'

// The real module opens the database; a session check against the fake deps is
// all these tests need.
vi.mock('../request-auth', () => ({
  realSessionAuthDeps: {},
  requestErrorResponse: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  resolveSessionAuth: async (headers: Headers, deps: SessionAuthDeps) => {
    const session = await deps.getSession(headers)
    if (!session) {
      return { ok: false, status: 401, code: 'unauthenticated', message: '' }
    }
    const workspace = await deps.getWorkspaceForUser(session.user.id)
    return {
      ok: true,
      context: {
        userId: session.user.id,
        workspaceId: workspace!.id,
        sessionId: session.session.id,
        token: 'jwt',
      },
    }
  },
}))

const WS = '11111111-1111-4111-8111-111111111111'
const CONNECTOR = '55555555-5555-4555-8555-555555555555'
const NOW = new Date('2026-10-29T12:00:00Z')

function connector(overrides: Record<string, unknown> = {}) {
  return {
    id: CONNECTOR,
    key: 'qpcr-bench',
    name: 'qPCR bench',
    connector_type: 'instrument',
    config: { pickup: { projectId: 'p', schemaVersionId: 's' } },
    ...overrides,
  }
}

function setup(options: {
  signedIn?: boolean
  connector?: Record<string, unknown> | null
  existing?: Array<Record<string, unknown>>
  denied?: boolean
}) {
  const revoked: string[] = []
  const created: Array<Record<string, unknown>> = []
  const audit = vi.fn(async () => {})
  const client = {
    list: async <T>() =>
      (options.connector === null ? [] : [connector(options.connector)]) as T[],
    rpc: async () => {
      if (options.denied) throw new Error('capability required')
      return {}
    },
  } as unknown as DataClient
  const deps: AgentPackageDeps = {
    getSession: async () =>
      options.signedIn === false
        ? null
        : { user: { id: 'user-1' }, session: { id: 'session-1' } },
    getWorkspaceForUser: async () => ({ id: WS }),
    mintToken: async () => 'jwt',
    loadDb: async () =>
      ({
        transaction: async (fn: (tx: unknown) => unknown) => fn({}),
      }) as never,
    loadCredentials: async () => ({
      listCredentials: async () => (options.existing ?? []) as never,
      revokeCredential: async (_db, input) => {
        revoked.push(input.credentialId)
      },
      createCredential: async (_db, input) => {
        created.push(input)
        return {
          id: 'new-cred',
          secret: 'sbk_fresh',
          displayPrefix: 'sbk_fresh',
          name: input.name,
          scopes: [...input.scopes],
          kind: 'personal',
        } as never
      },
    }),
    agentSource: async () => '// the agent',
    createClient: () => client,
    emitAudit: audit,
    now: () => NOW,
  }
  return { deps, revoked, created, audit }
}

const post = (body: unknown) =>
  new Request('https://eln.example.com/api/connectors/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const get = (id = CONNECTOR) =>
  new Request(`https://eln.example.com/api/connectors/agent?connector=${id}`)

describe('agent download', () => {
  it('returns a zip with the settings filled in and a new token', async () => {
    const { deps, created } = setup({})
    const response = await handleAgentPackage(
      post({
        connectorId: CONNECTOR,
        system: 'windows',
        folder: 'C:\\Results',
      }),
      deps,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toContain(
      'sheetbase-agent-qpcr-bench.zip',
    )
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual([
      'sheetbase-agent/README.txt',
      'sheetbase-agent/Start Sheetbase agent.bat',
      'sheetbase-agent/instrument-agent.mjs',
      'sheetbase-agent/sheetbase-agent.json',
    ])
    expect(
      JSON.parse(strFromU8(files['sheetbase-agent/sheetbase-agent.json'])),
    ).toEqual({
      url: 'https://eln.example.com',
      connector: 'qpcr-bench',
      dir: 'C:\\Results',
      credential: 'sbk_fresh',
    })
    expect(created[0]).toMatchObject({
      name: 'Folder agent · qpcr-bench',
      kind: 'personal',
      scopes: ['files:write', 'datasets:write'],
    })
  })

  it('replaces an earlier token so an old copy stops working', async () => {
    const { deps, revoked, audit } = setup({
      existing: [
        { id: 'old-1', name: 'Folder agent · qpcr-bench', revokedAt: null },
        { id: 'other', name: 'Folder agent · other', revokedAt: null },
        {
          id: 'gone',
          name: 'Folder agent · qpcr-bench',
          revokedAt: new Date(),
        },
      ],
    })
    await handleAgentPackage(
      post({ connectorId: CONNECTOR, system: 'linux', folder: '/data' }),
      deps,
    )
    expect(revoked).toEqual(['old-1'])
    expect(audit).toHaveBeenCalledTimes(2)
  })

  it('needs a signed-in person who can manage integrations', async () => {
    const body = { connectorId: CONNECTOR, system: 'mac', folder: '/r' }
    expect(
      (await handleAgentPackage(post(body), setup({ signedIn: false }).deps))
        .status,
    ).toBe(401)
    expect(
      (await handleAgentPackage(post(body), setup({ denied: true }).deps))
        .status,
    ).toBe(403)
  })

  it('asks for the destination first, and rejects unknown instruments and bad requests', async () => {
    const body = { connectorId: CONNECTOR, system: 'mac', folder: '/r' }
    const unset = await handleAgentPackage(
      post(body),
      setup({ connector: { config: {} } }).deps,
    )
    expect(unset.status).toBe(422)
    expect(
      (await handleAgentPackage(post(body), setup({ connector: null }).deps))
        .status,
    ).toBe(404)
    expect(
      (await handleAgentPackage(post({ nope: 1 }), setup({}).deps)).status,
    ).toBe(400)
  })
})

describe('agent status', () => {
  it('says whether it was downloaded and when it last checked in', async () => {
    const name = 'Folder agent · qpcr-bench'
    const read = async (existing: Array<Record<string, unknown>>) =>
      (await handleAgentPackage(get(), setup({ existing }).deps)).json()
    expect(await read([])).toEqual({
      downloaded: false,
      lastSeenAt: null,
      running: false,
    })
    expect(
      await read([
        { name, kind: 'personal', revokedAt: null, lastUsedAt: null },
      ]),
    ).toMatchObject({ downloaded: true, running: false, lastSeenAt: null })
    const recent = new Date(NOW.getTime() - 5 * 60_000)
    expect(
      await read([
        { name, kind: 'personal', revokedAt: null, lastUsedAt: recent },
      ]),
    ).toMatchObject({ running: true, lastSeenAt: recent.toISOString() })
    const old = new Date(NOW.getTime() - 3 * 3_600_000)
    expect(
      await read([
        { name, kind: 'personal', revokedAt: null, lastUsedAt: old },
      ]),
    ).toMatchObject({ running: false })
  })

  it('ignores revoked tokens and other instruments', async () => {
    const recent = new Date(NOW.getTime() - 60_000)
    const response = await handleAgentPackage(
      get(),
      setup({
        existing: [
          {
            name: 'Folder agent · qpcr-bench',
            kind: 'personal',
            revokedAt: new Date(),
            lastUsedAt: recent,
          },
          {
            name: 'Folder agent · other',
            kind: 'personal',
            revokedAt: null,
            lastUsedAt: recent,
          },
        ],
      }).deps,
    )
    expect(await response.json()).toMatchObject({ downloaded: false })
  })
})
