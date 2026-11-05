/**
 * Saved list views (migration 0086): the sorting and hidden columns a person
 * chose for a list are theirs alone.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000f911'
const ANA = 'lv-ana'
const BEN = 'lv-ben'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let ana: Client
let ben: Client

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${ANA}','Ana','lv-ana@test.invalid',true),
      ('${BEN}','Ben','lv-ben@test.invalid',true);
    insert into api.workspaces(id,slug,name) values ('${WS}','list-views','Lists');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${ANA}','member'),('${WS}','${BEN}','member')`)
  ana = await actor(ANA)
  ben = await actor(BEN)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('saved list views', () => {
  it('remembers a person’s sorting and hidden columns, and replaces them', async () => {
    await ana.query(`select api.set_list_view('samples', $1, $2)`, [
      JSON.stringify([{ id: 'title', desc: true }]),
      JSON.stringify(['location']),
    ])
    await ana.query(`select api.set_list_view('samples', $1, '[]')`, [
      JSON.stringify([{ id: 'status', desc: false }]),
    ])
    const { rows } = await ana.query(
      `select sorting, hidden_columns from api.list_views where list_key = 'samples'`,
    )
    expect(rows).toEqual([
      { sorting: [{ id: 'status', desc: false }], hidden_columns: [] },
    ])
  })

  it('shows each person only their own choices', async () => {
    const { rows } = await ben.query(`select * from api.list_views`)
    expect(rows).toEqual([])
  })

  it('forgets the choice when both lists are emptied', async () => {
    await ana.query(`select api.set_list_view('samples', '[]', '[]')`)
    const { rows } = await ana.query(`select * from api.list_views`)
    expect(rows).toEqual([])
  })

  it('refuses values that are not lists, and writing the table directly', async () => {
    await expectDenied(
      ana.query(`select api.set_list_view('samples', '{"a":1}', '[]')`),
      '22023',
    )
    await expectDenied(
      ana.query(
        `insert into api.list_views(user_id, list_key) values ('${BEN}', 'x')`,
      ),
      '42501',
    )
  })
})
