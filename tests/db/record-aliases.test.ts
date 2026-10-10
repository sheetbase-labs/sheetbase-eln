/**
 * LAB-06 — record aliases ("also known as"): a workspace writer adds a
 * secondary code for a record; members read it; viewers cannot; another
 * workspace cannot; an alias already used by a different record is refused.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000130a'
const WS_B = '00000000-0000-4000-8000-00000000130b'
const OWNER = 'alias-owner'
const VIEWER = 'alias-viewer'
const RECORD_A = '00000000-0000-4000-8000-00000000131a'
const RECORD_A2 = '00000000-0000-4000-8000-00000000131b'
const RECORD_B = '00000000-0000-4000-8000-00000000131c'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','alias-owner@test.invalid',true),($2,'Viewer','alias-viewer@test.invalid',true)`,
    [OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'alias-a','Alias A'),($2,'alias-b','Alias B')`,
    [WS_A, WS_B],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$3,'owner'),($1,$4,'viewer'),($2,$3,'owner')`,
    [WS_A, WS_B, OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,created_by_user_id) values ($1,$4,'sample','SMP-A','A',$6),($2,$4,'sample','SMP-A2','A2',$6),($3,$5,'sample','SMP-B','B',$6)`,
    [RECORD_A, RECORD_A2, RECORD_B, WS_A, WS_B, OWNER],
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

async function addAlias(
  client: Client,
  recordId: string,
  alias: string,
): Promise<string> {
  const { rows } = await client.query<{ alias: string }>(
    `select (api.add_record_alias($1,$2)).alias`,
    [recordId, alias],
  )
  return rows[0]!.alias
}

describe('record aliases', () => {
  it('lets a writer add an alias and members read it', async () => {
    const owner = await actor(OWNER, WS_A)
    expect(await addAlias(owner, RECORD_A, 'HL-0934')).toBe('HL-0934')
    const { rows } = await owner.query(
      `select record_id from api.record_aliases where lower(alias) = 'hl-0934'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.record_id).toBe(RECORD_A)
  })

  it('is idempotent for the same record', async () => {
    const owner = await actor(OWNER, WS_A)
    expect(await addAlias(owner, RECORD_A, 'HL-0934')).toBe('HL-0934')
  })

  it('refuses an alias already used by another record', async () => {
    const owner = await actor(OWNER, WS_A)
    await expect(
      owner.query(`select api.add_record_alias($1,'HL-0934')`, [RECORD_A2]),
    ).rejects.toMatchObject({ code: 'SB072' })
  })

  it('denies a viewer', async () => {
    const viewer = await actor(VIEWER, WS_A)
    await expect(
      viewer.query(`select api.add_record_alias($1,'VIEW-1')`, [RECORD_A]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('denies a record in another workspace', async () => {
    const owner = await actor(OWNER, WS_A)
    await expect(
      owner.query(`select api.add_record_alias($1,'CROSS-1')`, [RECORD_B]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('removes an alias', async () => {
    const owner = await actor(OWNER, WS_A)
    await owner.query(`select api.remove_record_alias($1,'HL-0934')`, [
      RECORD_A,
    ])
    const { rows } = await owner.query(
      `select 1 from api.record_aliases where lower(alias) = 'hl-0934'`,
    )
    expect(rows).toHaveLength(0)
  })
})
