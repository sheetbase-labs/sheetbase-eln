/**
 * Sample workflows: an admin defines steps, where a sample may go next, what
 * must be filled in, and what happens on arrival. Moves are checked by the
 * database, automations are recorded and never block a move.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000006900aa'
const PROJ = '00000000-0000-4000-8000-0000006900bb'
const OWNER = 'wf-owner'
const STEWARD = 'wf-steward'
const VIEWER = 'wf-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function sample(
  client: Client,
  title: string,
  props: Record<string, unknown> = {},
) {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid,'sample',$2,'available',ARRAY[]::text[],$3::jsonb)`,
    [PROJ, title, JSON.stringify(props)],
  )
  return rows[0] as { id: string }
}

const definition = (over: Record<string, unknown> = {}) => ({
  name: 'Intake and QC',
  sampleType: 'Plasma',
  autoEnrol: false,
  stages: [
    {
      key: 'recv',
      name: 'Received',
      turnaroundDays: 2,
      next: ['qc'],
      actions: [{ kind: 'notify', to: 'role:steward', message: 'New sample' }],
    },
    {
      key: 'qc',
      name: 'In QC',
      requiredFields: ['storageLocation'],
      next: ['pass', 'recv'],
      actions: [{ kind: 'set_field', key: 'barcode', value: 'QC-PENDING' }],
    },
    {
      key: 'pass',
      name: 'Passed',
      final: true,
      next: [],
      actions: [{ kind: 'start_experiment', templateId: null }],
    },
  ],
  ...over,
})

async function save(client: Client, id: string | null, def: unknown) {
  const { rows } = await client.query(
    `SELECT api.save_sample_workflow($1::uuid,$2::jsonb) AS id`,
    [id, JSON.stringify(def)],
  )
  return rows[0].id as string
}

async function stages(client: Client, wf: string) {
  const { rows } = await client.query(
    `SELECT id, name FROM api.sample_workflow_stages WHERE workflow_id=$1 ORDER BY position`,
    [wf],
  )
  return rows as { id: string; name: string }[]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}','O','wf-o@sheetbase.test',true),
      ('${STEWARD}','S','wf-s@sheetbase.test',true),
      ('${VIEWER}','V','wf-v@sheetbase.test',true);
     INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}','wf-ws','WF');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}','${OWNER}','owner'),('${WS}','${STEWARD}','steward'),('${WS}','${VIEWER}','viewer');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id)
      VALUES ('${PROJ}','${WS}','wf-ws','WF','${OWNER}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('sample workflows', () => {
  it('lets a manager save a workflow and refuses a viewer', async () => {
    const viewer = await actor(VIEWER)
    await expect(save(viewer, null, definition())).rejects.toThrow(/not permitted/)
    const owner = await actor(OWNER)
    const id = await save(owner, null, definition())
    const list = await stages(owner, id)
    expect(list.map((s) => s.name)).toEqual(['Received', 'In QC', 'Passed'])
    const { rows } = await owner.query(
      `SELECT count(*)::int n FROM api.sample_workflow_transitions WHERE workflow_id=$1`,
      [id],
    )
    expect(rows[0].n).toBe(3)
  })

  it('moves a sample along allowed steps, checks fields and records automation', async () => {
    const owner = await actor(OWNER)
    const steward = await actor(STEWARD)
    const wf = await save(owner, null, definition({ name: 'Moves' }))
    const [recv, qc, pass] = await stages(owner, wf)
    const s = await sample(owner, 'Plasma 1', { sampleType: 'Plasma' })
    const { rows } = await owner.query(
      `SELECT * FROM api.enrol_sample_in_workflow($1,$2)`,
      [s.id, wf],
    )
    const run = rows[0]
    expect(run.stage_id).toBe(recv.id)
    expect(run.due_at).not.toBeNull()
    const notified = await migrator.query(
      `SELECT count(*)::int n FROM internal.notifications WHERE record_id=$1 AND user_id=$2`,
      [s.id, STEWARD],
    )
    expect(notified.rows[0].n).toBe(1)

    // Cannot skip a step.
    await expect(
      owner.query(`SELECT api.advance_sample_workflow($1,$2,NULL)`, [run.id, pass.id]),
    ).rejects.toThrow(/cannot move/)
    // Missing required field blocks entry to QC.
    await expect(
      owner.query(`SELECT api.advance_sample_workflow($1,$2,NULL)`, [run.id, qc.id]),
    ).rejects.toThrow(/storageLocation/)
    await migrator.query(
      `UPDATE api.records SET properties = properties || '{"storageLocation":"F1"}' WHERE id=$1`,
      [s.id],
    )
    const moved = await steward.query(
      `SELECT api.advance_sample_workflow($1,$2,'go') AS r`,
      [run.id, qc.id],
    )
    expect(moved.rows[0].r.automation[0]).toMatchObject({ kind: 'set_field', outcome: 'done' })
    const after = await owner.query(
      `SELECT properties->>'barcode' q FROM api.records WHERE id=$1`,
      [s.id],
    )
    expect(after.rows[0].q).toBe('QC-PENDING')

    // A failing automation is recorded, the move still happens and finishes the run.
    const fin = await owner.query(
      `SELECT api.advance_sample_workflow($1,$2,NULL) AS r`,
      [run.id, pass.id],
    )
    expect(fin.rows[0].r.run.completed_at).not.toBeNull()
    expect(fin.rows[0].r.automation[0]).toMatchObject({ kind: 'start_experiment', outcome: 'failed' })
    const events = await owner.query(
      `SELECT to_stage_name FROM api.sample_workflow_events WHERE run_id=$1 ORDER BY created_at, id`,
      [run.id],
    )
    expect(events.rows.map((e) => e.to_stage_name)).toEqual(['Received', 'In QC', 'Passed'])
  })

  it('keeps samples in a step that is edited and refuses removing an occupied one', async () => {
    const owner = await actor(OWNER)
    const wf = await save(owner, null, definition({ name: 'Edits' }))
    const list = await stages(owner, wf)
    const s = await sample(owner, 'Plasma 2', { sampleType: 'Plasma' })
    await owner.query(`SELECT * FROM api.enrol_sample_in_workflow($1,$2)`, [s.id, wf])
    const renamed = definition({ name: 'Edits' }) as { stages: Record<string, unknown>[] }
    renamed.stages[0] = { ...renamed.stages[0], id: list[0].id, name: 'Arrived' }
    await save(owner, wf, renamed)
    expect((await stages(owner, wf))[0].id).toBe(list[0].id)
    renamed.stages[0] = { ...renamed.stages[1], id: list[1].id, key: 'qc2', next: [] }
    renamed.stages.splice(1, 1)
    await expect(save(owner, wf, { ...renamed, stages: renamed.stages.slice(1) })).rejects.toThrow()
  })

  it('starts matching new samples by itself and ignores other types', async () => {
    const owner = await actor(OWNER)
    const wf = await save(owner, null, definition({ name: 'Auto', sampleType: 'Serum', autoEnrol: true }))
    const hit = await sample(owner, 'Serum 1', { sampleType: 'Serum' })
    const miss = await sample(owner, 'Plasma 3', { sampleType: 'Plasma' })
    const runs = await owner.query(
      `SELECT record_id FROM api.sample_workflow_runs WHERE workflow_id=$1`,
      [wf],
    )
    expect(runs.rows.map((r) => r.record_id)).toEqual([hit.id])
    expect(miss.id).toBeTruthy()
  })
})
