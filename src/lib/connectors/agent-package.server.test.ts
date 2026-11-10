// @vitest-environment node
import { unzipSync, strFromU8 } from 'fflate'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { Duplex } from 'node:stream'
import { Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { z } from 'zod'

import * as schema from '#/db/schema'
import { createDataClient } from '../data-client'
import type { CredentialRecord } from '../api-credentials'
import type { pipelineJsonObjectSchema } from '../pipelines/types'
import type { ConnectorWire } from './types'
import { AGENT_SCOPES } from './agent-package'
import { handleAgentPackage } from './agent-package.server'
import type { AgentPackageDeps } from './agent-package.server'

vi.hoisted(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://unused:unused@127.0.0.1:1/unused')
  vi.stubEnv(
    'FORMULA_DATABASE_URL',
    'postgresql://unused:unused@127.0.0.1:1/unused',
  )
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-at-least-thirty-two-characters')
  vi.stubEnv('PGRST_JWT_SECRET', 'test-jwt-secret-at-least-thirty-two-chars')
})

afterAll(() => vi.unstubAllEnvs())

const clients = new Set<Client>()

afterEach(async () => {
  await Promise.all([...clients].map((client) => client.end()))
  clients.clear()
})

function pgMessage(code: string, payload: Buffer) {
  const header = Buffer.alloc(5)
  header.write(code)
  header.writeInt32BE(payload.length + 4, 1)

  return Buffer.concat([header, payload])
}

/** Real pg and Drizzle transaction control over a socket-free protocol transport. */
function transactionDatabase(commands: string[]) {
  let startup = true

  const stream = new Duplex({
    read() {
      /* Responses follow frontend messages. */
    },
    write(chunk: Buffer, _encoding, done) {
      if (startup) {
        startup = false
        stream.push(
          Buffer.concat([
            pgMessage('R', Buffer.alloc(4)),
            pgMessage('Z', Buffer.from('I')),
          ]),
        )
      } else if (chunk[0] === 81) {
        const command = chunk.subarray(5, -1).toString().toLowerCase()
        commands.push(command)

        if (!['begin', 'commit', 'rollback'].includes(command)) {
          done(new Error(`Unexpected fixture SQL: ${command}`))

          return
        }

        stream.push(
          Buffer.concat([
            pgMessage('C', Buffer.from(`${command.toUpperCase()}\0`)),
            pgMessage('Z', Buffer.from(command === 'begin' ? 'T' : 'I')),
          ]),
        )
      } else if (chunk[0] === 88) {
        stream.push(null)
      }

      done()
    },
  })

  Object.assign(stream, {
    setNoDelay: () => stream,
    connect: () => {
      queueMicrotask(() => stream.emit('connect'))

      return stream
    },
  })

  const client = new Client({
    user: 'fixture',
    database: 'fixture',
    stream: () => stream,
  })

  const db = drizzle({ client, schema })
  let connected: Promise<Client> | undefined

  return async () => {
    clients.add(client)
    await (connected ??= client.connect())

    return db
  }
}

const WS = '11111111-1111-4111-8111-111111111111'
const CONNECTOR = '55555555-5555-4555-8555-555555555555'
const NOW = new Date('2026-10-29T12:00:00Z')

interface InstrumentFixture {
  id: string
  name: string
  display_id: string | null
  retired_at: string | null
}

type SourceFixture = Partial<ConnectorWire> & Partial<InstrumentFixture>

type Credentials = Awaited<ReturnType<AgentPackageDeps['loadCredentials']>>

function connector(overrides: SourceFixture = {}) {
  return {
    id: CONNECTOR,
    workspace_id: WS,
    key: 'qpcr-bench',
    name: 'qPCR bench',
    connector_type: 'instrument',
    direction: 'inbound',
    status: 'active',
    parser_id: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    config: { pickup: { projectId: 'p', schemaVersionId: 's' } },
    ...overrides,
  }
}

