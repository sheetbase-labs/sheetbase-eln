/**
 * PROJ-02.2 — milestone RPCs over the existing planner model.
 *
 * The decision recorded in the task is that milestones reuse api.study_deliverables
 * rather than a second planning model. These RPCs give it the operations the project
 * page needs: create, update, reorder within the owning task, and link evidence.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-000000090000'
const PROJECT = '00000000-0000-4000-8000-000000090001'
const RECORD = '00000000-0000-4000-8000-000000090002'
const OWNER = 'proj022-owner'
const OUTSIDER = 'proj022-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let taskId: string
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'proj022','PROJ-02.2')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'P22','Milestones',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-P22','Evidence record','in_progress',$4)`,
    [RECORD, WS, PROJECT, OWNER],
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

async function createMilestone(client: Client, name: string): Promise<string> {
  if (!taskId) {
    const task = await client.query<{ id: string }>(
      `select (api.create_study_task($1,'Milestone task','task',null,$2,null,'not_started','medium',
                '2026-10-01T00:00:00Z'::timestamptz,'2026-11-30T00:00:00Z'::timestamptz)).id as id`,
      [WS, PROJECT],
    )
    taskId = task.rows[0]!.id
  }
  const { rows } = await client.query<{
    result: { id: string; position: number }
  }>(`select api.create_study_deliverable($1,$2) as result`, [taskId, name])
  return rows[0]!.result.id
}

async function positions(): Promise<Array<{ name: string; position: number }>> {
  const { rows } = await migrator.query<{ name: string; position: number }>(
    `select name, position from api.study_deliverables where task_id=$1 order by position`,
    [taskId],
  )
  return rows
}

describe('PROJ-02.2 milestone RPCs', () => {
  it('creates milestones in order and reorders them', async () => {
    const owner = await actor(OWNER)
    const first = await createMilestone(owner, 'Upstream process locked')
    const second = await createMilestone(owner, 'Clarification train selected')
    expect((await positions()).map((row) => row.name)).toEqual([
      'Upstream process locked',
      'Clarification train selected',
    ])

    await owner.query('select api.reorder_study_deliverables($1,$2::uuid[])', [
      taskId,
      [second, first],
    ])
    expect((await positions()).map((row) => row.name)).toEqual([
      'Clarification train selected',
      'Upstream process locked',
    ])
  })

  it('updates status and target date, and links evidence with its identifier', async () => {
    const owner = await actor(OWNER)
    const [milestone] = await positions()
    const { rows } = await migrator.query<{ id: string }>(
      `select id from api.study_deliverables where task_id=$1 order by position limit 1`,
      [taskId],
    )
    const id = rows[0]!.id

    const updated = await owner.query<{
      result: { status: string; dueAt: string | null }
    }>(
      `select api.update_study_deliverable($1,null,null,'delivered','2026-10-20T00:00:00Z') as result`,
      [id],
    )
    expect(updated.rows[0]!.result.status).toBe('delivered')
    expect(updated.rows[0]!.result.dueAt).not.toBeNull()

    const linked = await owner.query<{
      result: { linkedRecordIdentifier: string }
    }>(`select api.link_study_deliverable_evidence($1,$2) as result`, [
      id,
      RECORD,
    ])
    expect(linked.rows[0]!.result.linkedRecordIdentifier).toBe('EXP-P22')
    expect(milestone).toBeDefined()
  })

  it('refuses a caller without workspace write authority', async () => {
    const outsider = await actor(OUTSIDER)
    await expectDenied(
      outsider.query(
        `select api.create_study_deliverable($1,'Sneaky milestone')`,
        [taskId],
      ),
      '42501',
    )
  })

  it('refuses reordering a milestone that belongs to another task', async () => {
    const owner = await actor(OWNER)
    await expectDenied(
      owner.query('select api.reorder_study_deliverables($1,$2::uuid[])', [
        taskId,
        ['00000000-0000-4000-8000-0000000900ff'],
      ]),
      '22023',
    )
  })
})
