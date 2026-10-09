/**
 * LAB-07 — periodic review of an effective protocol version.
 *
 * Confirming a version as current extends its review date and is auditable; a
 * superseded version can never be confirmed, and the used-by list answers which
 * experiments are pinned to the version and who has trained on it.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, grantProjectAccess, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c300'
const OTHER_WS = '00000000-0000-4000-8000-00000000c301'
const PROJECT = '00000000-0000-4000-8000-00000000c302'
const PROTOCOL = '00000000-0000-4000-8000-00000000c303'
const AUTHOR = 'lab07rev-author'
const TECHNICAL = 'lab07rev-technical'
const QA = 'lab07rev-qa'
const VIEWER = 'lab07rev-viewer'
const OUTSIDER = 'lab07rev-outsider'
const ROLES = ['scientist', 'steward', 'reviewer', 'admin', 'owner']

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
    `insert into api.workspaces(id,slug,name) values($1,'lab07rev','LAB-07 review'),($2,'lab07rev-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'scientist'),($1,$4,'reviewer'),($1,$5,'viewer'),($6,$7,'owner')`,
    [WS, AUTHOR, TECHNICAL, QA, VIEWER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,require_effective_protocol)
     values($1,$2,'LAB07REV','Review project',true)`,
    [PROJECT, WS],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template','PRT-REV','Reviewed protocol','active',$3)`,
    [PROTOCOL, WS, AUTHOR],
  )
  await migrator.query(
    `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
     values($1,'procedure_step',$2::jsonb,1,$3)`,
    [PROTOCOL, JSON.stringify({ text: 'Hold at 2-8 C.', stepNumber: 1 }), AUTHOR],
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: AUTHOR,
    canView: true,
    canEdit: true,
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

async function effectiveVersion(): Promise<string> {
  const author = await actor(AUTHOR)
  const version = (
    await author.query<{ id: string }>(
      `select id from api.create_protocol_version($1,'Reviewed version',null)`,
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
  return version
}

describe('LAB-07 protocol periodic review and used-by', () => {
  it('confirms an effective version as current and records the extension', async () => {
    const author = await actor(AUTHOR)
    const version = await effectiveVersion()
    const due = new Date(Date.now() + 365 * 86_400_000)
    const { rows } = await author.query(
      `select * from api.confirm_protocol_version_current($1,$2,$3)`,
      [version, due.toISOString(), 'Annual review completed'],
    )
    expect(rows[0]).toMatchObject({ status: 'effective' })
    expect(new Date(rows[0].review_due_at).getTime()).toBe(due.getTime())
    expect(rows[0].reason).toBe('Annual review completed')
    const events = await migrator.query<{ payload: Record<string, unknown> }>(
      `select payload from api.change_events
        where entity_type='protocol_version' and entity_uuid=$1`,
      [version],
    )
    expect(
      events.rows.some((event) => event.payload.effect === 'confirmed_current'),
    ).toBe(true)
  })

  it('refuses a past date, an empty reason, a non-writer and a superseded version', async () => {
    const author = await actor(AUTHOR)
    const version = await effectiveVersion()
    const future = new Date(Date.now() + 86_400_000).toISOString()
    await expectDenied(
      author.query('select api.confirm_protocol_version_current($1,$2,$3)', [
        version,
        new Date(Date.now() - 86_400_000).toISOString(),
        'Too late',
      ]),
      '22023',
    )
    await expectDenied(
      author.query('select api.confirm_protocol_version_current($1,$2,$3)', [
        version,
        future,
        '   ',
      ]),
      '22023',
    )
    const viewer = await actor(VIEWER)
    await expectDenied(
      viewer.query('select api.confirm_protocol_version_current($1,$2,$3)', [
        version,
        future,
        'No capability',
      ]),
      '42501',
    )
    // A newer effective version supersedes this one, so it is no longer current.
    await effectiveVersion()
    await expectDenied(
      author.query('select api.confirm_protocol_version_current($1,$2,$3)', [
        version,
        future,
        'Superseded already',
      ]),
      'SB113',
    )
  })

  it('lists the experiments pinned to the version and the people trained on it', async () => {
    const author = await actor(AUTHOR)
    const version = await effectiveVersion()
    await setActorJwt(migrator, AUTHOR, WS)
    await migrator.query(
      `insert into api.project_protocols(workspace_id,project_id,protocol_record_id,protocol_version_id,created_by_user_id)
       values($1,$2,$3,$4,$5) on conflict(project_id,protocol_record_id)
       do update set protocol_version_id=excluded.protocol_version_id`,
      [WS, PROJECT, PROTOCOL, version, AUTHOR],
    )
    await author.query('select * from api.acknowledge_protocol_version($1)', [version])
    const trainee = await actor(TECHNICAL)
    await trainee.query('select * from api.acknowledge_protocol_version($1)', [version])

    const record = crypto.randomUUID()
    await migrator.query(
      `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,protocol_version_id,created_by_user_id)
       values($1,$2,$3,'experiment',$4,'Pinned experiment','in_progress',$5,$6)`,
      [record, WS, PROJECT, `EXP-${record}`, version, AUTHOR],
    )
    const { rows } = await author.query<{
      used_by_count: number
      used_by: Array<{ identifier: string }>
      acknowledged_count: number
      acknowledged_by: Array<{ userId: string }>
    }>('select * from api.protocol_version_usage($1)', [version])
    expect(rows[0]!.used_by_count).toBe(1)
    expect(rows[0]!.used_by.map((item) => item.identifier)).toEqual([
      `EXP-${record}`,
    ])
    expect(rows[0]!.acknowledged_count).toBe(2)
    expect(
      rows[0]!.acknowledged_by.map((item) => item.userId).sort(),
    ).toEqual([AUTHOR, TECHNICAL].sort())

    const outsider = await actor(OUTSIDER, OTHER_WS)
    expect(
      (await outsider.query('select * from api.protocol_version_usage($1)', [version]))
        .rows,
    ).toEqual([])
  })
})
