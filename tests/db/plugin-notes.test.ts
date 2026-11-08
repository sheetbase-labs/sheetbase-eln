/**
 * Notes from plugin reactions (migration plugin_notes): they show in the
 * Inbox of the person they are for, for two weeks, nobody else sees them, and
 * only the app can write them.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fa01'
const A = 'pn-a'
const B = 'pn-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function note(userId: string, title: string, ageDays = 0) {
  await migrator.query(
    `insert into api.plugin_notes(workspace_id,user_id,extension_key,extension_name,hook_id,event_id,title,body,created_at)
     values ($1,$2,'bench-extras','Bench extras','on-release',gen_random_uuid(),$3,'Box 3',now() - make_interval(days => $4))`,
    [WS, userId, title, ageDays],
  )
}

async function inbox(client: Client) {
  const { rows } = await client.query(
    `select kind, title, reason, inbox_type from api.inbox_work_items where kind='plugin_note' order by title`,
  )
  return rows as Array<{ title: string; reason: string; inbox_type: string }>
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [A, B]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'pn','Plugin notes')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'owner')`,
    [WS, A, B],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('plugin notes', () => {
  it('show in the Inbox of the person they are for, and not for anyone else', async () => {
    const a = await actor(A)
    const b = await actor(B)
    await note(A, 'Check the label')
    expect(await inbox(a)).toEqual([
      expect.objectContaining({
        title: 'Check the label',
        reason: 'Box 3',
        inbox_type: 'lab',
      }),
    ])
    expect(await inbox(b)).toEqual([])
  })

  it('go after two weeks', async () => {
    const a = await actor(A)
    await note(A, 'Old news', 15)
    expect((await inbox(a)).map((row) => row.title)).not.toContain('Old news')
  })

  it('cannot be written from the API, and one event leaves one note', async () => {
    const a = await actor(A)
    await expect(
      a.query(
        `insert into api.plugin_notes(workspace_id,user_id,extension_key,extension_name,hook_id,event_id,title)
         values ($1,$2,'x','x','x',gen_random_uuid(),'Forged')`,
        [WS, A],
      ),
    ).rejects.toBeTruthy()
    const event = crypto.randomUUID()
    const insert = `insert into api.plugin_notes(workspace_id,user_id,extension_key,extension_name,hook_id,event_id,title)
       values ($1,$2,'bench-extras','Bench extras','on-release',$3,'Once') on conflict do nothing`
    await migrator.query(insert, [WS, A, event])
    await migrator.query(insert, [WS, A, event])
    const { rows } = await migrator.query(
      `select count(*)::int as n from api.plugin_notes where event_id=$1`,
      [event],
    )
    expect(rows[0].n).toBe(1)
  })
})
