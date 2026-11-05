/**
 * Sidebar pages (migration 0084): the pages a lab takes out of everyone's
 * sidebar, and the groups each person folds.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000f901'
const OTHER_WS = '00000000-0000-4000-8000-00000000f902'
const OWNER = 'sb-owner'
const MEMBER = 'sb-member'
const STRANGER = 'sb-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let member: Client
let stranger: Client

async function actor(userId: string, workspace = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','sb-owner@test.invalid',true),
      ('${MEMBER}','Member','sb-member@test.invalid',true),
      ('${STRANGER}','Stranger','sb-stranger@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS}','sidebar','Sidebar'),
      ('${OTHER_WS}','sidebar-other','Sidebar other');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${MEMBER}','member'),
      ('${OTHER_WS}','${STRANGER}','owner')`)
  owner = await actor(OWNER)
  member = await actor(MEMBER)
  stranger = await actor(STRANGER, OTHER_WS)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('hidden sidebar pages', () => {
  it('lets an admin hide pages, keeping each once and in order', async () => {
    const { rows } = await owner.query(
      `select hidden_nav_pages from api.set_hidden_nav_pages($1, $2)`,
      [WS, ['shipments', 'incidents', 'shipments']],
    )
    expect(rows[0].hidden_nav_pages).toEqual(['incidents', 'shipments'])
    const read = await owner.query(
      `select hidden_nav_pages from api.workspace_settings where workspace_id = $1`,
      [WS],
    )
    expect(read.rows[0].hidden_nav_pages).toEqual(['incidents', 'shipments'])
  })

  it('shows everything again when the list is emptied', async () => {
    const { rows } = await owner.query(
      `select hidden_nav_pages from api.set_hidden_nav_pages($1, '{}')`,
      [WS],
    )
    expect(rows[0].hidden_nav_pages).toEqual([])
  })

  it('refuses a member and another workspace', async () => {
    await expectDenied(
      member.query(`select api.set_hidden_nav_pages($1, '{shipments}')`, [WS]),
      'SB056',
    )
    await expectDenied(
      stranger.query(`select api.set_hidden_nav_pages($1, '{shipments}')`, [
        WS,
      ]),
      'SB056',
    )
  })

  it('refuses a page name that is not a page name', async () => {
    await expectDenied(
      owner.query(`select api.set_hidden_nav_pages($1, $2)`, [
        WS,
        ['Robert; drop table'],
      ]),
      '23514',
    )
  })
})

describe('folded sidebar groups', () => {
  it('remembers each person’s own folds', async () => {
    await member.query(`select api.set_nav_folded('{methods,data,methods}')`)
    const mine = await member.query(
      `select nav_folded from api.user_preferences`,
    )
    expect(mine.rows[0].nav_folded).toEqual(['data', 'methods'])
    const theirs = await owner.query(
      `select nav_folded from api.user_preferences`,
    )
    expect(theirs.rows.every((r) => r.nav_folded.length === 0)).toBe(true)
  })
})
