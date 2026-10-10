/**
 * LAB-07 / PROJ-03 — the members Training column reads exact-version training.
 *
 * The requirement is the effective, still-current protocol versions pinned by
 * the projects a member can view, minus that member's acknowledgements. A
 * version whose periodic review is already due counts as overdue while the
 * member is untrained.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c400'
const OTHER_WS = '00000000-0000-4000-8000-00000000c401'
const PROJECT = '00000000-0000-4000-8000-00000000c402'
const OTHER_PROJECT = '00000000-0000-4000-8000-00000000c403'
const PROTOCOL = '00000000-0000-4000-8000-00000000c404'
const ADMIN = 'lab07trn-admin'
const TRAINED = 'lab07trn-trained'
const UNTRAINED = 'lab07trn-untrained'
const UNRELATED = 'lab07trn-unrelated'
const OUTSIDER = 'lab07trn-outsider'
const ROLES = ['scientist', 'steward', 'reviewer', 'admin', 'owner']

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [ADMIN, TRAINED, UNTRAINED, UNRELATED, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'lab07trn','LAB-07 training'),($2,'lab07trn-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'scientist'),($1,$4,'scientist'),($1,$5,'scientist'),($6,$7,'owner')`,
    [WS, ADMIN, TRAINED, UNTRAINED, UNRELATED, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,require_effective_protocol) values
     ($1,$2,'LAB07TRN','Training project',true),
     ($3,$2,'LAB07TRN2','Unrelated project',true)`,
    [PROJECT, WS, OTHER_PROJECT],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template','PRT-TRN','Training protocol','active',$3)`,
    [PROTOCOL, WS, ADMIN],
  )
  await migrator.query(
    `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
     values($1,'procedure_step',$2::jsonb,1,$3)`,
    [
      PROTOCOL,
      JSON.stringify({ text: 'Hold at 2-8 C.', stepNumber: 1 }),
      ADMIN,
    ],
  )
  // TRAINED, UNTRAINED and ADMIN can view the project; UNRELATED cannot.
  for (const user of [ADMIN, TRAINED, UNTRAINED]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJECT,
      userId: user,
      canView: true,
      canEdit: true,
    })
  }
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: OTHER_PROJECT,
    userId: UNRELATED,
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

/** An effective protocol version pinned by `project`, with an optional due date. */
async function effectiveVersion(
  project = PROJECT,
  reviewDueAt: string | null = null,
): Promise<string> {
  const admin = await actor(ADMIN)
  const version = (
    await admin.query<{ id: string }>(
      `select id from api.create_protocol_version($1,'Training version',null)`,
      [PROTOCOL],
    )
  ).rows[0]!.id
  await admin.query(
    `select api.set_protocol_version_status($1,'in_review','Author submission',null)`,
    [version],
  )
  const request = (
    await admin.query<{ id: string }>(
      `select id from api.submit_approval_request($1,'protocol_revision',$2,$3,'Author submission',true,2,null)`,
      [WS, version, ROLES],
    )
  ).rows[0]!.id
  const technical = await actor(TRAINED)
  await technical.query(
    `select api.approve_approval_request($1,'Technical review')`,
    [request],
  )
  const qa = await actor(UNTRAINED)
  await qa.query(`select api.approve_approval_request($1,'QA approval')`, [
    request,
  ])
  await admin.query(
    `select api.set_protocol_version_status($1,'effective','Release',now())`,
    [version],
  )
  if (reviewDueAt) {
    await migrator.query(
      'update api.protocol_versions set review_due_at=$2 where id=$1',
      [version, reviewDueAt],
    )
  }
  await setActorJwt(migrator, ADMIN, WS)
  await migrator.query(
    `insert into api.project_protocols(workspace_id,project_id,protocol_record_id,protocol_version_id,created_by_user_id)
     values($1,$2,$3,$4,$5) on conflict(project_id,protocol_record_id)
     do update set protocol_version_id=excluded.protocol_version_id`,
    [WS, project, PROTOCOL, version, ADMIN],
  )
  return version
}

async function status(client: Client) {
  return (
    await client.query<{
      user_id: string
      training_required: string
      training_overdue: string
    }>(
      'select user_id,training_required,training_overdue from api.workspace_member_status()',
    )
  ).rows
}

describe('LAB-07 / PROJ-03 member training status', () => {
  it('requires the pinned effective version of a member and clears on acknowledgement', async () => {
    const admin = await actor(ADMIN)
    const version = await effectiveVersion()
    const before = await status(admin)
    expect(before.find((row) => row.user_id === UNTRAINED)).toMatchObject({
      training_required: '1',
      training_overdue: '0',
    })
    expect(before.find((row) => row.user_id === TRAINED)).toMatchObject({
      training_required: '1',
    })
    const trained = await actor(TRAINED)
    await trained.query('select * from api.acknowledge_protocol_version($1)', [
      version,
    ])
    const after = await status(admin)
    expect(after.find((row) => row.user_id === TRAINED)).toMatchObject({
      training_required: '0',
      training_overdue: '0',
    })
    expect(after.find((row) => row.user_id === UNTRAINED)).toMatchObject({
      training_required: '1',
    })
  })

  it('counts an untrained member as overdue once the review date has passed', async () => {
    const admin = await actor(ADMIN)
    await effectiveVersion(
      PROJECT,
      new Date(Date.now() - 86_400_000).toISOString(),
    )
    const rows = await status(admin)
    expect(rows.find((row) => row.user_id === UNTRAINED)).toMatchObject({
      training_required: '1',
      training_overdue: '1',
    })
  })

  it('only requires versions from projects the member can view', async () => {
    const admin = await actor(ADMIN)
    await effectiveVersion()
    const rows = await status(admin)
    // UNRELATED has authority on the other project only, which pins nothing.
    expect(rows.find((row) => row.user_id === UNRELATED)).toMatchObject({
      training_required: '0',
    })
  })

  it('is readable to workspace admins only, and never across workspaces', async () => {
    const untrained = await actor(UNTRAINED)
    expect(await status(untrained)).toEqual([])
    // The other workspace's owner reads only their own members, never this one.
    const outsider = await actor(OUTSIDER, OTHER_WS)
    expect((await status(outsider)).map((row) => row.user_id)).toEqual([
      OUTSIDER,
    ])
  })
})
