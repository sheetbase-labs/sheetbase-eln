/**
 * Saved searches belong to the person: they are stored per person and
 * workspace, readable only by their owner, capped at 20, and removable only by
 * the person who saved them.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '0d060000-0000-4000-8000-00000000000a'
const ALICE = 'saved-searches-alice'
const BOB = 'saved-searches-bob'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string) {
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
      ('${ALICE}','Alice','saved-alice@test.invalid',true),
      ('${BOB}','Bob','saved-bob@test.invalid',true);
    insert into api.workspaces(id,slug,name) values ('${WS}','saved-searches','Saved');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${ALICE}','scientist'),('${WS}','${BOB}','viewer');
  `)
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('saved searches', () => {
  it('keeps a search for the person who saved it and nobody else', async () => {
    const alice = await actor(ALICE)
    await alice.query(
      `select api.save_search('Buffers', 'buffer', '{"type":["Samples"]}'::jsonb)`,
    )
    const own = await alice.query(
      `select name, query, facets from api.saved_searches`,
    )
    expect(own.rows).toEqual([
      { name: 'Buffers', query: 'buffer', facets: { type: ['Samples'] } },
    ])
    const bob = await actor(BOB)
    expect((await bob.query(`select 1 from api.saved_searches`)).rowCount).toBe(
      0,
    )
  })

  it('lists a repeated save once', async () => {
    const alice = await actor(ALICE)
    for (let i = 0; i < 2; i++)
      await alice.query(`select api.save_search('Twice', 'twice', '{}'::jsonb)`)
    const { rows } = await alice.query(
      `select count(*)::int n from api.saved_searches where name = 'Twice'`,
    )
    expect(rows[0].n).toBe(1)
  })

  it('keeps the newest twenty', async () => {
    const alice = await actor(ALICE)
    for (let i = 0; i < 25; i++)
      await alice.query(`select api.save_search($1, $2, '{}'::jsonb)`, [
        `Search ${i}`,
        `query ${i}`,
      ])
    const { rows } = await alice.query(
      `select count(*)::int n from api.saved_searches`,
    )
    expect(rows[0].n).toBe(20)
    const newest = await alice.query(
      `select 1 from api.saved_searches where name = 'Search 24'`,
    )
    expect(newest.rowCount).toBe(1)
  })

  it("will not remove someone else's search", async () => {
    const alice = await actor(ALICE)
    const { rows } = await alice.query<{ id: string }>(
      `select (api.save_search('Mine', 'mine', '{}'::jsonb)).id`,
    )
    const id = Object.values(rows[0])[0] as string
    const bob = await actor(BOB)
    await bob.query(`select api.delete_saved_search($1)`, [id])
    expect(
      (
        await alice.query(`select 1 from api.saved_searches where id = $1`, [
          id,
        ])
      ).rowCount,
    ).toBe(1)
    await alice.query(`select api.delete_saved_search($1)`, [id])
    expect(
      (
        await alice.query(`select 1 from api.saved_searches where id = $1`, [
          id,
        ])
      ).rowCount,
    ).toBe(0)
  })

  it('refuses an empty name or query', async () => {
    const alice = await actor(ALICE)
    await expect(
      alice.query(`select api.save_search('  ', 'x', '{}'::jsonb)`),
    ).rejects.toThrow()
    await expect(
      alice.query(`select api.save_search('x', ' ', '{}'::jsonb)`),
    ).rejects.toThrow()
  })
})
