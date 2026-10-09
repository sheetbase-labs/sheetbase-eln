/**
 * RM-118: `set_experiment_decision` records the decision on an experiment.
 * Only a writer may set it, the value must be a known decision, and the
 * record must be an experiment in the caller's workspace.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000001e0a'
const OTHER_WS = '00000000-0000-4000-8000-000000001e0b'
const OWNER = 'expd-owner'
const VIEWER = 'expd-viewer'
const OUTSIDER = 'expd-outsider'
const EXP = '00000000-0000-4000-8000-000000001e10'
const SAMPLE = '00000000-0000-4000-8000-000000001e11'
const EXP_OTHER = '00000000-0000-4000-8000-000000001e12'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
     ($1,'Owner','expd-owner@test.invalid',true),
     ($2,'Viewer','expd-viewer@test.invalid',true),
     ($3,'Outsider','expd-outsider@test.invalid',true)`,
    [OWNER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'expd','EXPD'),($2,'expd2','EXPD2')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values ($1,$2,'experiment','EXP-EXPD','Decide','draft',$3),
            ($4,$2,'sample','SMP-EXPD','A sample','available',$3),
            ($5,$6,'experiment','EXP-EXPD-O','Other','draft',$7)`,
    [EXP, WS, OWNER, SAMPLE, EXP_OTHER, OTHER_WS, OUTSIDER],
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

const decide = (client: Client, recordId: string, decision: string) =>
  client.query(
    `select decision, decision_notes from api.set_experiment_decision($1,$2,'because')`,
    [recordId, decision],
  )

describe('set_experiment_decision', () => {
  it('records a decision for a writer', async () => {
    const owner = await actor(OWNER, WS)
    const { rows } = await decide(owner, EXP, 'supported')
    expect(rows[0]).toMatchObject({
      decision: 'supported',
      decision_notes: 'because',
    })
  })

  it('rejects an unknown decision', async () => {
    const owner = await actor(OWNER, WS)
    await expect(decide(owner, EXP, 'maybe')).rejects.toMatchObject({
      code: '22023',
    })
  })

  it('denies a viewer', async () => {
    const viewer = await actor(VIEWER, WS)
    await expect(decide(viewer, EXP, 'supported')).rejects.toMatchObject({
      code: '42501',
    })
  })

  it('refuses a record that is not an experiment', async () => {
    const owner = await actor(OWNER, WS)
    await expect(decide(owner, SAMPLE, 'supported')).rejects.toMatchObject({
      code: '22023',
    })
  })

  it('refuses a record in another workspace', async () => {
    const owner = await actor(OWNER, WS)
    await expect(decide(owner, EXP_OTHER, 'supported')).rejects.toMatchObject({
      code: '42501',
    })
  })
})
