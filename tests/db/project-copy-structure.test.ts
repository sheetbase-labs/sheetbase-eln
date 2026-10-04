import { randomUUID } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prepareTestDatabase, setActorJwt } from './helpers'

const workspace = randomUUID()
const otherWorkspace = randomUUID()
let migrator: Client
let owner: Client
let reader: Client
let viewer: Client
let outsider: Client
const connections: Client[] = []

beforeAll(async () => {
  const database = await prepareTestDatabase()
  migrator = database.migrator
  await migrator.query(`INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
    ('copy-owner','Lead','copy-owner@test.invalid',true),
    ('copy-reader','Reader','copy-reader@test.invalid',true),
    ('copy-viewer','Viewer','copy-viewer@test.invalid',true),
    ('copy-outsider','Outsider','copy-outsider@test.invalid',true)`)
  await migrator.query(
    'INSERT INTO api.workspaces(id,slug,name) VALUES ($1::uuid,$1::text,$1::text),($2::uuid,$2::text,$2::text)',
    [workspace, otherWorkspace],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
    ($1,'copy-owner','member'),($1,'copy-reader','member'),($1,'copy-viewer','viewer'),($2,'copy-outsider','member')`,
    [workspace, otherWorkspace],
  )
  async function actor(user: string, ws = workspace) {
    const client = await database.asRole('authenticator')
    connections.push(client)
    await client.query('SET ROLE authenticated')
    await setActorJwt(client, user, ws)
    return client
  }
  owner = await actor('copy-owner')
  reader = await actor('copy-reader')
  viewer = await actor('copy-viewer')
  outsider = await actor('copy-outsider', otherWorkspace)
})

afterAll(async () => {
  await Promise.all(connections.map((client) => client.end()))
  await migrator.end()
})

async function source() {
  const result = await owner.query<{ id: string; revision: string }>(
    "SELECT * FROM api.create_project(p_title => 'Source structure',p_lead_user_id => 'copy-owner')",
  )
  const project = result.rows[0]
  const evidence = randomUUID()
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
    VALUES ($1::uuid,$2,$3,'experiment',$1::text,'Existing evidence','copy-owner')`,
    [evidence, workspace, project.id],
  )
  const task = randomUUID()
  await migrator.query(
    `INSERT INTO api.study_tasks(id,workspace_id,project_id,title,task_type,status,progress_percent,due_at,linked_experiment_record_id,created_by_user_id)
    VALUES ($1,$2,$3,'Engineering run','milestone','completed',100,'2026-11-06T12:00:00Z',$4,'copy-owner')`,
    [task, workspace, project.id, evidence],
  )
  await migrator.query(
    `INSERT INTO api.study_deliverables(workspace_id,task_id,name,status,due_at,linked_record_id)
    VALUES ($1,$2,'Transfer pack','delivered','2026-12-04T12:00:00Z',$3)`,
    [workspace, task, evidence],
  )
  return project
}

function copy(
  client: Client,
  project: { id: string; revision: string },
  revision = project.revision,
  clientId: string | null = null,
) {
  return client.query<{ id: string }>(
    `SELECT * FROM api.create_project_from_structure(
    p_source_project_id => $1,p_expected_source_revision => $2,p_title => 'Copied structure',
    p_client_id => $3,p_modality => 'AAV5',p_stage => 'Feasibility',p_lead_user_id => 'copy-owner',
    p_default_reviewer_user_id => 'copy-owner',p_agreement_reference => 'AGR-copy',p_started_on => '2026-08-03')`,
    [project.id, revision, clientId],
  )
}

async function projectCount() {
  return (
    await migrator.query(
      'SELECT count(*)::integer AS count FROM api.projects WHERE workspace_id=$1',
      [workspace],
    )
  ).rows[0].count
}

describe('PROJ-01 atomic copy of canonical project structure', () => {
  it('copies milestones/deliverables with reset completion and no records, study records or evidence', async () => {
    const original = await source()
    const target = (await copy(owner, original)).rows[0]
    expect(target.id).not.toBe(original.id)
    const tasks = await migrator.query(
      'SELECT id,title,status,progress_percent,study_record_id,linked_experiment_record_id FROM api.study_tasks WHERE project_id=$1',
      [target.id],
    )
    expect(tasks.rows).toHaveLength(1)
    expect(tasks.rows[0]).toMatchObject({
      title: 'Engineering run',
      status: 'not_started',
      progress_percent: 0,
      study_record_id: null,
      linked_experiment_record_id: null,
    })
    const deliverables = await migrator.query(
      'SELECT name,status,linked_record_id FROM api.study_deliverables WHERE task_id=$1',
      [tasks.rows[0].id],
    )
    expect(deliverables.rows).toEqual([
      { name: 'Transfer pack', status: 'planned', linked_record_id: null },
    ])
    expect(
      (
        await migrator.query('SELECT id FROM api.records WHERE project_id=$1', [
          target.id,
        ])
      ).rows,
    ).toEqual([])
    expect(
      (
        await migrator.query(
          'SELECT id FROM api.study_tasks WHERE project_id=$1 AND status=$2',
          [original.id, 'completed'],
        )
      ).rows,
    ).toHaveLength(1)
  })

  it('rejects stale source revision atomically', async () => {
    const original = await source(),
      before = await projectCount()
    await expect(
      copy(owner, original, String(Number(original.revision) + 1)),
    ).rejects.toMatchObject({ code: 'SB001' })
    expect(await projectCount()).toBe(before)
  })

  it('rejects another workspace even when its actor can create projects', async () => {
    const original = await source(),
      before = await projectCount()
    await expect(copy(outsider, original)).rejects.toMatchObject({
      code: '42501',
    })
    expect(await projectCount()).toBe(before)
  })

  it('requires explicit source management, not workspace membership/read access', async () => {
    const original = await source(),
      before = await projectCount()
    await expect(copy(reader, original)).rejects.toMatchObject({
      code: '42501',
    })
    expect(await projectCount()).toBe(before)
  })

  it('rejects a read-only caller without creating any target', async () => {
    const original = await source(),
      before = await projectCount()
    await expect(copy(viewer, original)).rejects.toMatchObject({
      code: '42501',
    })
    expect(await projectCount()).toBe(before)
  })

  it('rolls back the entire new project for an invalid target client', async () => {
    const original = await source(),
      before = await projectCount()
    await expect(
      copy(owner, original, original.revision, randomUUID()),
    ).rejects.toMatchObject({ code: '42501' })
    expect(await projectCount()).toBe(before)
  })
})
