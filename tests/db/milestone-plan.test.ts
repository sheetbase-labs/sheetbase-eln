/**
 * R5-CONFIG-05 — the milestone plan's evidence layer.
 *
 * Covers the three claims the plan surface makes: risk is derived by
 * `api.milestone_risks` from the stated rule, a dependency cycle cannot be
 * stored, a moved date records who was notified, and a plan can be started
 * from another project's plan through the canonical milestone RPCs.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-0000000c0500'
const OWNER = 'r5c05-owner'
const VIEWER = 'r5c05-viewer'
const RISK_PROJECT = '00000000-0000-4000-8000-0000000c0501'
const CYCLE_PROJECT = '00000000-0000-4000-8000-0000000c0502'
const SOURCE_PROJECT = '00000000-0000-4000-8000-0000000c0503'
const TARGET_PROJECT = '00000000-0000-4000-8000-0000000c0504'

let counter = 0
const nextId = () =>
  `00000000-0000-4000-8000-0000000c${String(++counter).padStart(4, '0')}`

let riskLate: string
let riskConditionOpen: string
let riskDependencyOpen: string
let riskUnfinishedPredecessor: string
let riskComfortable: string
let riskCompletedLate: string
let riskFarButOpen: string
let cycleA: string
let cycleB: string
let cycleC: string
let sourcePhaseUpstream: string
let sourcePhaseDownstream: string
let sourceCompleted: string
let sourceOpen: string

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  riskLate = nextId()
  riskConditionOpen = nextId()
  riskDependencyOpen = nextId()
  riskUnfinishedPredecessor = nextId()
  riskComfortable = nextId()
  riskCompletedLate = nextId()
  riskFarButOpen = nextId()
  cycleA = nextId()
  cycleB = nextId()
  cycleC = nextId()
  sourcePhaseUpstream = nextId()
  sourcePhaseDownstream = nextId()
  sourceCompleted = nextId()
  sourceOpen = nextId()

  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified")
     values ($1,'Owner','r5c05-owner@test.invalid',true),($2,'Viewer','r5c05-viewer@test.invalid',true)`,
    [OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'r5c05','R5-CONFIG-05')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role)
     values ($1,$2,'owner'),($1,$3,'viewer')`,
    [WS, OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values
      ($1,$5,'RISK','Risk derivation',$6),
      ($2,$5,'CYC','Cycle refusal',$6),
      ($3,$5,'SRC','Source plan',$6),
      ($4,$5,'TGT','Target plan',$6)`,
    [RISK_PROJECT, CYCLE_PROJECT, SOURCE_PROJECT, TARGET_PROJECT, WS, OWNER],
  )
  // SET-02: reading a project's tasks needs project access, not just
  // workspace membership. The viewer can read the risk project only.
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: RISK_PROJECT,
    userId: VIEWER,
    canView: true,
    canEdit: false,
  })

  // Risk fixtures: one milestone per risk state, plus the 14-day boundary.
  await migrator.query(
    `insert into api.study_tasks
       (id,workspace_id,project_id,title,task_type,status,due_at)
     values
       ($1,$8,$9,'Late milestone','milestone','not_started', now() - interval '2 days'),
       ($2,$8,$9,'Condition open','milestone','not_started', now() + interval '5 days'),
       ($3,$8,$9,'Dependency open','milestone','not_started', now() + interval '5 days'),
       ($4,$8,$9,'Unfinished predecessor','milestone','not_started', now() + interval '40 days'),
       ($5,$8,$9,'Comfortable','milestone','not_started', now() + interval '40 days'),
       ($6,$8,$9,'Completed late','milestone','completed', now() - interval '10 days'),
       ($7,$8,$9,'Far but open','milestone','not_started', now() + interval '20 days')`,
    [
      riskLate,
      riskConditionOpen,
      riskDependencyOpen,
      riskUnfinishedPredecessor,
      riskComfortable,
      riskCompletedLate,
      riskFarButOpen,
      WS,
      RISK_PROJECT,
    ],
  )
  await migrator.query(
    `insert into api.study_deliverables(workspace_id,task_id,name,status)
     values ($1,$2,'Batch record signed','planned'),
            ($1,$3,'Deviation closed','planned')`,
    [WS, riskConditionOpen, riskFarButOpen],
  )
  await migrator.query(
    `insert into api.study_task_dependencies
       (workspace_id, predecessor_id, successor_id, dependency_type, lag_days)
     values ($1,$2,$3,'finish_to_start',0)`,
    [WS, riskUnfinishedPredecessor, riskDependencyOpen],
  )

  // Cycle fixtures.
  await migrator.query(
    `insert into api.study_tasks
       (id,workspace_id,project_id,title,task_type,status,due_at)
     values ($1,$4,$5,'A','milestone','not_started', now() + interval '10 days'),
            ($2,$4,$5,'B','milestone','not_started', now() + interval '20 days'),
            ($3,$4,$5,'C','milestone','not_started', now() + interval '30 days')`,
    [cycleA, cycleB, cycleC, WS, CYCLE_PROJECT],
  )

  // Template fixture: two phases, a completed client-visible milestone and an
  // open internal one, each with a condition.
  await migrator.query(
    `insert into api.study_workstreams(id,workspace_id,project_id,name,position)
     values ($1,$3,$4,'Upstream',1),($2,$3,$4,'Downstream',2)`,
    [sourcePhaseUpstream, sourcePhaseDownstream, WS, SOURCE_PROJECT],
  )
  await migrator.query(
    `insert into api.study_tasks
       (id,workspace_id,project_id,workstream_id,title,task_type,status,due_at,
        client_visible,shared_since,position)
     values
       ($1,$3,$4,$5,'Clone selected','milestone','completed','2026-10-05T00:00:00Z',true,now(),1),
       ($2,$3,$4,$6,'Release locked','milestone','not_started','2026-10-20T00:00:00Z',false,null,2)`,
    [
      sourceCompleted,
      sourceOpen,
      WS,
      SOURCE_PROJECT,
      sourcePhaseUpstream,
      sourcePhaseDownstream,
    ],
  )
  await migrator.query(
    `insert into api.study_deliverables(workspace_id,task_id,name,status,linked_record_identifier)
     values ($1,$2,'Clone sequence confirmed','delivered','DS-0001'),
            ($1,$3,'Release specification approved','planned',null)`,
    [WS, sourceCompleted, sourceOpen],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(user: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, user, WS)
  return client
}

describe('R5-CONFIG-05 milestone risk', () => {
  it('derives each risk state from the stated rule', async () => {
    const owner = await actor(OWNER)
    const { rows } = await owner.query<{
      title: string
      risk: string
      late: boolean
      conditions_open: number
      unfinished_dependencies: number
      blocking_title: string | null
      risk_reason: string
    }>(
      `select t.title, r.risk, r.late, r.conditions_open, r.unfinished_dependencies,
              r.blocking_title, r.risk_reason
         from api.milestone_risks r
         join api.study_tasks t on t.id = r.task_id
        where r.project_id = $1`,
      [RISK_PROJECT],
    )
    const byTitle = new Map(rows.map((row) => [row.title, row]))
    expect(byTitle.get('Late milestone')?.risk).toBe('late')
    expect(byTitle.get('Late milestone')?.late).toBe(true)
    expect(byTitle.get('Completed late')?.risk).toBe('done')
    expect(byTitle.get('Condition open')?.risk).toBe('at_risk')
    expect(byTitle.get('Condition open')?.conditions_open).toBe(1)
    expect(byTitle.get('Condition open')?.risk_reason).toContain(
      'Due within 14 days',
    )
    expect(byTitle.get('Dependency open')?.risk).toBe('at_risk')
    expect(byTitle.get('Dependency open')?.unfinished_dependencies).toBe(1)
    expect(byTitle.get('Dependency open')?.blocking_title).toBe(
      'Unfinished predecessor',
    )
    // Due in 20 days with an open condition is outside the 14-day window.
    expect(byTitle.get('Far but open')?.risk).toBe('on_track')
    expect(byTitle.get('Comfortable')?.risk).toBe('on_track')
  })

  it('reads the derived risk as a viewer', async () => {
    const viewer = await actor(VIEWER)
    const { rows } = await viewer.query(
      `select task_id from api.milestone_risks where project_id = $1`,
      [RISK_PROJECT],
    )
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('R5-CONFIG-05 dependency cycles', () => {
  it('refuses a direct and a transitive cycle', async () => {
    const owner = await actor(OWNER)
    await owner.query(
      `select api.create_dependency($1,$2,$3,'finish_to_start',0,false)`,
      [WS, cycleA, cycleB],
    )
    await expectDenied(
      owner.query(
        `select api.create_dependency($1,$2,$3,'finish_to_start',0,false)`,
        [WS, cycleB, cycleA],
      ),
      'SB029',
    )
    await owner.query(
      `select api.create_dependency($1,$2,$3,'finish_to_start',0,false)`,
      [WS, cycleB, cycleC],
    )
    await expectDenied(
      owner.query(
        `select api.create_dependency($1,$2,$3,'finish_to_start',0,false)`,
        [WS, cycleC, cycleA],
      ),
      'SB029',
    )
  })

  it('cannot be stored by writing the dependency table directly', async () => {
    const owner = await actor(OWNER)
    await expectDenied(
      owner.query(
        `insert into api.study_task_dependencies
           (workspace_id, predecessor_id, successor_id)
         values ($1,$2,$3)`,
        [WS, cycleC, cycleA],
      ),
      '42501',
    )
  })
})

describe('R5-CONFIG-05 date history', () => {
  it('records who was notified when a date moves, and refuses a stale version', async () => {
    const owner = await actor(OWNER)
    const { rows: created } = await owner.query<{ id: string }>(
      `select (api.create_study_task(
         p_workspace_id => $1,
         p_title => 'Client date',
         p_task_type => 'milestone',
         p_project_id => $2,
         p_due_at => '2026-10-16T00:00:00Z'::timestamptz)).id as id`,
      [WS, CYCLE_PROJECT],
    )
    const task = created[0]!.id
    await owner.query(
      `select api.set_study_task_client_visible($1,null,true,null)`,
      [task],
    )
    const { rows: version } = await owner.query<{ metadata_version: number }>(
      `select metadata_version from api.study_tasks where id = $1`,
      [task],
    )
    await owner.query(
      `select api.move_study_task_due($1,$2,'2026-10-23T00:00:00Z'::timestamptz,'Material release slipped a week',true)`,
      [task, version[0]!.metadata_version],
    )
    const { rows: history } = await owner.query<{
      to_due_at: Date
      reason: string
      client_notified: boolean
      changed_by_user_id: string
    }>(
      `select to_due_at, reason, client_notified, changed_by_user_id
         from api.study_task_due_changes where task_id = $1`,
      [task],
    )
    expect(history).toHaveLength(1)
    expect(history[0]!.reason).toBe('Material release slipped a week')
    expect(history[0]!.client_notified).toBe(true)
    expect(history[0]!.changed_by_user_id).toBe(OWNER)
    expect(history[0]!.to_due_at.toISOString().slice(0, 10)).toBe('2026-10-23')

    // The UI's stale banner hangs off this: the old version loses the race.
    await expectDenied(
      owner.query(
        `select api.move_study_task_due($1,$2,'2026-10-30T00:00:00Z'::timestamptz,'Second change',false)`,
        [task, version[0]!.metadata_version],
      ),
      'SB001',
    )
  })
})

describe('R5-CONFIG-05 start from a template', () => {
  it('copies phases, milestones and conditions with dates offset from the start date', async () => {
    const owner = await actor(OWNER)
    const { rows } = await owner.query<{ result: Record<string, number> }>(
      `select api.create_plan_from_project($1,$2,'2026-11-02'::date) as result`,
      [TARGET_PROJECT, SOURCE_PROJECT],
    )
    expect(rows[0]!.result).toMatchObject({
      phases: 2,
      milestones: 2,
      conditions: 2,
    })

    const { rows: copied } = await migrator.query<{
      title: string
      status: string
      due_at: Date
      client_visible: boolean
      workstream: string | null
    }>(
      `select t.title, t.status, t.due_at, t.client_visible, w.name as workstream
         from api.study_tasks t
         left join api.study_workstreams w on w.id = t.workstream_id
        where t.project_id = $1 order by t.position`,
      [TARGET_PROJECT],
    )
    expect(copied.map((row) => row.title)).toEqual([
      'Clone selected',
      'Release locked',
    ])
    expect(copied.map((row) => row.due_at.toISOString().slice(0, 10))).toEqual([
      '2026-11-02',
      '2026-11-17',
    ])
    expect(copied.map((row) => row.status)).toEqual([
      'not_started',
      'not_started',
    ])
    expect(copied[0]!.client_visible).toBe(true)
    expect(copied.map((row) => row.workstream)).toEqual([
      'Upstream',
      'Downstream',
    ])

    const { rows: conditions } = await migrator.query<{
      status: string
      linked_record_identifier: string | null
    }>(
      `select d.status, d.linked_record_identifier
         from api.study_deliverables d
         join api.study_tasks t on t.id = d.task_id
        where t.project_id = $1`,
      [TARGET_PROJECT],
    )
    expect(conditions).toHaveLength(2)
    expect(conditions.map((row) => row.status)).toEqual(['planned', 'planned'])
    expect(
      conditions.every((row) => row.linked_record_identifier === null),
    ).toBe(true)

    // The source plan is untouched: completion is not reset there.
    const { rows: source } = await migrator.query<{ status: string }>(
      `select status from api.study_tasks where id = $1`,
      [sourceCompleted],
    )
    expect(source[0]!.status).toBe('completed')
  })

  it('refuses a viewer, an unknown source and itself', async () => {
    const viewer = await actor(VIEWER)
    await expectDenied(
      viewer.query(
        `select api.create_plan_from_project($1,$2,'2026-11-02'::date)`,
        [TARGET_PROJECT, SOURCE_PROJECT],
      ),
      '42501',
    )
    const owner = await actor(OWNER)
    await expectDenied(
      owner.query(
        `select api.create_plan_from_project($1,$2,'2026-11-02'::date)`,
        [TARGET_PROJECT, '00000000-0000-4000-8000-0000000c0599'],
      ),
      'SB026',
    )
    await expectDenied(
      owner.query(
        `select api.create_plan_from_project($1,$1,'2026-11-02'::date)`,
        [TARGET_PROJECT],
      ),
      '22023',
    )
  })
})
