/**
 * RM-119: an experiment's open-issue count is the uncleared dataset value
 * flags on the datasets it produced (linked through `record_links`). Covers
 * success, a cleared flag dropping out, viewer access, other-workspace
 * isolation and RLS denial for a non-member.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000001a0a'
const OTHER_WS = '00000000-0000-4000-8000-000000001a0b'
const OWNER = 'rm119-owner'
const VIEWER = 'rm119-viewer'
const OUTSIDER = 'rm119-outsider'

const SCHEMA = '00000000-0000-4000-8000-000000001a01'
const SCHEMA_VERSION = '00000000-0000-4000-8000-000000001a02'
const DATASET = '00000000-0000-4000-8000-000000001a03'
const DATASET_OTHER = '00000000-0000-4000-8000-000000001a04'
const EXP = '00000000-0000-4000-8000-000000001a10'
const EXP_OTHER_WS = '00000000-0000-4000-8000-000000001a11'
const ROW_A = '00000000-0000-4000-8000-000000001a20'
const ROW_B = '00000000-0000-4000-8000-000000001a21'
const FIELD = '00000000-0000-4000-8000-000000001a30'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
     ($1,'Owner','rm119-owner@test.invalid',true),
     ($2,'Viewer','rm119-viewer@test.invalid',true),
     ($3,'Outsider','rm119-outsider@test.invalid',true)`,
    [OWNER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'rm119','RM119'),($2,'rm119-other','RM119 Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, OTHER_WS, OUTSIDER],
  )

  await migrator.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name) values ($1,$2,'rm119_model','RM119 model')`,
    [SCHEMA, WS],
  )
  await migrator.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle) values ($1,$2,1,'active')`,
    [SCHEMA_VERSION, SCHEMA],
  )
  await migrator.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,primary_project_id)
     values ($1,$2,$3,'RM119 dataset',null),($4,$2,$3,'RM119 other dataset',null)`,
    [DATASET, WS, SCHEMA_VERSION, DATASET_OTHER],
  )
  await migrator.query(
    `insert into api.dataset_rows(id,dataset_id,workspace_id) values ($1,$2,$3),($4,$2,$3)`,
    [ROW_A, DATASET, WS, ROW_B],
  )

  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values ($1,$2,'experiment','EXP-RM119','RM119 experiment','in_progress',$3)`,
    [EXP, WS, OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values ($1,$2,'experiment','EXP-RM119-O','Other workspace experiment','in_progress',$3)`,
    [EXP_OTHER_WS, OTHER_WS, OUTSIDER],
  )

  const display = await migrator.query<{ display_id: string }>(
    'select display_id from api.datasets where id = $1',
    [DATASET],
  )
  await migrator.query(
    `insert into api.record_links(source_record_id,target_kind,target_identifier,link_type,created_by_user_id)
     values ($1,'dataset',$2,'dataset',$3)`,
    [EXP, display.rows[0]!.display_id, OWNER],
  )

  await migrator.query(
    `insert into api.dataset_value_flags
       (id,workspace_id,dataset_id,row_id,field_id,kind,reason,set_by_user_id,cleared_at)
     values
       ($1,$2,$3,$4,$5,'out_of_range','above range',$6,null),
       ($7,$2,$3,$8,$5,'missing_unit','no unit',$6,now())`,
    [
      DATASET,
      WS,
      DATASET,
      ROW_A,
      FIELD,
      OWNER,
      '00000000-0000-4000-8000-000000001a40',
      ROW_B,
    ],
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

const counts = (client: Client) =>
  client.query<{ record_id: string; open_issues: string }>(
    'select record_id, open_issues from api.experiment_open_issue_counts()',
  )

describe('experiment open-issue counts', () => {
  it('counts the uncleared flags on the experiment’s datasets', async () => {
    const owner = await actor(OWNER, WS)
    const { rows } = await counts(owner)
    const row = rows.find((r) => r.record_id === EXP)
    expect(row).toBeDefined()
    // Two flags inserted, one cleared: only the open one counts.
    expect(Number(row!.open_issues)).toBe(1)
  })

  it('lets a viewer read the count', async () => {
    const viewer = await actor(VIEWER, WS)
    const { rows } = await counts(viewer)
    expect(rows.find((r) => r.record_id === EXP)).toBeDefined()
  })

  it('isolates other workspaces', async () => {
    const owner = await actor(OWNER, WS)
    const { rows } = await counts(owner)
    expect(rows.find((r) => r.record_id === EXP_OTHER_WS)).toBeUndefined()
  })

  it('returns nothing for a non-member', async () => {
    const outsider = await actor(OUTSIDER, WS)
    const { rows } = await counts(outsider)
    expect(rows.find((r) => r.record_id === EXP)).toBeUndefined()
  })
})
