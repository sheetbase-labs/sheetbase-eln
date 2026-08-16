import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c104'
const OWNER = 'core-h4-owner'
const SCIENTIST = 'core-h4-scientist'
const PROJECT = '00000000-0000-4000-8000-00000000c141'
const RECORD = '00000000-0000-4000-8000-00000000c142'
const BLOCK = '00000000-0000-4000-8000-00000000c143'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, role = 'authenticated') {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query(`SET ROLE ${role}`)
  await setActorJwt(client, userId, WS)
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','h4-owner@test.invalid',true),
      ('${SCIENTIST}','Scientist','h4-scientist@test.invalid',true)`,
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values
      ('${WS}','core-h4','CORE H4 legacy writes')`,
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${SCIENTIST}','scientist')`,
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title) values
      ('${PROJECT}','${WS}','H4','H4')`,
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
      values ('${RECORD}','${WS}','${PROJECT}','experiment','H4-1','H4',$1)`,
    [OWNER],
  )
  await migrator.query(
    `insert into api.blocks(id,record_id,type,payload,"order",created_by_user_id)
      values ('${BLOCK}','${RECORD}','sheet','{}',1,$1)`,
    [OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('H4 legacy scientific-table and SCI-010 writes are closed', () => {
  it('scientist and owner cannot insert_sheet_block or create_scientific_table', async () => {
    const scientist = await actor(SCIENTIST)
    const owner = await actor(OWNER)
    await expectDenied(
      scientist.query(`SELECT api.insert_sheet_block($1,NULL,NULL)`, [RECORD]),
      '42501',
    )
    await expectDenied(
      owner.query(
        `SELECT api.create_scientific_table($1,'closed','[]'::jsonb)`,
        [BLOCK],
      ),
      '42501',
    )
  })

  it('authenticated cannot create or publish SCI-010 dataset schemas', async () => {
    const owner = await actor(OWNER)
    await expectDenied(
      owner.query(`SELECT api.create_dataset_schema($1,$2,null,'[]'::jsonb)`, [
        'h4_closed',
        'H4 closed',
      ]),
      '42501',
    )
  })

  it('api_client cannot escalate to legacy writes', async () => {
    const apiClient = await actor(OWNER, 'api_client')
    await expectDenied(
      apiClient.query(`SELECT api.insert_sheet_block($1,NULL,NULL)`, [RECORD]),
      '42501',
    )
    await expectDenied(
      apiClient.query(
        `SELECT api.create_dataset_schema($1,$2,null,'[]'::jsonb)`,
        ['h4_api', 'H4 api'],
      ),
      '42501',
    )
  })

  it('migrator can still create a scientific table for fixtures and conversion', async () => {
    await setActorJwt(migrator, OWNER, WS)
    const created = await migrator.query(
      `SELECT api.create_scientific_table($1,'H4 fixture','[]'::jsonb) result`,
      [BLOCK],
    )
    expect(created.rows[0].result.table.resource_name).toMatch(/^sheet_/)
  })
})
