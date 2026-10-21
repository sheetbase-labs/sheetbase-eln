/**
 * Pipelines in the external API: an API key with pipelines:read sees only its own
 * workspace's pipelines, versions, runs, logs and outputs and can write none of
 * them; the draft-write RPCs are for a person's own token, never a service
 * credential; and the credential scope constraint knows both new scopes.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS_A = '0e020000-0000-4000-8000-00000000000a'
const WS_B = '0e020000-0000-4000-8000-00000000000b'
const OWNER = 'pipe-scope-owner'
const OWNER_B = 'pipe-scope-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let definitionA = ''
let versionA = ''

const CONFIG = {
  configVersion: 1,
  parameters: [],
  inputs: [],
  transform: { language: 'none', statement: '' },
  output: { mode: 'none', datasetLabel: 'out' },
}

async function apiClient(workspace: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE api_client')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      role: 'api_client',
      workspace_id: workspace,
      credential_id: 'cred-unused',
      scopes: ['pipelines:read', 'pipelines:write'],
    }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const [id, slug] of [
    [WS_A, 'pipe-scope-a'],
    [WS_B, 'pipe-scope-b'],
  ]) {
    await migrator.query(
      'insert into api.workspaces(id, slug, name) values($1, $2, $2)',
      [id, slug],
    )
  }
  await migrator.query(
    `insert into internal."user"(id, name, email) values
       ($1, 'Owner', 'o@pipe-scope.test'), ($2, 'Owner B', 'ob@pipe-scope.test')`,
    [OWNER, OWNER_B],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id, user_id, role) values
       ($1, $2, 'owner'), ($3, $4, 'owner')`,
    [WS_A, OWNER, WS_B, OWNER_B],
  )
  const owner = await asRole('authenticator')
  clients.push(owner)
  await owner.query('SET ROLE authenticated')
  await setActorJwt(owner, OWNER, WS_A)
  const definition = await owner.query<{ id: string }>(
    `select id from api.create_pipeline_definition($1::uuid, 'nightly', 'Nightly', null)`,
    [WS_A],
  )
  definitionA = definition.rows[0].id
  const version = await owner.query<{ id: string }>(
    'select id from api.create_pipeline_definition_version($1::uuid, $2::uuid, $3::jsonb)',
    [WS_A, definitionA, JSON.stringify(CONFIG)],
  )
  versionA = version.rows[0].id
})

afterAll(async () => {
  for (const client of clients) await client.end().catch(() => {})
  await migrator?.end()
})

describe('pipelines:read for api_client', () => {
  it('reads its own workspace’s pipelines and versions', async () => {
    const client = await apiClient(WS_A)
    const definitions = await client.query(
      'select key from api.pipeline_definitions',
    )
    expect(definitions.rows).toEqual([{ key: 'nightly' }])
    const versions = await client.query(
      'select id, lifecycle from api.pipeline_definition_versions',
    )
    expect(versions.rows).toEqual([{ id: versionA, lifecycle: 'draft' }])
    for (const table of [
      'pipeline_runs',
      'pipeline_run_logs',
      'pipeline_run_outputs',
    ]) {
      expect((await client.query(`select 1 from api.${table}`)).rows).toEqual(
        [],
      )
    }
  })

  it('sees nothing of another workspace', async () => {
    const client = await apiClient(WS_B)
    for (const table of [
      'pipeline_definitions',
      'pipeline_definition_versions',
      'pipeline_runs',
    ]) {
      expect((await client.query(`select 1 from api.${table}`)).rows).toEqual(
        [],
      )
    }
  })

  it('cannot write any pipeline table', async () => {
    const client = await apiClient(WS_A)
    await expect(
      client.query(
        `insert into api.pipeline_definitions(workspace_id, key, name) values ($1, 'x', 'x')`,
        [WS_A],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      client.query(
        `update api.pipeline_definition_versions set revision = revision + 1`,
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('cannot save a draft: the draft RPCs need a person', async () => {
    const client = await apiClient(WS_A)
    await expect(
      client.query(
        'select * from api.create_pipeline_definition_version($1::uuid, $2::uuid, $3::jsonb)',
        [WS_A, definitionA, JSON.stringify(CONFIG)],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      client.query(
        'select * from api.update_pipeline_definition_version_draft($1::uuid, $2::uuid, 1::bigint, $3::jsonb)',
        [WS_A, versionA, JSON.stringify(CONFIG)],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('credential scope constraint', () => {
  const insert = (scopes: string[]) =>
    migrator.query(
      `insert into internal.api_credentials(workspace_id, display_prefix, secret_hash, name, scopes, created_by_user_id)
       values ($1, $2, 'h', 'k', $3::text[], $4)`,
      [WS_A, `p${Math.random().toString(36).slice(2, 10)}`, scopes, OWNER],
    )

  it('accepts both pipelines scopes and still refuses unknown ones', async () => {
    await insert(['pipelines:read'])
    await insert(['pipelines:read', 'pipelines:write'])
    await expect(insert(['pipelines:run'])).rejects.toMatchObject({
      code: '23514',
    })
  })
})
