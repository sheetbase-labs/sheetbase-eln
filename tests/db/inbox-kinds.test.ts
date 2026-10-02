/**
 * RM-116: `my_work_items` exposes the data-issue and material-expiring kinds,
 * workspace-wide, and stays RLS-scoped to the caller's workspace.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000001f0a'
const OTHER_WS = '00000000-0000-4000-8000-000000001f0b'
const USER = 'wk-owner'
const OUTSIDER = 'wk-outsider'
const SCHEMA = '00000000-0000-4000-8000-000000001f01'
const SCHEMA_VERSION = '00000000-0000-4000-8000-000000001f02'
const DATASET = '00000000-0000-4000-8000-000000001f03'
const ROW = '00000000-0000-4000-8000-000000001f04'
const FLAG = '00000000-0000-4000-8000-000000001f05'
const REAGENT = '00000000-0000-4000-8000-000000001f06'
const FIELD = '00000000-0000-4000-8000-000000001f07'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
     ($1,'Worker','wk-owner@test.invalid',true),
     ($2,'Outsider','wk-outsider@test.invalid',true)`,
    [USER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'wk','WK'),($2,'wk2','WK2')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($3,$4,'owner')`,
    [WS, USER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name) values ($1,$2,'wk_model','WK')`,
    [SCHEMA, WS],
  )
  await migrator.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle) values ($1,$2,1,'active')`,
    [SCHEMA_VERSION, SCHEMA],
  )
  await migrator.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,primary_project_id,created_by_user_id)
     values ($1,$2,$3,'WK dataset',null,$4)`,
    [DATASET, WS, SCHEMA_VERSION, USER],
  )
  await migrator.query(
    `insert into api.dataset_rows(id,dataset_id,workspace_id) values ($1,$2,$3)`,
    [ROW, DATASET, WS],
  )
  await migrator.query(
    `insert into api.dataset_value_flags
       (id,workspace_id,dataset_id,row_id,field_id,kind,reason,set_by_user_id)
     values ($1,$2,$3,$4,$5,'out_of_range','above range',$6)`,
    [FLAG, WS, DATASET, ROW, FIELD, USER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id,properties)
     values ($1,$2,'reagent','MAT-WK','WI reagent','available',$3,'{"expiry":"2026-10-05"}'::jsonb)`,
    [REAGENT, WS, USER],
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
    JSON.stringify({ sub: user, workspace_id: workspace }),
  ])
  return client
}

const kinds = async (client: Client) => {
  const { rows } = await client.query<{ kind: string }>(
    'select distinct kind from api.my_work_items',
  )
  return rows.map((r) => r.kind)
}

describe('my_work_items kinds', () => {
  it('exposes a data issue for an uncleared flag', async () => {
    const worker = await actor(USER, WS)
    expect(await kinds(worker)).toContain('data_issue')
  })

  it('exposes an expiring material', async () => {
    const worker = await actor(USER, WS)
    expect(await kinds(worker)).toContain('material_expiring')
  })

  it('returns nothing for a member of another workspace', async () => {
    // The outsider's claims name the workspace they are not a member of.
    const outsider = await actor(OUTSIDER, WS)
    const { rows } = await outsider.query('select 1 from api.my_work_items')
    expect(rows).toHaveLength(0)
  })
})
