/**
 * New-experiment fields: `set_experiment_fields` records a reviewer and a
 * planned end on an experiment. Only a writer may set them, the reviewer must
 * be a workspace member, and the record must exist in the caller's workspace.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000001b0a'
const OTHER_WS = '00000000-0000-4000-8000-000000001b0b'
const OWNER = 'expf-owner'
const VIEWER = 'expf-viewer'
const OUTSIDER = 'expf-outsider'
const EXP = '00000000-0000-4000-8000-000000001b10'
const EXP_OTHER = '00000000-0000-4000-8000-000000001b11'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
     ($1,'Owner','expf-owner@test.invalid',true),
     ($2,'Viewer','expf-viewer@test.invalid',true),
     ($3,'Outsider','expf-outsider@test.invalid',true)`,
    [OWNER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'expf','EXPF'),($2,'expf2','EXPF2')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values ($1,$2,'experiment','EXP-EXPF','Set fields experiment','draft',$3),
            ($4,$5,'experiment','EXP-EXPF-O','Other','draft',$6)`,
    [EXP, WS, OWNER, EXP_OTHER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values ('00000000-0000-4000-8000-000000001b12',$1,'sample','SMP-EXPF','A sample','available',$2)`,
    [WS, OWNER],
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

const setFields = (
  client: Client,
  recordId: string,
  reviewer: string | null,
  planned: string | null,
) =>
  client.query(
    `select reviewer_user_id, planned_end from api.set_experiment_fields($1,$2,$3::date)`,
    [recordId, reviewer, planned],
  )

describe('set_experiment_fields', () => {
  it('sets a reviewer and a planned end for a writer', async () => {
    const owner = await actor(OWNER, WS)
    const { rows } = await setFields(owner, EXP, VIEWER, '2026-12-01')
    expect(rows[0]?.reviewer_user_id).toBe(VIEWER)
    const planned = rows[0]?.planned_end as unknown as string | Date
    expect(new Date(planned).toISOString().slice(0, 10)).toBe('2026-12-01')
  })

  it('denies a viewer without write capability', async () => {
    const viewer = await actor(VIEWER, WS)
    await expect(
      setFields(viewer, EXP, VIEWER, '2026-12-01'),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses a reviewer who is not a workspace member', async () => {
    const owner = await actor(OWNER, WS)
    await expect(
      setFields(owner, EXP, OUTSIDER, '2026-12-01'),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('refuses a record outside the caller’s workspace', async () => {
    const owner = await actor(OWNER, WS)
    // The record lives in another workspace, so the caller has no write
    // capability there: the mutation is denied.
    await expect(
      setFields(owner, EXP_OTHER, null, '2026-12-01'),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
