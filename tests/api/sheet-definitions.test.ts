import { config } from 'dotenv'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'
import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'

config({ path: ['.env.local', '.env'] })

const WS = '12000000-0000-4000-8000-000000000001'
const OWNER = 'sheet-definition-api-owner'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''
let admin: Client
let definitionId: string
let versionId: string

function proxy(request: Request, path: string) {
  return handleProxyRequest(request, path, {
    getSession: async () => ({
      user: { id: OWNER },
      session: { id: 'sheet-definition-api-session' },
    }),
    getWorkspaceForUser: async () => ({ id: WS }),
    mintToken: (input) => mintPostgrestToken(SECRET, input),
    upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
  })
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`http://sheetbase.test/api/db/${path}`, init)
}

async function expectGuardsEnabled() {
  const result = await admin.query(
    `select count(*)::integer trigger_count,bool_and(tgenabled='O') enabled
     from pg_trigger
     where tgname in ('guard_sheet_definition','guard_sheet_definition_version')`,
  )
  expect(result.rows[0]).toEqual({ trigger_count: 2, enabled: true })
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await admin.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,'Sheet Definition API Owner','sheet-definition-api@test.invalid',true)`,
    [OWNER],
  )
  await admin.query(
    `insert into api.workspaces(id,slug,name) values($1,'sheet-definition-api','Sheet Definition API')`,
    [WS],
  )
  await admin.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, OWNER],
  )
})

afterAll(async () => {
  if (admin) {
    try {
      await expectGuardsEnabled()
    } finally {
      await admin.end()
    }
  }
})

describe('Sheet Definition HTTP API contract', () => {
  it('creates through the controlled RPC and reads through RLS tables', async () => {
    const create = await proxy(
      request('rpc/create_sheet_definition', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_workspace_id: WS,
          p_key: 'api_definition',
          p_name: 'API Definition',
          p_description: null,
          p_configuration: validSheetDefinitionConfiguration(),
        }),
      }),
      'rpc/create_sheet_definition',
    )
    expect(create.status).toBe(200)
    const created = await create.json()
    definitionId = created.definition.id
    versionId = created.version.id

    const definitions = await proxy(
      request(`sheet_definitions?id=eq.${definitionId}`),
      'sheet_definitions',
    )
    expect(definitions.status).toBe(200)
    await expect(definitions.json()).resolves.toMatchObject([
      { id: definitionId, key: 'api_definition', lifecycle: 'active' },
    ])
    const versions = await proxy(
      request(`sheet_definition_versions?id=eq.${versionId}`),
      'sheet_definition_versions',
    )
    expect(versions.status).toBe(200)
    await expect(versions.json()).resolves.toMatchObject([
      {
        id: versionId,
        definition_id: definitionId,
        version: 1,
        lifecycle: 'draft',
        configuration_format_version: 1,
      },
    ])
  })

  it('publishes through the controlled RPC and blocks direct configuration writes', async () => {
    const publish = await proxy(
      request('rpc/publish_sheet_definition_version', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_version_id: versionId,
          p_expected_revision: 1,
        }),
      }),
      'rpc/publish_sheet_definition_version',
    )
    expect(publish.status).toBe(200)
    await expect(publish.json()).resolves.toMatchObject({
      id: versionId,
      lifecycle: 'published',
      revision: 2,
      published_by_user_id: OWNER,
    })

    const bypass = await proxy(
      request(`sheet_definition_versions?id=eq.${versionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ configuration: {} }),
      }),
      'sheet_definition_versions',
    )
    expect(bypass.status).toBe(403)
  })
})
