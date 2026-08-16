import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c103'
const OWNER = 'core-h1-owner'
const STEWARD = 'core-h1-steward'
const SCIENTIST = 'core-h1-scientist'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, role = 'authenticated') {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query(`SET ROLE ${role}`)
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: WS,
      role: 'authenticated',
    }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','h1-owner@test.invalid',true),
      ('${STEWARD}','Steward','h1-steward@test.invalid',true),
      ('${SCIENTIST}','Scientist','h1-scientist@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS}','core-h1','CORE H1 capabilities');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${STEWARD}','steward'),
      ('${WS}','${SCIENTIST}','scientist')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('H1 capability mask is not caller-controlled', () => {
  it('scientist cannot self-grant schema.publish or workspace.admin', async () => {
    const scientist = await actor(SCIENTIST)
    await scientist.query(
      `select set_config('sheetbase.capability_mask','schema.publish,workspace.admin',false)`,
    )
    const { rows } = await scientist.query(
      `select api.has_capability($1,'schema.publish') as schema_publish,
              api.has_capability($1,'workspace.admin') as workspace_admin,
              api.has_capability($1,'record.link') as record_link`,
      [WS],
    )
    expect(rows[0]).toEqual({
      schema_publish: false,
      workspace_admin: false,
      record_link: true,
    })
  })

  it('steward cannot gain capabilities outside role mapping through the GUC', async () => {
    const steward = await actor(STEWARD)
    await steward.query(
      `select set_config('sheetbase.capability_mask','workspace.admin',false)`,
    )
    const { rows } = await steward.query(
      `select api.has_capability($1,'workspace.admin') as workspace_admin,
              api.has_capability($1,'schema.publish') as schema_publish`,
      [WS],
    )
    expect(rows[0]).toEqual({
      workspace_admin: false,
      schema_publish: true,
    })
  })

  it('api_client cannot escalate via the GUC', async () => {
    const client = await actor(STEWARD, 'api_client')
    await client.query(
      `select set_config('sheetbase.capability_mask','workspace.admin,schema.publish',false)`,
    )
    await expectDenied(
      client.query(`select api.has_capability($1,'workspace.admin')`, [WS]),
      '42501',
    )
    await client.query('SET ROLE authenticated')
    const { rows } = await client.query(
      `select api.has_capability($1,'workspace.admin') as workspace_admin,
              api.has_capability($1,'schema.publish') as schema_publish`,
      [WS],
    )
    expect(rows[0]).toEqual({
      workspace_admin: false,
      schema_publish: true,
    })
  })

  it('trusted migrator overlay still restricts schema.edit without publish', async () => {
    await migrator.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({
        sub: STEWARD,
        workspace_id: WS,
        role: 'authenticated',
      }),
    ])
    await migrator.query(
      `select set_config('sheetbase.capability_mask','schema.edit',false)`,
    )
    try {
      const { rows } = await migrator.query(
        `select session_user as login,
                api.has_capability($1,'schema.edit') as schema_edit,
                api.has_capability($1,'schema.publish') as schema_publish,
                api.has_capability($1,'workspace.admin') as workspace_admin`,
        [WS],
      )
      expect(rows[0]).toMatchObject({
        login: 'migrator',
        schema_edit: true,
        schema_publish: false,
        workspace_admin: false,
      })
    } finally {
      await migrator.query(
        `select set_config('sheetbase.capability_mask','',false)`,
      )
      await migrator.query(`select set_config('request.jwt.claims','',false)`)
    }
  })
})
