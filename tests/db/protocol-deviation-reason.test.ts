/**
 * A person can say why a step deviated from its pinned protocol. The reason is
 * stored on the deviation with who wrote it and when, reaches the audit trail as
 * a before/after pair, and is refused for viewers, outsiders, empty text and
 * signed experiments.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c300'
const OTHER_WS = '00000000-0000-4000-8000-00000000c301'
const PROJECT = '00000000-0000-4000-8000-00000000c302'
const PROTOCOL = '00000000-0000-4000-8000-00000000c303'
const AUTHOR = 'lab07rsn-author'
const TECHNICAL = 'lab07rsn-technical'
const QA = 'lab07rsn-qa'
const VIEWER = 'lab07rsn-viewer'
const OUTSIDER = 'lab07rsn-outsider'
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
    `insert into api.workspaces(id,slug,name) values($1,'lab07rsn','LAB-07 deviations'),($2,'lab07rsn-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'scientist'),($1,$4,'reviewer'),($1,$5,'viewer'),($6,$7,'owner')`,
    [WS, AUTHOR, TECHNICAL, QA, VIEWER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,require_effective_protocol)
     values($1,$2,'LAB07RSN','Deviation project',true)`,
    [PROJECT, WS],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template','PRT-RSN','Deviation protocol','active',$3)`,
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
  await technical.query(
    `select api.approve_approval_request($1,'Technical review')`,
    [request],
  )
  const qa = await actor(QA)
  await qa.query(`select api.approve_approval_request($1,'QA approval')`, [
    request,
  ])
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
  await author.query('select * from api.acknowledge_protocol_version($1)', [
    version,
  ])

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
): Promise<
  Array<{ id: string; payload: Record<string, unknown>; version: number }>
> {
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
      result: {
        copied_steps: Array<{
          id: string
          payload: Record<string, unknown>
          version: number
        }>
      }
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

describe('protocol deviation reason', () => {
  async function deviate() {
    const author = await actor(AUTHOR)
    const experiment = await startedExperiment()
    const [step] = await pinnedSteps(experiment.id)
    await editStep(author, step!.id, {
      ...step!.payload,
      text: 'Hold at 2-8 C for 21 days.',
    })
    const deviation = (
      await migrator.query<{ id: string }>(
        'select id from api.protocol_deviations where record_id=$1',
        [experiment.id],
      )
    ).rows[0]!.id
    return { author, experiment, deviation }
  }

  it('stores the reason with its author and time and audits the change', async () => {
    const { author, experiment, deviation } = await deviate()
    const { rows } = await author.query<{
      reason: string
      reason_by_user_id: string
      reason_at: string | null
    }>(
      `select reason, reason_by_user_id, reason_at
         from api.record_protocol_deviation_reason($1, '  Cold room was down for a week  ')`,
      [deviation],
    )
    expect(rows[0]).toMatchObject({
      reason: 'Cold room was down for a week',
      reason_by_user_id: AUTHOR,
    })
    expect(rows[0]!.reason_at).not.toBeNull()

    const events = await migrator.query<{ payload: Record<string, unknown> }>(
      `select payload from api.change_events
        where entity_type='protocol_deviation' and record_id=$1
          and payload->>'effect'='protocol_deviation_reason'`,
      [experiment.id],
    )
    expect(events.rows).toHaveLength(1)
    expect(events.rows[0]!.payload).toMatchObject({
      deviationId: deviation,
      changes: {
        reason: {
          from: null,
          to: 'Cold room was down for a week',
          label: 'Reason for the deviation',
        },
      },
    })
  })

  it('records a correction as a second audited change and ignores a no-op', async () => {
    const { author, experiment, deviation } = await deviate()
    await author.query('select api.record_protocol_deviation_reason($1,$2)', [
      deviation,
      'First reason',
    ])
    await author.query('select api.record_protocol_deviation_reason($1,$2)', [
      deviation,
      'First reason',
    ])
    await author.query('select api.record_protocol_deviation_reason($1,$2)', [
      deviation,
      'Corrected reason',
    ])
    const events = await migrator.query<{
      payload: { changes: { reason: { from: string | null; to: string } } }
    }>(
      `select payload from api.change_events
        where entity_type='protocol_deviation' and record_id=$1
          and payload->>'effect'='protocol_deviation_reason'
        order by created_at, id`,
      [experiment.id],
    )
    expect(events.rows.map((r) => r.payload.changes.reason)).toMatchObject([
      { from: null, to: 'First reason' },
      { from: 'First reason', to: 'Corrected reason' },
    ])
  })

  it('refuses an empty reason', async () => {
    const { author, deviation } = await deviate()
    await expect(
      author.query('select api.record_protocol_deviation_reason($1,$2)', [
        deviation,
        '   ',
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('refuses a viewer and a member of another workspace', async () => {
    const { deviation } = await deviate()
    const viewer = await actor(VIEWER)
    await expect(
      viewer.query('select api.record_protocol_deviation_reason($1,$2)', [
        deviation,
        'Not mine to say',
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    const outsider = await actor(OUTSIDER, OTHER_WS)
    await expect(
      outsider.query('select api.record_protocol_deviation_reason($1,$2)', [
        deviation,
        'Not mine either',
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses a reason once the experiment is signed', async () => {
    const { author, experiment, deviation } = await deviate()
    const revision = (
      await migrator.query<{ id: string }>(
        `insert into api.revisions(record_id,structure_version,metadata_version,metadata_snapshot,block_snapshot,reason,created_by_user_id)
         values($1,1,1,'{}'::jsonb,'[]'::jsonb,'manual',$2) returning id`,
        [experiment.id, AUTHOR],
      )
    ).rows[0]!.id
    await migrator.query(
      'update api.records set locked_at=now(),locked_by_revision_id=$2 where id=$1',
      [experiment.id, revision],
    )
    await expect(
      author.query('select api.record_protocol_deviation_reason($1,$2)', [
        deviation,
        'Too late',
      ]),
    ).rejects.toMatchObject({ code: '55000' })
  })
})
