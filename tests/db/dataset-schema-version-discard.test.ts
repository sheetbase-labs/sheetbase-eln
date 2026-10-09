/**
 * MDL-02: a draft Dataset Schema Version can be discarded by a schema editor;
 * a published version cannot, and a viewer is denied.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000180a'
const OWNER = 'mdl02-owner'
const VIEWER = 'mdl02-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','mdl02-owner@test.invalid',true),($2,'Viewer','mdl02-viewer@test.invalid',true)`,
    [OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'mdl02','MDL02')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer')`,
    [WS, OWNER, VIEWER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(user: string, workspace: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: user,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

let draftCounter = 0
async function makeDraft(client: Client) {
  draftCounter += 1
  const created = (
    await client.query(
      `select api.create_dataset_schema_definition($1,$2,'Model','', '[]'::jsonb) result`,
      [WS, `mdl02_model_${draftCounter}`],
    )
  ).rows[0].result as {
    schema_version_id: string
    schema_definition_id: string
  }
  return created
}

describe('discard a draft dataset schema version', () => {
  it('lets a schema editor discard a draft', async () => {
    const owner = await actor(OWNER, WS)
    const created = await makeDraft(owner)
    await owner.query(`select api.delete_dataset_schema_version($1)`, [
      created.schema_version_id,
    ])
    const left = await owner.query(
      `select 1 from api.dataset_schema_versions where id = $1`,
      [created.schema_version_id],
    )
    expect(left.rows).toHaveLength(0)
  })

  it('refuses to discard a published version', async () => {
    const owner = await actor(OWNER, WS)
    const created = await makeDraft(owner)
    await owner.query(`select api.publish_dataset_schema_version($1)`, [
      created.schema_version_id,
    ])
    await expect(
      owner.query(`select api.delete_dataset_schema_version($1)`, [
        created.schema_version_id,
      ]),
    ).rejects.toMatchObject({ code: 'SB073' })
  })

  it('denies a viewer', async () => {
    const owner = await actor(OWNER, WS)
    const created = await makeDraft(owner)
    const viewer = await actor(VIEWER, WS)
    await expect(
      viewer.query(`select api.delete_dataset_schema_version($1)`, [
        created.schema_version_id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
