/**
 * RM-112: sample measurements. A writer records a value against a sample; a
 * viewer can read but not write; a non-sample record and another workspace are
 * refused; the name is required.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000001d0a'
const OTHER_WS = '00000000-0000-4000-8000-000000001d0b'
const OWNER = 'smeas-owner'
const VIEWER = 'smeas-viewer'
const OUTSIDER = 'smeas-outsider'
const SAMPLE = '00000000-0000-4000-8000-000000001d10'
const EXP = '00000000-0000-4000-8000-000000001d11'
const SAMPLE_OTHER = '00000000-0000-4000-8000-000000001d12'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
     ($1,'Owner','smeas-owner@test.invalid',true),
     ($2,'Viewer','smeas-viewer@test.invalid',true),
     ($3,'Outsider','smeas-outsider@test.invalid',true)`,
    [OWNER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'smeas','SMEAS'),($2,'smeas2','SMEAS2')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values ($1,$2,'sample','SMP-SMEAS','A sample','available',$3),
            ($4,$2,'experiment','EXP-SMEAS','Not a sample','draft',$3),
            ($5,$6,'sample','SMP-OTHER','Other','available',$7)`,
    [SAMPLE, WS, OWNER, EXP, SAMPLE_OTHER, OTHER_WS, OUTSIDER],
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

const record = (client: Client, sampleId: string, name = 'Titre') =>
  client.query(
    `select name, value, unit from api.record_sample_measurement($1,$2,4.2e6,'TU/mL','ELISA')`,
    [sampleId, name],
  )

describe('record_sample_measurement', () => {
  it('records a measurement for a writer', async () => {
    const owner = await actor(OWNER, WS)
    const { rows } = await record(owner, SAMPLE)
    expect(rows[0]).toMatchObject({ name: 'Titre', unit: 'TU/mL' })
  })

  it('lets a viewer read the recorded measurements', async () => {
    const viewer = await actor(VIEWER, WS)
    const { rows } = await viewer.query(
      `select count(*)::int as n from api.sample_measurements where sample_record_id = $1`,
      [SAMPLE],
    )
    expect(rows[0].n).toBeGreaterThan(0)
  })

  it('denies a viewer write', async () => {
    const viewer = await actor(VIEWER, WS)
    await expect(record(viewer, SAMPLE)).rejects.toMatchObject({
      code: '42501',
    })
  })

  it('requires a name', async () => {
    const owner = await actor(OWNER, WS)
    await expect(record(owner, SAMPLE, '   ')).rejects.toMatchObject({
      code: '22023',
    })
  })

  it('refuses a record that is not a sample', async () => {
    const owner = await actor(OWNER, WS)
    await expect(record(owner, EXP)).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses a sample in another workspace', async () => {
    const owner = await actor(OWNER, WS)
    await expect(record(owner, SAMPLE_OTHER)).rejects.toMatchObject({
      code: '42501',
    })
  })
})
