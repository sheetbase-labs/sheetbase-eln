/**
 * LAB-06.1 — instrument rename and move history.
 *
 * The RecordInstrument board shows an instrument's name and location history,
 * and the signed-text rule keeps the name captured at signing beside the current
 * one. The history is the instrument's own change events, now field-level: an
 * update that touches nothing the board tracks writes no history.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000ca00'
const OTHER_WS = '00000000-0000-4000-8000-00000000ca01'
const INSTRUMENT = '00000000-0000-4000-8000-00000000ca02'
const ADMIN = 'lab061-admin'
const OUTSIDER = 'lab061-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [ADMIN, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'lab061','LAB-06.1'),($2,'lab061-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($3,$4,'owner')`,
    [WS, ADMIN, OTHER_WS, OUTSIDER],
  )
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

async function history(client: Client, instrumentId = INSTRUMENT) {
  return (
    await client.query<{
      operation: string
      from_name: string | null
      to_name: string | null
      from_location: string | null
      to_location: string | null
    }>(
      'select operation,from_name,to_name,from_location,to_location from api.instrument_history($1)',
      [instrumentId],
    )
  ).rows
}

describe('LAB-06.1 instrument rename and move history', () => {
  it('records the create, then a rename and a move with their old values', async () => {
    const admin = await actor(ADMIN)
    await admin.query(
      `insert into api.instruments(id,workspace_id,name,instrument_type,location,created_by_user_id)
       values($1,$2,'Plate reader PR-01','qpcr','Bay 2',$3)`,
      [INSTRUMENT, WS, ADMIN],
    )
    await admin.query(
      `update api.instruments set name='Plate reader PR-01 (relocated)' where id=$1`,
      [INSTRUMENT],
    )
    await admin.query(
      `update api.instruments set location='Bay 5' where id=$1`,
      [INSTRUMENT],
    )
    const rows = await history(admin)
    // Newest first: the move, the rename, then the create.
    expect(rows.map((row) => row.operation)).toEqual([
      'update',
      'update',
      'create',
    ])
    expect(rows[0]).toMatchObject({
      from_location: 'Bay 2',
      to_location: 'Bay 5',
      from_name: null,
    })
    expect(rows[1]).toMatchObject({
      from_name: 'Plate reader PR-01',
      to_name: 'Plate reader PR-01 (relocated)',
    })
    expect(rows[2]).toMatchObject({ to_name: 'Plate reader PR-01' })
  })

  it('writes no history for an update that changes nothing it tracks', async () => {
    const admin = await actor(ADMIN)
    const before = (await history(admin)).length
    await admin.query(
      `update api.instruments set connection_status='connected' where id=$1`,
      [INSTRUMENT],
    )
    expect(await history(admin)).toHaveLength(before)
  })

  it('keeps another workspace out of the history', async () => {
    const outsider = await actor(OUTSIDER, OTHER_WS)
    expect(await history(outsider)).toEqual([])
  })
})
