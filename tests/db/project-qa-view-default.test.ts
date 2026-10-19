/**
 * QA access default: once an administrator names a group, every project
 * created afterwards gives that group view-only access. Nothing else is
 * granted, existing projects are untouched, and a group that has come to
 * include a client user is ignored.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000511a'
const GROUP = '00000000-0000-4000-8000-00000000511b'
const CLIENT_GROUP = '00000000-0000-4000-8000-00000000511c'
const CLIENT_ORG = '00000000-0000-4000-8000-00000000511d'
const BEFORE = '00000000-0000-4000-8000-00000000511e'
const AFTER = '00000000-0000-4000-8000-00000000511f'
const AFTER_CLIENT_GROUP = '00000000-0000-4000-8000-000000005120'
const OWNER = 'qad-owner'
const QA = 'qad-qa'
const CLIENT_USER = 'qad-client'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const id of [OWNER, QA, CLIENT_USER]) {
    await migrator.query(
      `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES ($1,$1,$2,true)`,
      [id, `${id}@sheetbase.test`],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspaces (id,slug,name) VALUES ($1,'qad','QA default')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.clients (id,workspace_id,code,name) VALUES ($1,$2,'CL-001','Acme')`,
    [CLIENT_ORG, WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id,user_id,role,client_id) VALUES
      ($1,$2,'owner',NULL),($1,$3,'scientist',NULL),($1,$4,'client_viewer',$5)`,
    [WS, OWNER, QA, CLIENT_USER, CLIENT_ORG],
  )
  await migrator.query(
    `INSERT INTO api.workspace_groups (id,workspace_id,name) VALUES
      ($1,$3,'QA'),($2,$3,'Mixed')`,
    [GROUP, CLIENT_GROUP, WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_group_memberships (workspace_id,group_id,user_id) VALUES
      ($1,$2,$3),($1,$4,$5)`,
    [WS, GROUP, QA, CLIENT_GROUP, CLIENT_USER],
  )
  await migrator.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
  ])
  await migrator.query(
    `INSERT INTO api.projects (id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'before','Before the default',$3)`,
    [BEFORE, WS, OWNER],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asOwner(): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function groupRules(projectId: string) {
  const { rows } = await migrator.query<{
    group_id: string
    can_view: boolean
    can_edit: boolean
    can_review: boolean
    can_manage: boolean
    client_portal: boolean
  }>(
    `SELECT group_id,can_view,can_edit,can_review,can_manage,client_portal
       FROM api.project_access WHERE project_id=$1 AND group_id IS NOT NULL`,
    [projectId],
  )
  return rows
}

describe('QA view default for new projects', () => {
  it('grants nothing while no group is chosen', async () => {
    expect(await groupRules(BEFORE)).toEqual([])
  })

  it('gives the chosen group view-only access to a project created afterwards', async () => {
    const owner = await asOwner()
    await owner.query(`SELECT api.set_project_access_defaults($1)`, [GROUP])
    await owner.query(
      `INSERT INTO api.projects (id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'after','After the default',$3)`,
      [AFTER, WS, OWNER],
    )
    expect(await groupRules(AFTER)).toEqual([
      {
        group_id: GROUP,
        can_view: true,
        can_edit: false,
        can_review: false,
        can_manage: false,
        client_portal: false,
      },
    ])
    // The project that existed before is left as it was.
    expect(await groupRules(BEFORE)).toEqual([])
  })

  it('stops granting when the default is cleared', async () => {
    const owner = await asOwner()
    await owner.query(`SELECT api.set_project_access_defaults(NULL)`)
    await owner.query(
      `INSERT INTO api.projects (id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'cleared','Cleared',$3)`,
      [AFTER_CLIENT_GROUP, WS, OWNER],
    )
    expect(await groupRules(AFTER_CLIENT_GROUP)).toEqual([])
  })

  it('ignores a group that has come to include a client user', async () => {
    const owner = await asOwner()
    await owner.query(`SELECT api.set_project_access_defaults($1)`, [GROUP])
    // The group gains a client user after it was chosen.
    await migrator.query(
      `INSERT INTO api.workspace_group_memberships (workspace_id,group_id,user_id) VALUES ($1,$2,$3)`,
      [WS, GROUP, CLIENT_USER],
    )
    const mixed = '00000000-0000-4000-8000-000000005121'
    await owner.query(
      `INSERT INTO api.projects (id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'mixed','Mixed group',$3)`,
      [mixed, WS, OWNER],
    )
    expect(await groupRules(mixed)).toEqual([])
  })
})
