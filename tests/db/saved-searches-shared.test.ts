/**
 * Saved searches can be shared with the workspace. Anyone but a viewer can share
 * one; the person who saved it, or a workspace manager, can rename, unshare or
 * delete it; API clients read shared searches and run them, and never see
 * anyone's private ones.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '0d060000-0000-4000-8000-00000000000b'
const OWNER = 'shared-searches-owner'
const ALICE = 'shared-searches-alice'
const CAROL = 'shared-searches-carol'
const BOB = 'shared-searches-bob'

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

async function apiClient() {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE api_client')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'api_client',
      workspace_id: WS,
      scopes: ['projects:read'],
    }),
  ])
  return client
}

async function share(
  who: Client,
  name: string,
  query = 'buffer',
  args: Record<string, unknown> | null = null,
) {
  const { rows } = await who.query<{ id: string }>(
    `select (api.save_search($1, $2, '{}'::jsonb, 'workspace', $3::jsonb)).id`,
    [name, query, args ? JSON.stringify(args) : null],
  )
  return Object.values(rows[0])[0] as string
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owen','shared-owner@test.invalid',true),
      ('${ALICE}','Alice','shared-alice@test.invalid',true),
      ('${CAROL}','Carol','shared-carol@test.invalid',true),
      ('${BOB}','Bob','shared-bob@test.invalid',true);
    insert into api.workspaces(id,slug,name) values ('${WS}','shared-searches','Shared');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),('${WS}','${ALICE}','scientist'),
      ('${WS}','${CAROL}','scientist'),('${WS}','${BOB}','viewer');
  `)
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('shared saved searches', () => {
  it('shows a shared search to everyone in the workspace, a private one only to its owner', async () => {
    const alice = await actor(ALICE)
    await share(alice, 'Open buffers')
    await alice.query(`select api.save_search('Just mine', 'mine')`)
    const carol = await actor(CAROL)
    const seen = await carol.query(
      `select name, visibility from api.saved_searches order by name`,
    )
    expect(seen.rows).toEqual([
      { name: 'Open buffers', visibility: 'workspace' },
    ])
    const bob = await actor(BOB)
    expect(
      (await bob.query(`select name from api.saved_searches`)).rows,
    ).toEqual([{ name: 'Open buffers' }])
  })

  it('keeps shared names unique, ignoring case', async () => {
    const alice = await actor(ALICE)
    await share(alice, 'Weekly review')
    const carol = await actor(CAROL)
    await expect(share(carol, 'weekly REVIEW')).rejects.toThrow(
      /already exists/,
    )
    // The person who saved it can save it again under the same name.
    await share(alice, 'weekly review', 'changed')
    const { rows } = await alice.query(
      `select count(*)::int n from api.saved_searches where lower(name) = 'weekly review'`,
    )
    expect(rows[0].n).toBe(1)
  })

  it('does not let a viewer share, but lets them keep private searches', async () => {
    const bob = await actor(BOB)
    await expect(share(bob, 'Viewer share')).rejects.toThrow(/cannot share/)
    await bob.query(`select api.save_search('Viewer private', 'x')`)
    const own = await bob.query(
      `select name from api.saved_searches where visibility = 'private'`,
    )
    expect(own.rows).toEqual([{ name: 'Viewer private' }])
  })

  it('does not count shared searches against the private limit of twenty', async () => {
    const carol = await actor(CAROL)
    await share(carol, 'Carol shared')
    for (let i = 0; i < 22; i++)
      await carol.query(`select api.save_search($1, $2)`, [
        `Private ${i}`,
        `q ${i}`,
      ])
    const { rows } = await carol.query(
      `select visibility, count(*)::int n from api.saved_searches
        where user_id = '${CAROL}' group by visibility order by visibility`,
    )
    expect(rows).toEqual([
      { visibility: 'private', n: 20 },
      { visibility: 'workspace', n: 1 },
    ])
  })

  it('lets the author, or a workspace manager, change or delete a shared search, and nobody else', async () => {
    const alice = await actor(ALICE)
    const id = await share(alice, 'Alice owns this')
    const carol = await actor(CAROL)
    await expect(
      carol.query(`select api.update_saved_search($1, 'Hijacked')`, [id]),
    ).rejects.toThrow(/only the person who saved/)
    await carol.query(`select api.delete_saved_search($1)`, [id])
    expect(
      (
        await alice.query(`select 1 from api.saved_searches where id = $1`, [
          id,
        ])
      ).rowCount,
    ).toBe(1)

    await alice.query(`select api.update_saved_search($1, 'Renamed')`, [id])
    const owner = await actor(OWNER)
    await owner.query(`select api.update_saved_search($1, 'Tidied')`, [id])
    expect(
      (
        await alice.query(`select name from api.saved_searches where id = $1`, [
          id,
        ])
      ).rows,
    ).toEqual([{ name: 'Tidied' }])
    await owner.query(`select api.delete_saved_search($1)`, [id])
    expect(
      (
        await alice.query(`select 1 from api.saved_searches where id = $1`, [
          id,
        ])
      ).rowCount,
    ).toBe(0)
  })

  it('can stop sharing, and the search goes back to being private', async () => {
    const alice = await actor(ALICE)
    const id = await share(alice, 'Short lived')
    await alice.query(`select api.update_saved_search($1, null, 'private')`, [
      id,
    ])
    const carol = await actor(CAROL)
    expect(
      (
        await carol.query(`select 1 from api.saved_searches where id = $1`, [
          id,
        ])
      ).rowCount,
    ).toBe(0)
  })

  it("will not let a manager see or change another person's private search", async () => {
    const alice = await actor(ALICE)
    const { rows } = await alice.query(
      `select (api.save_search('Alice private', 'p')).id`,
    )
    const id = Object.values(rows[0])[0] as string
    const owner = await actor(OWNER)
    await expect(
      owner.query(`select api.update_saved_search($1, 'x', 'workspace')`, [id]),
    ).rejects.toThrow(/not found/)
    await owner.query(`select api.delete_saved_search($1)`, [id])
    expect(
      (
        await alice.query(`select 1 from api.saved_searches where id = $1`, [
          id,
        ])
      ).rowCount,
    ).toBe(1)
  })

  it('refuses arguments the search does not take', async () => {
    const alice = await actor(ALICE)
    await expect(
      share(alice, 'Bad args', 'x', { p_limit: 500 }),
    ).rejects.toThrow()
  })

  it('lets an API client read shared searches and run them, and never sees private ones', async () => {
    const alice = await actor(ALICE)
    const id = await share(alice, 'Everything', 'shared', {
      p_sort: 'updated',
      p_include_archived: false,
    })
    const client = await apiClient()
    const names = await client.query(
      `select name from api.saved_searches order by name`,
    )
    expect(names.rows.map((r) => r.name)).not.toContain('Alice private')
    expect(names.rows.map((r) => r.name)).toContain('Everything')
    const run = await client.query(
      `select count(*)::int n from api.run_saved_search($1, 5, 0)`,
      [id],
    )
    expect(run.rows[0].n).toBe(0)
    await expect(
      client.query(`select api.save_search('Nope', 'x')`),
    ).rejects.toThrow()
    // A private search is not found, even by id.
    const { rows } = await alice.query(
      `select (api.save_search('Private again', 'p')).id`,
    )
    const privateId = Object.values(rows[0])[0] as string
    await expect(
      client.query(`select * from api.run_saved_search($1)`, [privateId]),
    ).rejects.toThrow(/not found/)
  })

  it('runs a saved search for the person who can see it, with the arguments it was saved with', async () => {
    const alice = await actor(ALICE)
    const id = await share(alice, 'Runs', 'zzzz-nothing-matches-this')
    const { rows } = await alice.query(
      `select count(*)::int n from api.run_saved_search($1)`,
      [id],
    )
    expect(rows[0].n).toBe(0)
  })
})
