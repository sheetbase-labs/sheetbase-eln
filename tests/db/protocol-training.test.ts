/**
 * Training on a protocol is one record: the acknowledgement of an exact
 * version. `protocol_training` is only the roster (who is expected to keep up,
 * and by when), and `protocol_training_status` reads where everyone stands
 * from the acknowledgements, so the status can never disagree with what
 * starting an experiment checks.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000200a'
const OTHER_WS = '00000000-0000-4000-8000-00000000200b'
const OWNER = 'pt-owner'
const SCIENTIST = 'pt-scientist'
const VIEWER = 'pt-viewer'
const OUTSIDER = 'pt-outsider'
const PROTOCOL = '00000000-0000-4000-8000-000000002010'
const SAMPLE = '00000000-0000-4000-8000-000000002011'
const PROTOCOL_OTHER = '00000000-0000-4000-8000-000000002012'
const V1 = '00000000-0000-4000-8000-000000002021'
const V2 = '00000000-0000-4000-8000-000000002022'
const V_DRAFT = '00000000-0000-4000-8000-000000002023'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
     ($1,'Owner','pt-owner@test.invalid',true),
     ($2,'Scientist','pt-scientist@test.invalid',true),
     ($3,'Viewer','pt-viewer@test.invalid',true),
     ($4,'Outsider','pt-outsider@test.invalid',true)`,
    [OWNER, SCIENTIST, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'pt','PT'),($2,'pt2','PT2')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'scientist'),($1,$4,'viewer'),($5,$6,'owner')`,
    [WS, OWNER, SCIENTIST, VIEWER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values ($1,$2,'protocol_template','PRT-PT','A protocol','active',$3),
            ($4,$2,'sample','SMP-PT','A sample','available',$3),
            ($5,$6,'protocol_template','PRT-PT-O','Other','active',$7)`,
    [PROTOCOL, WS, OWNER, SAMPLE, PROTOCOL_OTHER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.protocol_versions(id,workspace_id,protocol_record_id,version,status,created_by_user_id)
     values ($1,$2,$3,1,'effective',$4),
            ($5,$2,$3,2,'in_review',$4),
            ($6,$2,$3,3,'draft',$4)`,
    [V1, WS, PROTOCOL, OWNER, V2, V_DRAFT],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(user: string, workspace: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: user,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

const status = async (client: Client, userId: string) =>
  (
    await client.query(
      `select status, trained_version, current_version, overdue
         from api.protocol_training_status
        where protocol_record_id = $1 and user_id = $2`,
      [PROTOCOL, userId],
    )
  ).rows[0]

describe('assign_protocol_training', () => {
  it('puts a member on the roster with a due date', async () => {
    const owner = await actor(OWNER, WS)
    const { rows } = await owner.query(
      `select due_at from api.assign_protocol_training($1,$2,now() + interval '7 days','Needed for the Q4 runs')`,
      [PROTOCOL, SCIENTIST],
    )
    expect(rows[0]?.due_at).not.toBeNull()
    expect(await status(owner, SCIENTIST)).toMatchObject({
      status: 'required',
      current_version: 1,
      overdue: false,
    })
  })

  it('refuses a person who is not a workspace member', async () => {
    const owner = await actor(OWNER, WS)
    await expect(
      owner.query('select api.assign_protocol_training($1,$2)', [
        PROTOCOL,
        OUTSIDER,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('denies a viewer', async () => {
    const viewer = await actor(VIEWER, WS)
    await expect(
      viewer.query('select api.assign_protocol_training($1,$2)', [
        PROTOCOL,
        VIEWER,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses a record that is not a protocol', async () => {
    const owner = await actor(OWNER, WS)
    await expect(
      owner.query('select api.assign_protocol_training($1,$2)', [
        SAMPLE,
        SCIENTIST,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses another workspace’s protocol', async () => {
    const owner = await actor(OWNER, WS)
    await expect(
      owner.query('select api.assign_protocol_training($1,$2)', [
        PROTOCOL_OTHER,
        SCIENTIST,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('no longer takes a trained status: the old function is gone', async () => {
    const owner = await actor(OWNER, WS)
    await expect(
      owner.query(`select api.record_protocol_training($1,$2,'trained')`, [
        PROTOCOL,
        SCIENTIST,
      ]),
    ).rejects.toMatchObject({ code: '42883' })
  })
})

describe('one training record', () => {
  it('shows someone as trained once they acknowledge the current version', async () => {
    const scientist = await actor(SCIENTIST, WS)
    await scientist.query('select api.acknowledge_protocol_version($1)', [V1])
    expect(await status(scientist, SCIENTIST)).toMatchObject({
      status: 'trained',
      trained_version: 1,
    })
  })

  it('puts someone who acknowledged on the roster without being assigned', async () => {
    const owner = await actor(OWNER, WS)
    await owner.query('select api.acknowledge_protocol_version($1)', [V1])
    const { rows } = await owner.query(
      'select 1 from api.protocol_training where protocol_record_id = $1 and user_id = $2',
      [PROTOCOL, OWNER],
    )
    expect(rows).toHaveLength(1)
  })

  it('shows trained people as out of date when a newer version takes over', async () => {
    const owner = await actor(OWNER, WS)
    await migrator.query(
      `update api.protocol_versions set status = 'superseded' where id = $1`,
      [V1],
    )
    await migrator.query(
      `update api.protocol_versions set status = 'effective' where id = $1`,
      [V2],
    )
    expect(await status(owner, SCIENTIST)).toMatchObject({
      status: 'out_of_date',
      trained_version: 1,
      current_version: 2,
    })
    await migrator.query(
      `update api.protocol_versions set status = 'superseded' where id = $1`,
      [V2],
    )
    await migrator.query(
      `update api.protocol_versions set status = 'effective' where id = $1`,
      [V1],
    )
  })

  it('records training given in person against the exact version, with the trainer named', async () => {
    const owner = await actor(OWNER, WS)
    await migrator.query(
      `delete from api.protocol_acknowledgements where user_id = $1`,
      [SCIENTIST],
    )
    expect(await status(owner, SCIENTIST)).toMatchObject({
      status: 'required',
    })
    const { rows } = await owner.query(
      `select user_id, recorded_by_user_id, notes
         from api.record_protocol_trained($1,$2,'Walked through at the bench')`,
      [V1, SCIENTIST],
    )
    expect(rows[0]).toMatchObject({
      user_id: SCIENTIST,
      recorded_by_user_id: OWNER,
      notes: 'Walked through at the bench',
    })
    expect(await status(owner, SCIENTIST)).toMatchObject({ status: 'trained' })
  })

  it('does not record training on a draft version', async () => {
    const owner = await actor(OWNER, WS)
    await expect(
      owner.query('select api.record_protocol_trained($1,$2)', [
        V_DRAFT,
        SCIENTIST,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('denies a viewer recording training', async () => {
    const viewer = await actor(VIEWER, WS)
    await expect(
      viewer.query('select api.record_protocol_trained($1,$2)', [V1, VIEWER]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('marks an unmet due date as overdue', async () => {
    const owner = await actor(OWNER, WS)
    await migrator.query(
      `delete from api.protocol_acknowledgements where user_id = $1`,
      [SCIENTIST],
    )
    await migrator.query(
      `update api.protocol_training set due_at = now() - interval '1 day'
        where protocol_record_id = $1 and user_id = $2`,
      [PROTOCOL, SCIENTIST],
    )
    expect(await status(owner, SCIENTIST)).toMatchObject({
      status: 'required',
      overdue: true,
    })
  })

  it('takes someone off the roster without erasing training they have done', async () => {
    const owner = await actor(OWNER, WS)
    await owner.query('select api.unassign_protocol_training($1,$2)', [
      PROTOCOL,
      SCIENTIST,
    ])
    const { rows } = await owner.query(
      'select 1 from api.protocol_training where protocol_record_id = $1 and user_id = $2',
      [PROTOCOL, SCIENTIST],
    )
    expect(rows).toHaveLength(0)
    await owner.query('select api.record_protocol_trained($1,$2)', [
      V1,
      SCIENTIST,
    ])
    await owner.query('select api.unassign_protocol_training($1,$2)', [
      PROTOCOL,
      SCIENTIST,
    ])
    expect(await status(owner, SCIENTIST)).toMatchObject({ status: 'trained' })
  })
})
