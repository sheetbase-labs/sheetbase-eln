/**
 * LAB-07 — editing linked protocol text inside a notebook records a deviation.
 *
 * Execution progress is not a deviation; rewriting the pinned step's scientific
 * text is. Deviations carry the frozen and recorded text, the exact protocol
 * version the experiment started on, and an audit event for History and review.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c200'
const OTHER_WS = '00000000-0000-4000-8000-00000000c201'
const PROJECT = '00000000-0000-4000-8000-00000000c202'
const PROTOCOL = '00000000-0000-4000-8000-00000000c203'
const AUTHOR = 'lab07dev-author'
const TECHNICAL = 'lab07dev-technical'
const QA = 'lab07dev-qa'
const VIEWER = 'lab07dev-viewer'
const OUTSIDER = 'lab07dev-outsider'
const ROLES = ['scientist', 'steward', 'reviewer', 'admin', 'owner']
const FROZEN_TEXT = 'Hold at 2-8 C for 14 days.'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [AUTHOR, TECHNICAL, QA, VIEWER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'lab07dev','LAB-07 deviations'),($2,'lab07dev-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'scientist'),($1,$4,'reviewer'),($1,$5,'viewer'),($6,$7,'owner')`,
    [WS, AUTHOR, TECHNICAL, QA, VIEWER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,require_effective_protocol)
     values($1,$2,'LAB07DEV','Deviation project',true)`,
    [PROJECT, WS],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template','PRT-DEV','Deviation protocol','active',$3)`,
    [PROTOCOL, WS, AUTHOR],
  )
  await migrator.query(
    `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
     values($1,'procedure_step',$2::jsonb,1,$3)`,
    [PROTOCOL, JSON.stringify({ text: FROZEN_TEXT, stepNumber: 1 }), AUTHOR],
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: AUTHOR,
    canView: true,
    canEdit: true,
  })
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: VIEWER,
    canView: true,
  })
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string, workspaceId = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, workspaceId)
  return client
}

/** An experiment started on an effective, acknowledged, pinned protocol version. */
async function startedExperiment(): Promise<{ id: string }> {
  const author = await actor(AUTHOR)
  const version = (
    await author.query<{ id: string }>(
      `select id from api.create_protocol_version($1,'Controlled version',null)`,
      [PROTOCOL],
    )
  ).rows[0]!.id
  await author.query(
    `select api.set_protocol_version_status($1,'in_review','Author submission',null)`,
    [version],
  )
  const request = (
    await author.query<{ id: string }>(
      `select id from api.submit_approval_request($1,'protocol_revision',$2,$3,'Author submission',true,2,null)`,
      [WS, version, ROLES],
    )
  ).rows[0]!.id
  const technical = await actor(TECHNICAL)
  await technical.query(`select api.approve_approval_request($1,'Technical review')`, [request])
  const qa = await actor(QA)
  await qa.query(`select api.approve_approval_request($1,'QA approval')`, [request])
  await author.query(
    `select api.set_protocol_version_status($1,'effective','Release',now())`,
    [version],
  )
  await setActorJwt(migrator, AUTHOR, WS)
  await migrator.query(
    `insert into api.project_protocols(workspace_id,project_id,protocol_record_id,protocol_version_id,created_by_user_id)
     values($1,$2,$3,$4,$5)
     on conflict(project_id,protocol_record_id)
     do update set protocol_version_id=excluded.protocol_version_id`,
    [WS, PROJECT, PROTOCOL, version, AUTHOR],
  )
  await author.query('select * from api.acknowledge_protocol_version($1)', [version])

  const record = crypto.randomUUID()
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment',$4,'Deviation experiment','draft',$5)`,
    [record, WS, PROJECT, `EXP-${record}`, AUTHOR],
  )
  const meta = (
    await migrator.query<{ metadata_version: number }>(
      'select metadata_version from api.records where id=$1',
      [record],
    )
  ).rows[0]!.metadata_version
  await author.query('select * from api.start_experiment($1,$2,$3,$4)', [
    record,
    meta,
    version,
    'Begin work',
  ])
  return { id: record }
}

