/**
 * EXP-03.2 — a draft experiment is private to its author (and workspace admins).
 *
 * The read policies on api.records are permissive, so the rule is a RESTRICTIVE
 * policy that ANDs with them. Starting an experiment moves it out of draft, which is
 * what makes it visible to the rest of the team.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ensureSessions,
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-000000040000'
const PROJECT = '00000000-0000-4000-8000-000000040001'
const DRAFT = '00000000-0000-4000-8000-000000040002'
const AUTHOR = 'exp032-author'
const MEMBER = 'exp032-member'
const ADMIN = 'exp032-admin' // a second workspace owner: workspace.admin is owner-only

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [AUTHOR, MEMBER, ADMIN]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await ensureSessions(migrator, [AUTHOR, MEMBER, ADMIN])
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'exp032','EXP-03.2')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'member'),($1,$4,'owner')`,
    [WS, AUTHOR, MEMBER, ADMIN],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'E32','Drafts',$3)`,
    [PROJECT, WS, AUTHOR],
  )
  for (const user of [AUTHOR, MEMBER, ADMIN]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJECT,
      userId: user,
      canView: true,
      canEdit: true,
    })
  }
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-PRIVATE','Private draft','draft',$4)`,
    [DRAFT, WS, PROJECT, AUTHOR],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, WS, { session_id: `session-${userId}` })
  return client
}

async function visible(client: Client): Promise<boolean> {
  const { rows } = await client.query(
    'select id from api.records where id=$1',
    [DRAFT],
  )
  return rows.length > 0
}

describe('EXP-03.2 private draft experiments', () => {
  it('shows the draft to its author and to a workspace admin, but not to another member', async () => {
    expect(await visible(await actor(AUTHOR))).toBe(true)
    expect(await visible(await actor(ADMIN))).toBe(true)
    expect(await visible(await actor(MEMBER))).toBe(false)
  })

  it('makes the experiment visible to the team once it leaves draft', async () => {
    await migrator.query(
      `update api.records set status='in_progress' where id=$1`,
      [DRAFT],
    )
    expect(await visible(await actor(MEMBER))).toBe(true)
    await migrator.query(`update api.records set status='draft' where id=$1`, [
      DRAFT,
    ])
    expect(await visible(await actor(MEMBER))).toBe(false)
  })
})
