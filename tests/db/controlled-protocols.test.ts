import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000b700'
const PROTOCOL = '00000000-0000-4000-8000-00000000b701'
const PROJECT = '00000000-0000-4000-8000-00000000b703'
const AUTHOR = 'lab07-author'
const TECHNICAL = 'lab07-technical'
const QA = 'lab07-qa'
const TRAINEE = 'lab07-trainee'
const ROLES = ['scientist', 'steward', 'reviewer', 'admin', 'owner']

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [AUTHOR, TECHNICAL, QA, TRAINEE]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'lab07','LAB-07')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'scientist'),($1,$4,'reviewer'),($1,$5,'scientist')`,
    [WS, AUTHOR, TECHNICAL, QA, TRAINEE],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,require_effective_protocol)
     values($1,$2,'LAB07','Controlled project',true)`,
    [PROJECT, WS],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template','PRT-LAB07','Clarification','active',$3)`,
    [PROTOCOL, WS, AUTHOR],
  )
  await migrator.query(
    `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
     values($1,'procedure_step',$2::jsonb,1,$3)`,
    [
      PROTOCOL,
      JSON.stringify({
        text: 'Run at 100 LMH ±5; hold at 2–8 °C ≤14 days.',
        stepNumber: 1,
      }),
      AUTHOR,
    ],
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

async function newVersion(): Promise<string> {
  const author = await actor(AUTHOR)
  const { rows } = await author.query<{ id: string }>(
    `select id from api.create_protocol_version($1,'New controlled version',null)`,
    [PROTOCOL],
  )
  const id = rows[0]?.id
  if (!id)
    throw new Error('create_protocol_version returned no immutable identity')
  await author.query(
    `select api.set_protocol_version_status($1,'in_review','Author submission',null)`,
    [id],
  )
  return id
}

async function submit(versionId: string): Promise<string> {
  const author = await actor(AUTHOR)
  const { rows } = await author.query<{ id: string }>(
    `select id from api.submit_approval_request($1,'protocol_revision',$2,$3,'Author submission',true,2,null)`,
    [WS, versionId, ROLES],
  )
  const id = rows[0]?.id
  if (!id) throw new Error('submit_approval_request returned no request')
  return id
}

async function approvedVersion(): Promise<string> {
  const versionId = await newVersion()
  const requestId = await submit(versionId)
  const technical = await actor(TECHNICAL)
  await technical.query(
    `select api.approve_approval_request($1,'Technical review')`,
    [requestId],
  )
  const qa = await actor(QA)
  await qa.query(`select api.approve_approval_request($1,'QA approval')`, [
    requestId,
  ])
  return versionId
}

async function effectiveVersion(): Promise<string> {
  const versionId = await approvedVersion()
  const author = await actor(AUTHOR)
  await author.query(
    `select api.set_protocol_version_status($1,'effective','Release',now())`,
    [versionId],
  )
  await setActorJwt(migrator, AUTHOR, WS)
  await migrator.query(
    `insert into api.project_protocols(workspace_id,project_id,protocol_record_id,protocol_version_id,created_by_user_id)
     values($1,$2,$3,$4,$5) on conflict(project_id,protocol_record_id)
     do update set protocol_version_id=excluded.protocol_version_id`,
    [WS, PROJECT, PROTOCOL, versionId, AUTHOR],
  )
  return versionId
}

describe('LAB-07 controlled protocol server contracts', () => {
  it('has canonical version, acknowledgement and project association relations', async () => {
    const { rows } = await migrator.query(
      `select to_regclass('api.protocol_versions')::text as versions,
       to_regclass('api.protocol_acknowledgements')::text as acknowledgements,
       to_regclass('api.project_protocols')::text as associations,
       to_regprocedure('internal.protocol_version_is_eligible(uuid,boolean)')::text as eligibility,
       to_regprocedure('internal.assert_protocol_start_eligible(uuid,text,uuid)')::text as start_guard`,
    )
    expect(rows[0]).toEqual({
      versions: 'api.protocol_versions',
      acknowledgements: 'api.protocol_acknowledgements',
      associations: 'api.project_protocols',
      eligibility: 'internal.protocol_version_is_eligible(uuid,boolean)',
      start_guard: 'internal.assert_protocol_start_eligible(uuid,text,uuid)',
    })
  })

  it('freezes scientific text in the revision identified by version.id', async () => {
    const versionId = await newVersion()
    const { rows } = await migrator.query(
      `select v.protocol_record_id,r.record_id,r.block_snapshot
       from api.protocol_versions v join api.revisions r on r.id=v.id where v.id=$1`,
      [versionId],
    )
    expect(rows[0]?.protocol_record_id).toBe(PROTOCOL)
    expect(rows[0]?.record_id).toBe(PROTOCOL)
    expect(rows[0]?.block_snapshot[0]?.payload).toEqual({
      text: 'Run at 100 LMH ±5; hold at 2–8 °C ≤14 days.',
      stepNumber: 1,
    })
  })

  it('does not equate shared approval with effective lifecycle', async () => {
    const versionId = await approvedVersion()
    const { rows } = await migrator.query(
      `select internal.protocol_version_is_eligible($1,false) as optional,
       internal.protocol_version_is_eligible($1,true) as required`,
      [versionId],
    )
    expect(rows[0]).toEqual({ optional: true, required: false })
  })

  it('refuses QA before technical review through the shared generic RPC', async () => {
    const requestId = await submit(await newVersion())
    const qa = await actor(QA)
    await expect(
      qa.query(`select api.approve_approval_request($1,'Skip technical')`, [
        requestId,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses caller-weakened role/count policy through generic submission', async () => {
    const versionId = await newVersion()
    const author = await actor(AUTHOR)
    await expect(
      author.query(
        `select api.submit_approval_request($1,'protocol_revision',$2,array['owner'],'Skip stages',false,1,null)`,
        [WS, versionId],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('does not start before effective_at even after approval', async () => {
    const versionId = await approvedVersion()
    const author = await actor(AUTHOR)
    await author.query(
      `select api.set_protocol_version_status($1,'effective','Scheduled release',now()+interval '1 day')`,
      [versionId],
    )
    const { rows } = await migrator.query(
      `select internal.protocol_version_is_eligible($1,true) as eligible`,
      [versionId],
    )
    expect(rows[0]?.eligible).toBe(false)
  })

  it('stamps only the actor acknowledgement and does not train a newer revision', async () => {
    const oldVersion = await approvedVersion()
    const trainee = await actor(TRAINEE)
    const { rows } = await trainee.query(
      `select * from api.acknowledge_protocol_version($1)`,
      [oldVersion],
    )
    expect(rows[0]?.protocol_version_id).toBe(oldVersion)
    expect(rows[0]?.user_id).toBe(TRAINEE)
    expect(rows[0]?.acknowledged_at).toBeInstanceOf(Date)
    const newVersionId = await approvedVersion()
    const count = await migrator.query(
      `select count(*)::int as count from api.protocol_acknowledgements where protocol_version_id=$1 and user_id=$2`,
      [newVersionId, TRAINEE],
    )
    expect(count.rows[0]?.count).toBe(0)
  })

  it('refuses start without exact-version acknowledgement, then permits it', async () => {
    const versionId = await effectiveVersion()
    await setActorJwt(migrator, TRAINEE, WS)
    const start = () =>
      migrator.query(
        `select internal.assert_protocol_start_eligible($1,$2,$3)`,
        [versionId, TRAINEE, PROJECT],
      )
    await expect(start()).rejects.toMatchObject({ code: '42501' })
    const trainee = await actor(TRAINEE)
    await trainee.query(`select api.acknowledge_protocol_version($1)`, [
      versionId,
    ])
    await expect(start()).resolves.toBeDefined()
  })

  it('supersedes old eligibility without transferring its acknowledgement', async () => {
    const oldVersionId = await effectiveVersion()
    const trainee = await actor(TRAINEE)
    await trainee.query(`select api.acknowledge_protocol_version($1)`, [
      oldVersionId,
    ])
    const newVersionId = await effectiveVersion()
    const { rows } = await migrator.query(
      `select internal.protocol_version_is_eligible($1,true) as old,
       internal.protocol_version_is_eligible($2,true) as current`,
      [oldVersionId, newVersionId],
    )
    expect(rows[0]).toEqual({ old: false, current: true })
    await setActorJwt(migrator, TRAINEE, WS)
    await expect(
      migrator.query(
        `select internal.assert_protocol_start_eligible($1,$2,$3)`,
        [newVersionId, TRAINEE, PROJECT],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
