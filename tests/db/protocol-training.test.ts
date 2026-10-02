/**
 * RM-104: `record_protocol_training` records who is trained on a protocol.
 * Only a writer may record it, the person must be a workspace member, the
 * status must be known, and the protocol must be in the caller's workspace.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000200a'
const OTHER_WS = '00000000-0000-4000-8000-00000000200b'
const OWNER = 'pt-owner'
const VIEWER = 'pt-viewer'
const OUTSIDER = 'pt-outsider'
const PROTOCOL = '00000000-0000-4000-8000-000000002010'
const SAMPLE = '00000000-0000-4000-8000-000000002011'
const PROTOCOL_OTHER = '00000000-0000-4000-8000-000000002012'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
     ($1,'Owner','pt-owner@test.invalid',true),
     ($2,'Viewer','pt-viewer@test.invalid',true),
     ($3,'Outsider','pt-outsider@test.invalid',true)`,
    [OWNER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'pt','PT'),($2,'pt2','PT2')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values ($1,$2,'protocol_template','PRT-PT','A protocol','active',$3),
            ($4,$2,'sample','SMP-PT','A sample','available',$3),
            ($5,$6,'protocol_template','PRT-PT-O','Other','active',$7)`,
    [PROTOCOL, WS, OWNER, SAMPLE, PROTOCOL_OTHER, OTHER_WS, OUTSIDER],
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
    JSON.stringify({ sub: user, workspace_id: workspace }),
  ])
  return client
}

const record = (
  client: Client,
  protocolId: string,
  userId: string,
  status = 'trained',
) =>
  client.query(
    `select status, trained_at from api.record_protocol_training($1,$2,$3)`,
    [protocolId, userId, status],
  )

describe('record_protocol_training', () => {
  it('records training for a writer', async () => {
    const owner = await actor(OWNER, WS)
    const { rows } = await record(owner, PROTOCOL, VIEWER)
    expect(rows[0]?.status).toBe('trained')
    expect(rows[0]?.trained_at).not.toBeNull()
  })

  it('rejects an unknown status', async () => {
    const owner = await actor(OWNER, WS)
    await expect(
      record(owner, PROTOCOL, VIEWER, 'maybe'),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('refuses a person who is not a workspace member', async () => {
    const owner = await actor(OWNER, WS)
    await expect(record(owner, PROTOCOL, OUTSIDER)).rejects.toMatchObject({
      code: '22023',
    })
  })

  it('denies a viewer', async () => {
    const viewer = await actor(VIEWER, WS)
    await expect(record(viewer, PROTOCOL, VIEWER)).rejects.toMatchObject({
      code: '42501',
    })
  })

  it('refuses a record that is not a protocol', async () => {
    const owner = await actor(OWNER, WS)
    await expect(record(owner, SAMPLE, VIEWER)).rejects.toMatchObject({
      code: '42501',
    })
  })

  it('refuses another workspace’s protocol', async () => {
    const owner = await actor(OWNER, WS)
    await expect(record(owner, PROTOCOL_OTHER, VIEWER)).rejects.toMatchObject({
      code: '42501',
    })
  })
})