/** Pin the protocol into the experiment and return its copied step blocks. */
async function pinnedSteps(
  experimentId: string,
): Promise<Array<{ id: string; payload: Record<string, unknown>; version: number }>> {
  const author = await actor(AUTHOR)
  const pin = (
    await author.query<{ id: string; version: number }>(
      `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
       values($1,'protocol_reference','{}'::jsonb,1,$2) returning id,version`,
      [experimentId, AUTHOR],
    )
  ).rows[0]!
  const structure = (
    await migrator.query<{ structure_version: number }>(
      'select structure_version from api.records where id=$1',
      [experimentId],
    )
  ).rows[0]!.structure_version
  const result = (
    await author.query<{
      result: { copied_steps: Array<{ id: string; payload: Record<string, unknown>; version: number }> }
    }>(`select api.pin_protocol_reference($1,$2,$3,$4) result`, [
      pin.id,
      PROTOCOL,
      pin.version,
      structure,
    ])
  ).rows[0]!.result
  return result.copied_steps
}

async function editStep(
  client: Client,
  stepId: string,
  payload: Record<string, unknown>,
) {
  return client.query('update api.blocks set payload=$2::jsonb where id=$1', [
    stepId,
    JSON.stringify(payload),
  ])
}

async function deviations(client: Client, recordId: string) {
  return (
    await client.query<{
      frozen_text: string
      recorded_text: string
      protocol_version_id: string | null
      source_step_block_id: string
    }>(
      'select frozen_text,recorded_text,protocol_version_id,source_step_block_id from api.protocol_deviations where record_id=$1 order by created_at,id',
      [recordId],
    )
  ).rows
}

describe('LAB-07 protocol deviations', () => {
  it('records a deviation only when the pinned step text changes', async () => {
    const author = await actor(AUTHOR)
    const experiment = await startedExperiment()
    const [step] = await pinnedSteps(experiment.id)
    expect(step!.payload.text).toBe(FROZEN_TEXT)

    // Execution progress is not a deviation.
    await editStep(author, step!.id, {
      ...step!.payload,
      completed: true,
      note: 'Ran as written',
    })
    expect(await deviations(author, experiment.id)).toEqual([])

    await editStep(author, step!.id, {
      ...step!.payload,
      completed: true,
      note: 'Ran as written',
      text: 'Hold at 2-8 C for 21 days.',
    })
    const recorded = await deviations(author, experiment.id)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      frozen_text: FROZEN_TEXT,
      recorded_text: 'Hold at 2-8 C for 21 days.',
      source_step_block_id: step!.payload.sourceStepBlockId,
    })
    expect(recorded[0]!.protocol_version_id).not.toBeNull()

    // Saving the same text again is not a second deviation.
    await editStep(author, step!.id, {
      ...step!.payload,
      completed: true,
      text: 'Hold at 2-8 C for 21 days.',
    })
    expect(await deviations(author, experiment.id)).toHaveLength(1)

    // Restoring the pinned text is not a new deviation.
    await editStep(author, step!.id, { ...step!.payload, text: FROZEN_TEXT })
    expect(await deviations(author, experiment.id)).toHaveLength(1)

    // A further change is.
    await editStep(author, step!.id, {
      ...step!.payload,
      text: 'Hold at 2-8 C for 28 days.',
    })
    const final = await deviations(author, experiment.id)
    expect(final).toHaveLength(2)
    expect(final[1]).toMatchObject({
      frozen_text: FROZEN_TEXT,
      recorded_text: 'Hold at 2-8 C for 28 days.',
    })
  })

  it('emits an audit event for the deviation', async () => {
    const author = await actor(AUTHOR)
    const experiment = await startedExperiment()
    const [step] = await pinnedSteps(experiment.id)
    await editStep(author, step!.id, {
      ...step!.payload,
      text: 'Deviate from the pinned procedure.',
    })
    const { rows } = await migrator.query<{ payload: Record<string, unknown> }>(
      `select payload from api.change_events
        where entity_type='protocol_deviation' and record_id=$1`,
      [experiment.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.payload).toMatchObject({
      blockId: step!.id,
      frozenText: FROZEN_TEXT,
      recordedText: 'Deviate from the pinned procedure.',
      // The History surface renders captured facts from `changes`.
      changes: {
        text: {
          from: FROZEN_TEXT,
          to: 'Deviate from the pinned procedure.',
          label: 'Protocol step text',
        },
      },
    })
  })

  it('is readable to the experiment viewers only', async () => {
    const author = await actor(AUTHOR)
    const experiment = await startedExperiment()
    const [step] = await pinnedSteps(experiment.id)
    await editStep(author, step!.id, {
      ...step!.payload,
      text: 'A recorded deviation.',
    })
    const viewer = await actor(VIEWER)
    expect(await deviations(viewer, experiment.id)).toHaveLength(1)
    const outsider = await actor(OUTSIDER, OTHER_WS)
    expect(await deviations(outsider, experiment.id)).toEqual([])
  })
})
