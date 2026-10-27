/**
 * Searching dataset cell values returns only the datasets the caller can view,
 * and checks that once per dataset rather than once per cell row. The read
 * policy used to call can_access_object for every cell in the workspace, which
 * made each search cost seconds once a few thousand cells existed.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000016a0'
const OTHER_WS = '00000000-0000-4000-8000-0000000016a1'
const PROJECT = '00000000-0000-4000-8000-0000000016a2'
const HIDDEN_PROJECT = '00000000-0000-4000-8000-0000000016a3'
const SCHEMA = '00000000-0000-4000-8000-0000000016a4'
const SCHEMA_VERSION = '00000000-0000-4000-8000-0000000016a5'
const DATASET = '00000000-0000-4000-8000-0000000016a6'
const HIDDEN_DATASET = '00000000-0000-4000-8000-0000000016a7'
const OPEN_DATASET = '00000000-0000-4000-8000-0000000016a8'
const FIELD = '00000000-0000-4000-8000-0000000016a9'
const MEMBER = 'dcs-member'
const VIEWER = 'dcs-viewer'
const OUTSIDER = 'dcs-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

async function cellHits(client: Client, query: string): Promise<string[]> {
  const { rows } = await client.query<{ record_id: string }>(
    `select record_id from api.search(p_query => $1, p_result_type => 'dataset_row')`,
    [query],
  )
  return rows.map((row) => row.record_id).sort()
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [MEMBER, VIEWER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'dcs','DCS'),($2,'dcs-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role)
     values($1,$2,'member'),($1,$3,'member'),($4,$5,'member')`,
    [WS, MEMBER, VIEWER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values
       ($1,$3,'DCSA','Open project',$4),
       ($2,$3,'DCSB','Closed project',$4)`,
    [PROJECT, HIDDEN_PROJECT, WS, MEMBER],
  )
  await migrator.query(
    `insert into api.project_access(workspace_id,project_id,user_id,can_view,granted_by_user_id)
     values($1,$2,$3,true,$3),($1,$2,$4,true,$3),($1,$5,$3,true,$3)
     on conflict do nothing`,
    [WS, PROJECT, MEMBER, VIEWER, HIDDEN_PROJECT],
  )
  await migrator.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle)
     values($1,$2,'dcs_schema','DCS schema','draft')`,
    [SCHEMA, WS],
  )
  await migrator.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle)
     values($1,$2,1,'draft')`,
    [SCHEMA_VERSION, SCHEMA],
  )
  await migrator.query(
    `insert into api.dataset_schema_version_fields
       (id,schema_version_id,field_id,key,label,logical_type,nullable,validation,display_order)
     values(gen_random_uuid(),$1,$2,'note','Note','text',true,'{}'::jsonb,1)`,
    [SCHEMA_VERSION, FIELD],
  )
  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
    [SCHEMA_VERSION],
  )
  await migrator.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,primary_project_id) values
       ($1,$4,$5,'Visible dataset',$6),
       ($2,$4,$5,'Closed dataset',$7),
       ($3,$4,$5,'Workspace-wide dataset',null)`,
    [
      DATASET,
      HIDDEN_DATASET,
      OPEN_DATASET,
      WS,
      SCHEMA_VERSION,
      PROJECT,
      HIDDEN_PROJECT,
    ],
  )
  for (const dataset of [DATASET, HIDDEN_DATASET, OPEN_DATASET]) {
    const { rows } = await migrator.query<{ id: string }>(
      `insert into api.dataset_versions
         (dataset_id,workspace_id,schema_version_id,source_dataset_revision,label)
       values($1,$2,$3,1,'v1') returning id`,
      [dataset, WS, SCHEMA_VERSION],
    )
    await migrator.query(
      `insert into api.dataset_rows(id,dataset_id,workspace_id,status)
       values(gen_random_uuid(),$1,$2,'recorded')`,
      [dataset, WS],
    )
    const row = await migrator.query<{ id: string }>(
      `select id from api.dataset_rows where dataset_id=$1`,
      [dataset],
    )
    await migrator.query(
      `insert into api.dataset_cell_search
         (dataset_version_id,row_id,field_id,dataset_id,workspace_id,field_label,value_text)
       values($1,$2,$3,$4,$5,'Note','quokka titre')`,
      [rows[0].id, row.rows[0].id, FIELD, dataset, WS],
    )
  }
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('dataset cell search access', () => {
  it('finds cells in every dataset the caller can view', async () => {
    const member = await actor(MEMBER, WS)
    expect(await cellHits(member, 'quokka')).toEqual(
      [DATASET, HIDDEN_DATASET, OPEN_DATASET].sort(),
    )
  })

  it('leaves out datasets in a project the caller has no access to', async () => {
    const viewer = await actor(VIEWER, WS)
    expect(await cellHits(viewer, 'quokka')).toEqual(
      [DATASET, OPEN_DATASET].sort(),
    )
  })

  it('shows nothing from another workspace', async () => {
    const outsider = await actor(OUTSIDER, OTHER_WS)
    expect(await cellHits(outsider, 'quokka')).toEqual([])
  })

  it('lists the viewable datasets for the policy once per call', async () => {
    const viewer = await actor(VIEWER, WS)
    const { rows } = await viewer.query<{ id: string }>(
      `select internal.viewable_dataset_ids() as id`,
    )
    expect(rows.map((row) => row.id).sort()).toEqual(
      [DATASET, OPEN_DATASET].sort(),
    )
  })
})
