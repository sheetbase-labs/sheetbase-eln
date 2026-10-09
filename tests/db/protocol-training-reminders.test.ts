/**
 * LAB-07.3 — read-and-acknowledge reminders.
 *
 * A version becoming effective, and a project pinning a version, each raise one
 * reminder for the members who must read that exact version. Acknowledging first
 * means no reminder, and the two trigger points never duplicate one.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c500'
const PROJECT = '00000000-0000-4000-8000-00000000c502'
const PROTOCOL = '00000000-0000-4000-8000-00000000c504'
const ADMIN = 'lab07rem-admin'
const TRAINED = 'lab07rem-trained'
const UNTRAINED = 'lab07rem-untrained'
const CLIENT = 'lab07rem-client'
const ROLES = ['scientist', 'steward', 'reviewer', 'admin', 'owner']

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [ADMIN, TRAINED, UNTRAINED, CLIENT]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'lab07rem','LAB-07 reminders')`,
    [WS],
  )
  await migrator.query(
    `insert into api.clients(id,workspace_id,code,name) values($1,$2,'CL-907','Reminder client')`,
    ['00000000-0000-4000-8000-00000000c505', WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role,client_id) values
     ($1,$2,'owner',null),($1,$3,'scientist',null),($1,$4,'scientist',null),($1,$5,'client_viewer',$6)`,
    [
      WS,
      ADMIN,
      TRAINED,
      UNTRAINED,
      CLIENT,
      '00000000-0000-4000-8000-00000000c505',
    ],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,require_effective_protocol)
     values($1,$2,'LAB07REM','Reminder project',true)`,
    [PROJECT, WS],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template','PRT-REM','Reminder protocol','active',$3)`,
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
  for (const user of [ADMIN, TRAINED, UNTRAINED]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJECT,
      userId: user,
      canView: true,
      canEdit: true,
    })
  }
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

async function newApprovedVersion(): Promise<string> {
  const admin = await actor(ADMIN)
  const version = (
    await admin.query<{ id: string }>(
      `select id from api.create_protocol_version($1,'Reminder version',null)`,
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
  return version
}

async function pin(version: string) {
  await setActorJwt(migrator, ADMIN, WS)
  await migrator.query(
    `insert into api.project_protocols(workspace_id,project_id,protocol_record_id,protocol_version_id,created_by_user_id)
     values($1,$2,$3,$4,$5) on conflict(project_id,protocol_record_id)
     do update set protocol_version_id=excluded.protocol_version_id`,
    [WS, PROJECT, PROTOCOL, version, ADMIN],
  )
}

async function release(version: string) {
  const admin = await actor(ADMIN)
  await admin.query(
    `select api.set_protocol_version_status($1,'effective','Release',now())`,
    [version],
  )
}

async function reminders(client: Client, versionTitle: string) {
  return (
    await client.query<{
      event_type: string
      title: string
      project_id: string | null
    }>(
      `select event_type,title,project_id from api.my_notifications
        where event_type='protocol_training_required' and title = $1 order by title`,
      [versionTitle],
    )
  ).rows
}

async function versionTitle(version: string): Promise<string> {
  const { rows } = await migrator.query<{ title: string }>(
    `select 'Read and acknowledge ' || r.identifier || ' v' || v.version::text as title
       from api.protocol_versions v join api.records r on r.id = v.protocol_record_id
      where v.id = $1`,
    [version],
  )
  return rows[0]!.title
}

describe('LAB-07 protocol training reminders', () => {
  it('reminds the untrained project members when a pinned version becomes effective', async () => {
    const version = await newApprovedVersion()
    const title = await versionTitle(version)
    await pin(version)
    await release(version)

    const untrained = await actor(UNTRAINED)
    expect(await reminders(untrained, title)).toEqual([
      {
        event_type: 'protocol_training_required',
        title,
        project_id: PROJECT,
      },
    ])
    // The actor who released it, the already-trained member and client viewers
    // are not reminded.
    expect(await reminders(await actor(ADMIN), title)).toEqual([])
    // A member who is still untrained at release is reminded; acknowledging
    // afterwards does not retract the reminder or duplicate it.
    const trained = await actor(TRAINED)
    expect(await reminders(trained, title)).toHaveLength(1)
    await trained.query('select * from api.acknowledge_protocol_version($1)', [
      version,
    ])
    expect(await reminders(trained, title)).toHaveLength(1)
    expect(await reminders(await actor(CLIENT), title)).toEqual([])
  })

  it('reminds when a project pins a version, without duplicating the reminder', async () => {
    const version = await newApprovedVersion()
    const title = await versionTitle(version)
    await release(version)
    await pin(version)
    const untrained = await actor(UNTRAINED)
    expect(await reminders(untrained, title)).toHaveLength(1)
    // Re-pinning the same version is not a second reminder.
    await pin(version)
    expect(await reminders(untrained, title)).toHaveLength(1)
  })

  it('does not remind a member who acknowledged before the release', async () => {
    const version = await newApprovedVersion()
    const title = await versionTitle(version)
    const trained = await actor(TRAINED)
    await trained.query('select * from api.acknowledge_protocol_version($1)', [
      version,
    ])
    await pin(version)
    await release(version)
    expect(await reminders(trained, title)).toEqual([])
    expect(await reminders(await actor(UNTRAINED), title)).toHaveLength(1)
  })
})