function setup(options: {
  signedIn?: boolean
  workspace?: boolean
  connector?: SourceFixture | null
  existing?: Partial<CredentialRecord>[]
  denied?: boolean
  failAt?: 'revoke' | 'audit-revoke' | 'create' | 'audit-create'
}) {
  const revoked: string[] = []
  const created: Parameters<Credentials['createCredential']>[1][] = []
  const steps: string[] = []
  const commands: string[] = []

  const audit = vi.fn<NonNullable<AgentPackageDeps['emitAudit']>>(
    async (_db, input) => {
      steps.push(`audit-${input.operation}:${input.credentialId}`)

      if (options.failAt === `audit-${input.operation}`)
        throw new Error(`failed ${options.failAt}`)
    },
  )

  const fetchImpl: typeof fetch = async (input) => {
    const path = new URL(
      input instanceof Request ? input.url : input.toString(),
      'https://eln.example.com',
    ).pathname

    if (path === '/api/db/connectors' || path === '/api/db/instruments')
      return Response.json(
        options.connector === null ? [] : [connector(options.connector)],
      )

    if (path === '/api/db/rpc/require_capability')
      return options.denied
        ? Response.json(
            { error: { code: '42501', message: 'capability required' } },
            { status: 403 },
          )
        : Response.json({})
    throw new Error(`Unexpected HTTP request: ${path}`)
  }

  const deps: AgentPackageDeps = {
    getSession: async () =>
      options.signedIn === false
        ? null
        : { user: { id: 'user-1' }, session: { id: 'session-1' } },
    getWorkspaceForUser: async () =>
      options.workspace === false ? null : { id: WS },
    mintToken: async () => 'jwt',
    loadDb: transactionDatabase(commands),
    loadCredentials: async () => ({
      listCredentials: async () => (options.existing ?? []).map(credential),
      revokeCredential: async (_db, input) => {
        steps.push(`revoke:${input.credentialId}`)

        if (options.failAt === 'revoke') throw new Error('failed revoke')
        revoked.push(input.credentialId)
      },
      createCredential: async (_db, input) => {
        steps.push('create')

        if (options.failAt === 'create') throw new Error('failed create')
        created.push(input)

        return {
          id: 'new-cred',
          secret: 'sbk_fresh',
          displayPrefix: 'sbk_fresh',
          name: input.name,
          scopes: [...AGENT_SCOPES],
          kind: 'personal',
        }
      },
    }),
    agentSource: async () => '// the agent',
    createClient: () => createDataClient(fetchImpl),
    emitAudit: audit,
    now: () => NOW,
  }

  return { deps, revoked, created, audit, steps, commands }
}

function credential(overrides: Partial<CredentialRecord>): CredentialRecord {
  return {
    id: 'credential',
    workspaceId: WS,
    kind: 'personal',
    displayPrefix: 'sbk_old',
    name: 'Folder agent · qpcr-bench',
    scopes: [...AGENT_SCOPES],
    createdAt: NOW,
    lastUsedAt: null,
    revokedAt: null,
    expiresAt: null,
    refusalCount: 0,
    lastRefusedAt: null,
    expired: false,
    unusedDays: null,
    needsReplacement: false,
    createdByUserId: 'user-1',
    ...overrides,
  }
}

