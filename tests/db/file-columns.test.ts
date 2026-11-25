/**
 * A File column is a link to a file record. The database holds it to the same
 * rule as every link: the value must be a file in the workspace, so a sample's
 * id, or a file from another workspace, is refused.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '15000000-0000-4000-8000-0000000000f1'
const OTHER_WS = '15000000-0000-4000-8000-0000000000f2'
const PROJECT = '15000000-0000-4000-8000-0000000000f3'
const OTHER_PROJECT = '15000000-0000-4000-8000-0000000000f4'
const OWNER = 'file-columns-owner'

let migrator: Client

async function record(
  workspace: string,
  project: string,
  kind: string,
  identifier: string,
) {
  const row = await migrator.query(
    `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values ($1,$2,$3,$4,$4,$5) returning id`,
    [workspace, project, kind, identifier, OWNER],
  )

  return row.rows[0].id as string
}

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','file-columns@test.invalid',true)`,
    [OWNER],
  )

  for (const [ws, slug, project] of [
    [WS, 'file-columns', PROJECT],
    [OTHER_WS, 'file-columns-other', OTHER_PROJECT],
  ]) {
    await migrator.query(
      `insert into api.workspaces(id,slug,name) values ($1,$2,'Files')`,
      [ws, slug],
    )
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner')`,
      [ws, OWNER],
    )
    await migrator.query(
      `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'files','Files',$3)`,
      [project, ws, OWNER],
    )
  }

  await migrator.query(
    `insert into api.record_field_definitions(workspace_id,kind,field_name,label,logical_type,lifecycle,display_order,created_by_user_id,validation)
     values ($1,'sample','coa','Certificate','reference','active',1,$2,'{"targetModelKey":"file"}')`,
    [WS, OWNER],
  )
})

afterAll(async () => {
  await migrator?.end()
})

describe('file columns', () => {
  it('holds a file from the workspace and refuses anything else', async () => {
    const file = await record(WS, PROJECT, 'file', 'FILE-T1')
    const sample = await record(WS, PROJECT, 'sample', 'SMP-T1')
    const elsewhere = await record(OTHER_WS, OTHER_PROJECT, 'file', 'FILE-T2')

    const check = (value: string) =>
      migrator.query(
        `select internal.validate_model_fields($1,'sample',$2::jsonb) out`,
        [WS, JSON.stringify({ coa: value })],
      )

    expect((await check(file)).rows[0].out).toEqual({ coa: file })
    await expect(check(sample)).rejects.toThrow(/invalid reference/)
    await expect(check(elsewhere)).rejects.toThrow(/invalid reference/)
  })
})
