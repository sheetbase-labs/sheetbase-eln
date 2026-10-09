/**
 * PROJ-02: moving a milestone's due date records a reason and history; hiding
 * a milestone from the client requires a reason. A viewer is denied.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000190a'
const OWNER = 'proj02-owner'
const VIEWER = 'proj02-viewer'
const TASK = '00000000-0000-4000-8000-000000001901'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','proj02-owner@test.invalid',true),($2,'Viewer','proj02-viewer@test.invalid',true)`,
    [OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'proj02','PROJ02')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer')`,
    [WS, OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.study_tasks(id,workspace_id,title,task_type,status,due_at)
     values ($1,$2,'TFF and polish defined','milestone','not_started','2026-10-16T00:00:00Z')`,
    [TASK, WS],
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

const move = (client: Client, due: string, reason: string) =>
  client.query(
    `select * from api.move_study_task_due($1,null,$2::timestamptz,$3,false)`,
    [TASK, due, reason],
  )

describe('milestone governance', () => {
  it('requires a reason to move a date', async () => {
    const owner = await actor(OWNER, WS)
    await expect(move(owner, '2026-10-23T00:00:00Z', '')).rejects.toMatchObject(
      { code: '22023' },
    )
  })

  it('moves the date and records the change with its reason', async () => {
    const owner = await actor(OWNER, WS)
    const { rows } = await move(
      owner,
      '2026-10-23T00:00:00Z',
      'Material release slipped a week',
    )
    expect(rows[0]!.due_at).toBeTruthy()
    const history = await owner.query(
      `select from_due_at, to_due_at, reason from api.study_task_due_changes where task_id = $1`,
      [TASK],
    )
    expect(history.rows).toHaveLength(1)
    expect(history.rows[0]!.reason).toBe('Material release slipped a week')
    expect(history.rows[0]!.from_due_at).not.toBeNull()
  })

  it('denies a viewer', async () => {
    const viewer = await actor(VIEWER, WS)
    await expect(
      move(viewer, '2026-10-30T00:00:00Z', 'Viewer change'),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('requires a reason to hide a milestone from the client', async () => {
    const owner = await actor(OWNER, WS)
    await owner.query(
      `select api.set_study_task_client_visible($1,null,true,null)`,
      [TASK],
    )
    await expect(
      owner.query(
        `select api.set_study_task_client_visible($1,null,false,null)`,
        [TASK],
      ),
    ).rejects.toMatchObject({ code: '22023' })
    const shown = await owner.query(
      `select client_visible, shared_since from api.study_tasks where id = $1`,
      [TASK],
    )
    expect(shown.rows[0]!.client_visible).toBe(true)
    expect(shown.rows[0]!.shared_since).not.toBeNull()
  })
})
