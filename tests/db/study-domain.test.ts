import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-000000005800'
const WS_B = '00000000-0000-4000-8000-000000005801'
const PROJECT_A = '00000000-0000-4000-8000-000000005810'
const PROJECT_A_2 = '00000000-0000-4000-8000-000000005811'
const PROJECT_B = '00000000-0000-4000-8000-000000005812'
const MEMBER_A = 'study-domain-member-a'
const OWNER_A = 'study-domain-owner-a'
const OWNER_B = 'study-domain-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId = WS_A): Promise<Client> {
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

async function createStudy(
  client: Client,
  title: string,
  homeProjectId: string | null = null,
) {
  const { rows } = await client.query(
    `select * from api.create_study($1,$2,$3,'A stable fixture','2026-08-01','2026-08-31','{}')`,
    [WS_A, title, homeProjectId],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER_A}','Study owner A','study-owner-a@test.invalid',true),
      ('${MEMBER_A}','Study member A','study-member-a@test.invalid',true),
      ('${OWNER_B}','Study owner B','study-owner-b@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS_A}','study-domain-a','Study domain A'),
      ('${WS_B}','study-domain-b','Study domain B');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS_A}','${OWNER_A}','owner'),('${WS_A}','${MEMBER_A}','member'),
      ('${WS_B}','${OWNER_B}','owner');
    insert into api.projects(id,workspace_id,key,title,lead_user_id) values
      ('${PROJECT_A}','${WS_A}','study-a','Study A','${OWNER_A}'),
      ('${PROJECT_A_2}','${WS_A}','study-a2','Study A2','${OWNER_A}'),
      ('${PROJECT_B}','${WS_B}','study-b','Study B','${OWNER_B}')`)
  await grantProjectAccess(migrator, {
    workspaceId: WS_A,
    projectId: PROJECT_A,
    userId: MEMBER_A,
    canView: true,
    canEdit: true,
  })
  await grantProjectAccess(migrator, {
    workspaceId: WS_A,
    projectId: PROJECT_A_2,
    userId: MEMBER_A,
    canView: true,
    canEdit: true,
  })

  const owner = await actor(OWNER_A)
  const { rows } = await owner.query(
    `select * from api.create_model_field($1,'study','programme_code','Programme code','text',false,'"AUTO"','{}')`,
    [WS_A],
  )
  await owner.query(`select api.activate_model_field($1)`, [rows[0].id])
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('Study domain', () => {
  it('lets an authenticated member atomically create a notebook-backed Study with defaults and a home Project', async () => {
    const member = await actor(MEMBER_A)
    const study = await createStudy(member, '  Stability study  ', PROJECT_A)

    expect(study).toMatchObject({
      workspace_id: WS_A,
      project_id: PROJECT_A,
      kind: 'study',
      identifier: expect.stringMatching(/^STD-\d{4}$/),
      title: 'Stability study',
      custom_fields: { programme_code: 'AUTO' },
    })
    const { rows } = await migrator.query(
      `select r.kind,s.workspace_id,sp.relationship
         from api.records r join api.studies s on s.record_id=r.id
         join api.study_projects sp on sp.study_record_id=r.id
        where r.id=$1`,
      [study.id],
    )
    expect(rows).toEqual([
      { kind: 'study', workspace_id: WS_A, relationship: 'home' },
    ])

    await expect(
      createStudy(member, 'Wrong home Project', PROJECT_B),
    ).rejects.toMatchObject({ code: '42501' })
    expect(
      Number(
        (
          await migrator.query(
            `select count(*) n from api.records where title='Wrong home Project'`,
          )
        ).rows[0].n,
      ),
    ).toBe(0)
  })

  it('denies cross-workspace creation and enforces Project and Experiment link identity', async () => {
    const member = await actor(MEMBER_A)
    const study = await createStudy(member, 'Link identity')
    const { rows: records } = await migrator.query(
      `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id) values
       ($1,$2,'experiment','EXP-2026-5801','Experiment A',$4),
       ($1,$2,'report','RPT-2026-5801','Report A',$4),
       ($3,$5,'experiment','EXP-2026-5802','Experiment B',$6)
       returning id,kind,workspace_id`,
      [WS_A, PROJECT_A, WS_B, OWNER_A, PROJECT_B, OWNER_B],
    )
    const experimentA = records.find(
      (row) => row.kind === 'experiment' && row.workspace_id === WS_A,
    )!
    const reportA = records.find((row) => row.kind === 'report')!
    const experimentB = records.find((row) => row.workspace_id === WS_B)!

    await member.query(`select api.link_study_project($1,$2,'participating')`, [
      study.id,
      PROJECT_A_2,
    ])
    await member.query(`select api.link_study_experiment($1,$2,'primary')`, [
      study.id,
      experimentA.id,
    ])
    await expect(
      member.query(`select api.link_study_project($1,$2,'participating')`, [
        study.id,
        PROJECT_B,
      ]),
      // The 0323 entry guard fails closed before the workspace/link validation.
    ).rejects.toMatchObject({ code: '42501' })
    // A same-workspace non-experiment Record fails validation...
    await expect(
      member.query(`select api.link_study_experiment($1,$2)`, [
        study.id,
        reportA.id,
      ]),
    ).rejects.toMatchObject({ code: 'SB073' })
    // ...while another workspace's Record is denied before validation.
    await expect(
      member.query(`select api.link_study_experiment($1,$2)`, [
        study.id,
        experimentB.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })

    const ownerB = await actor(OWNER_B, WS_B)
    await expect(
      ownerB.query(`select * from api.create_study($1,'Foreign Study')`, [
        WS_A,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('assigns planner entities, snapshots the complete plan and keeps snapshots immutable', async () => {
    const member = await actor(MEMBER_A)
    const study = await createStudy(member, 'Planner Study')
    const { rows: workstreams } = await member.query(
      `select * from api.create_study_workstream($1,'Assay development')`,
      [WS_A],
    )
    const { rows: tasks } = await member.query(
      `select * from api.create_study_task($1,'Run assay','task',$2,null,null,'not_started','medium','2026-08-10','2026-08-11')`,
      [WS_A, workstreams[0].id],
    )
    await member.query(`select api.assign_planner_item_to_study($1,$2,null)`, [
      study.id,
      workstreams[0].id,
    ])
    const assigned = await migrator.query(
      `select (select study_record_id from api.study_workstreams where id=$1) workstream_study,
              (select study_record_id from api.study_tasks where id=$2) task_study`,
      [workstreams[0].id, tasks[0].id],
    )
    expect(assigned.rows[0]).toEqual({
      workstream_study: study.id,
      task_study: study.id,
    })

    const { rows } = await member.query(
      `select * from api.snapshot_study_plan($1,'Baseline plan')`,
      [study.id],
    )
    const snapshot = rows[0]
    expect(snapshot.snapshot.workstreams).toHaveLength(1)
    expect(snapshot.snapshot.tasks).toHaveLength(1)
    expect(snapshot.checksum).toMatch(/^[0-9a-f]{64}$/)
    const digest = await migrator.query(
      `select internal.revision_integrity_digest($1::jsonb) checksum`,
      [snapshot.snapshot],
    )
    expect(digest.rows[0].checksum).toBe(snapshot.checksum)
    await expect(
      migrator.query(
        `update api.study_plan_snapshots set reason='changed' where id=$1`,
        [snapshot.id],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
    await expect(
      migrator.query(`delete from api.study_plan_snapshots where id=$1`, [
        snapshot.id,
      ]),
    ).rejects.toMatchObject({ code: 'SB072' })
  })

  it('supports optimistic edits and rejects stale or locked Study edits', async () => {
    const member = await actor(MEMBER_A)
    const study = await createStudy(member, 'Editable Study')
    const { rows } = await member.query(
      `select * from api.edit_study($1,1,'Edited Study','active','Edited summary','2026-08-02','2026-08-30','{"programme_code":"LATE"}')`,
      [study.id],
    )
    expect(rows[0]).toMatchObject({
      title: 'Edited Study',
      metadata_version: 2,
    })
    await expect(
      member.query(
        `select * from api.edit_study($1,1,'Stale','active',null,null,null,null)`,
        [study.id],
      ),
    ).rejects.toMatchObject({ code: 'SB001' })
    const { rows: revisions } = await migrator.query(
      `insert into api.revisions(record_id,structure_version,metadata_version,metadata_snapshot,block_snapshot,reason,created_by_user_id)
       values($1,1,2,'{}','[]','manual',$2) returning id`,
      [study.id, OWNER_A],
    )
    await migrator.query(
      `update api.records set locked_at=now(),locked_by_revision_id=$2 where id=$1`,
      [study.id, revisions[0].id],
    )
    await expect(
      member.query(
        `select * from api.edit_study($1,2,'Locked','active',null,null,null,null)`,
        [study.id],
      ),
    ).rejects.toMatchObject({ code: 'SB011' })
  })
})