const post = (body: z.infer<typeof pipelineJsonObjectSchema>) =>
  new Request('https://eln.example.com/api/connectors/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const get = (id = CONNECTOR) =>
  new Request(`https://eln.example.com/api/connectors/agent?connector=${id}`)

describe('agent download', () => {
  it('retains the first loader failure even when the credential import rejects sooner', async () => {
    const { deps, commands } = setup({})
    const databaseFailure = new Error('database import failed')
    deps.loadDb = async () => {
      await Promise.resolve()
      throw databaseFailure
    }

    deps.loadCredentials = async () => {
      throw new Error('credential import failed')
    }

    await expect(handleAgentPackage(get(), deps)).rejects.toBe(databaseFailure)
    expect(commands).toEqual([])
  })

  it('preserves credential import failures when database loading succeeds', async () => {
    const { deps, commands } = setup({})
    const credentialFailure = new Error('credential import failed')
    deps.loadCredentials = async () => {
      throw credentialFailure
    }

    await expect(handleAgentPackage(get(), deps)).rejects.toBe(
      credentialFailure,
    )
    expect(commands).toEqual([])
  })

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
    const { deps, revoked, audit, steps, commands } = setup({
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
    expect(steps).toEqual([
      'revoke:old-1',
      'audit-revoke:old-1',
      'create',
      'audit-create:new-cred',
    ])
    expect(commands).toEqual(['begin', 'commit'])
  })

  it.each([
    { failAt: 'revoke', expected: ['revoke:old-1'] },
    {
      failAt: 'audit-revoke',
      expected: ['revoke:old-1', 'audit-revoke:old-1'],
    },
    {
      failAt: 'create',
      expected: [
        'revoke:old-1',
        'audit-revoke:old-1',
        'revoke:old-2',
        'audit-revoke:old-2',
        'create',
      ],
    },
    {
      failAt: 'audit-create',
      expected: [
        'revoke:old-1',
        'audit-revoke:old-1',
        'revoke:old-2',
        'audit-revoke:old-2',
        'create',
        'audit-create:new-cred',
      ],
    },
  ] satisfies Array<{
    failAt: NonNullable<Parameters<typeof setup>[0]['failAt']>
    expected: string[]
  }>)(
    'stops replacement at the first $failAt failure and rolls the transaction back',
    async ({ failAt, expected }) => {
      const { deps, steps, commands } = setup({
        failAt,
        existing: [{ id: 'old-1' }, { id: 'old-2' }],
      })

      const response = await handleAgentPackage(
        post({ connectorId: CONNECTOR, system: 'linux', folder: '/data' }),
        deps,
      )

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({
        error: { code: 'agent_package_failed', message: `failed ${failAt}` },
      })
      expect(steps).toEqual(expected)
      expect(commands).toEqual(['begin', 'rollback'])
      expect(response.headers.get('content-type')).not.toBe('application/zip')
    },
  )

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

  it('uses the real session-auth rejection for a person without a workspace', async () => {
    const response = await handleAgentPackage(
      get(),
      setup({ workspace: false }).deps,
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'no_workspace' },
    })
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

    const read = async (existing: Partial<CredentialRecord>[]) =>
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

describe('live readings agent', () => {
  const INSTRUMENT = '66666666-6666-4666-8666-666666666666'

  const instrument = (overrides: Partial<InstrumentFixture> = {}) => ({
    id: INSTRUMENT,
    name: 'Freezer F-01',
    display_id: 'INS-0007',
    retired_at: null,
    ...overrides,
  })

  const live = [
    {
      kind: 'network',
      host: '192.168.1.20',
      port: 4001,
      feed: 'Weight',
      unit: 'g',
    },
  ]

  it('returns a zip that follows the chosen source, with no results folder', async () => {
    const { deps, created } = setup({ connector: instrument() })

    const response = await handleAgentPackage(
      post({ instrumentId: INSTRUMENT, system: 'linux', live }),
      deps,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain(
      'sheetbase-live-ins-0007.zip',
    )
    expect(created[0]).toMatchObject({
      name: 'Live agent · INS-0007',
      kind: 'personal',
    })
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()))

    const settings = JSON.parse(
      strFromU8(files['sheetbase-agent/sheetbase-agent.json']),
    )

    expect(settings).toEqual({
      url: 'https://eln.example.com',
      credential: 'sbk_fresh',
      instrumentId: INSTRUMENT,
      live,
    })
    expect(strFromU8(files['sheetbase-agent/README.txt'])).toContain(
      '192.168.1.20:4001',
    )
  })

  it('wants a source, integrations access and an instrument that takes readings', async () => {
    const ok = setup({ connector: instrument() })
    expect(
      (
        await handleAgentPackage(
          post({ instrumentId: INSTRUMENT, system: 'mac', live: [] }),
          ok.deps,
        )
      ).status,
    ).toBe(400)
    const denied = setup({ connector: instrument(), denied: true })
    expect(
      (
        await handleAgentPackage(
          post({ instrumentId: INSTRUMENT, system: 'mac', live }),
          denied.deps,
        )
      ).status,
    ).toBe(403)
    const missing = setup({ connector: null })
    expect(
      (
        await handleAgentPackage(
          post({ instrumentId: INSTRUMENT, system: 'mac', live }),
          missing.deps,
        )
      ).status,
    ).toBe(404)

    const retired = setup({
      connector: instrument({ retired_at: '2026-01-01' }),
    })

    expect(
      (
        await handleAgentPackage(
          post({ instrumentId: INSTRUMENT, system: 'mac', live }),
          retired.deps,
        )
      ).status,
    ).toBe(422)
  })

  it('says whether the live agent is running', async () => {
    const { deps } = setup({
      connector: instrument(),
      existing: [
        {
          id: 'c1',
          name: 'Live agent · INS-0007',
          kind: 'personal',
          revokedAt: null,
          lastUsedAt: new Date(NOW.getTime() - 60_000),
        },
      ],
    })

    const response = await handleAgentPackage(
      new Request(
        `https://eln.example.com/api/connectors/agent?instrument=${INSTRUMENT}`,
      ),
      deps,
    )

    expect(await response.json()).toMatchObject({
      downloaded: true,
      running: true,
    })
  })
})
