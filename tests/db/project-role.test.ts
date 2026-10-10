/**
 * PROJ-03.1 — project_role records what a person does on the project while access_level
 * stays the permission. The role is descriptive and optional, so the permission flags
 * are unchanged and every existing caller keeps working.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-000000091000'
const PROJECT = '00000000-0000-4000-8000-000000091001'
const LEADER = 'proj031-leader'
const SCIENTIST = 'proj031-scientist'
const PLAIN = 'proj031-plain'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [LEADER, SCIENTIST, PLAIN]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'proj031','PROJ-03.1')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, LEADER],
  )
  for (const user of [SCIENTIST, PLAIN]) {
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'member')`,
      [WS, user],
    )
  }
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'P31','Roles',$3)`,
    [PROJECT, WS, LEADER],
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
  await setActorJwt(client, userId, WS)
  return client
}

async function roleOf(userId: string): Promise<string | null> {
  const { rows } = await migrator.query<{
    project_role: string | null
    can_edit: boolean
  }>(
    `select project_role, can_edit from api.project_access where project_id=$1 and user_id=$2`,
    [PROJECT, userId],
  )
  return rows[0]?.project_role ?? null
}

describe('PROJ-03.1 project_role', () => {
  it('records the role alongside the permission without changing the flags', async () => {
    const leader = await actor(LEADER)
    const { rows } = await leader.query<{
      result: { project_role: string | null }
    }>(
      `select to_jsonb(api.grant_project_access($1,$2,$3,'editor','scientist')) as result`,
      [WS, PROJECT, SCIENTIST],
    )
    expect(rows[0]!.result.project_role).toBe('scientist')
    expect(await roleOf(SCIENTIST)).toBe('scientist')
    const flags = await migrator.query<{
      can_edit: boolean
      can_view: boolean
    }>(
      `select can_edit, can_view from api.project_access where project_id=$1 and user_id=$2`,
      [PROJECT, SCIENTIST],
    )
    expect(flags.rows[0]).toEqual({ can_edit: true, can_view: true })
  })

  it('leaves the role unset for callers that only pass a permission', async () => {
    const leader = await actor(LEADER)
    await leader.query(`select api.grant_project_access($1,$2,$3,'viewer')`, [
      WS,
      PROJECT,
      PLAIN,
    ])
    expect(await roleOf(PLAIN)).toBeNull()
  })

  it('refuses a role outside the agreed vocabulary', async () => {
    const leader = await actor(LEADER)
    await expectDenied(
      leader.query(
        `select api.grant_project_access($1,$2,$3,'viewer','chief')`,
        [WS, PROJECT, PLAIN],
      ),
      '22023',
    )
  })

  it('returns the project role from project_members for the members tab', async () => {
    const leader = await actor(LEADER)
    const { rows } = await leader.query<{ project_role: string | null }>(
      `select project_role from api.project_members($1) where user_id=$2`,
      [PROJECT, SCIENTIST],
    )
    expect(rows[0]?.project_role).toBe('scientist')
    const plain = await leader.query<{ project_role: string | null }>(
      `select project_role from api.project_members($1) where user_id=$2`,
      [PROJECT, PLAIN],
    )
    expect(plain.rows[0]?.project_role).toBeNull()
  })

  it('refuses a caller from another workspace', async () => {
    const outsider = await actor(PLAIN)
    await expectDenied(
      outsider.query(
        `select api.grant_project_access($1,$2,$3,'owner','lead')`,
        ['00000000-0000-4000-8000-0000000910ff', PROJECT, PLAIN],
      ),
      '42501',
    )
  })
})
