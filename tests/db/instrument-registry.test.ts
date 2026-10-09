/**
 * LAB-06 — instrument registry: a workspace writer registers an instrument
 * with its location and owner, and retires or reinstates it; a viewer and
 * another workspace are denied, and a duplicate serial is refused.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000160a'
const WS_B = '00000000-0000-4000-8000-00000000160b'
const OWNER = 'ins-owner'
const VIEWER = 'ins-viewer'
const INSTRUMENT_B = '00000000-0000-4000-8000-00000000161b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','ins-owner@test.invalid',true),($2,'Viewer','ins-viewer@test.invalid',true)`,
    [OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'ins-a','Ins A'),($2,'ins-b','Ins B')`,
    [WS_A, WS_B],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$3,'owner'),($1,$4,'viewer'),($2,$3,'owner')`,
    [WS_A, WS_B, OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,instrument_type) values ($1,$2,'PCR B','qpcr')`,
    [INSTRUMENT_B, WS_B],
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

const create = (
  client: Client,
  workspaceId: string,
  name: string,
  serial: string,
) =>
  client.query(
    `select * from api.create_instrument($1,$2,'qpcr','Model X',$3,'Vendor','Lab 2',$4)`,
    [workspaceId, name, serial, OWNER],
  )

describe('instrument registry', () => {
  it('lets a writer register an instrument with location and owner', async () => {
    const owner = await actor(OWNER, WS_A)
    const { rows } = await create(owner, WS_A, 'Osmometer OS-02', 'SN-0001')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('Osmometer OS-02')
    expect(rows[0]!.location).toBe('Lab 2')
    expect(rows[0]!.owner_id).toBe(OWNER)
    expect(rows[0]!.display_id).toMatch(/^INS-\d{4,}$/)
  })

  it('refuses a duplicate serial number', async () => {
    const owner = await actor(OWNER, WS_A)
    await create(owner, WS_A, 'Second', 'SN-DUP')
    await expect(create(owner, WS_A, 'Third', 'SN-DUP')).rejects.toMatchObject({
      code: '23505',
    })
  })

  it('denies a viewer', async () => {
    const viewer = await actor(VIEWER, WS_A)
    await expect(
      create(viewer, WS_A, 'Viewer instrument', 'SN-VIEW'),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('denies another workspace', async () => {
    const owner = await actor(OWNER, WS_A)
    await expect(
      create(owner, WS_B, 'Wrong workspace', 'SN-WS'),
    ).rejects.toMatchObject({ code: 'SB033' })
  })

  it('retires and reinstates an instrument, denying a viewer', async () => {
    const owner = await actor(OWNER, WS_A)
    const { rows } = await create(owner, WS_A, 'Retire me', 'SN-RET')
    const id = rows[0]!.id as string
    const retired = await owner.query(
      `select * from api.set_instrument_retired($1,true)`,
      [id],
    )
    expect(retired.rows[0]!.retired_at).not.toBeNull()
    const reinstated = await owner.query(
      `select * from api.set_instrument_retired($1,false)`,
      [id],
    )
    expect(reinstated.rows[0]!.retired_at).toBeNull()

    const viewer = await actor(VIEWER, WS_A)
    await expect(
      viewer.query(`select * from api.set_instrument_retired($1,true)`, [id]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
