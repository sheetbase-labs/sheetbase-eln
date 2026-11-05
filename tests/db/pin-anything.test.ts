/**
 * Pin anything (migration 0089): instruments and pipelines can be pinned like
 * records and projects, only by members of their workspace, and a person can
 * fold the pins under any number of sidebar pages.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000f911'
const OTHER_WS = '00000000-0000-4000-8000-00000000f912'
const INSTRUMENT = '00000000-0000-4000-8000-00000000f913'
const PIPELINE = '00000000-0000-4000-8000-00000000f914'
const MEMBER = 'pin-member'
const STRANGER = 'pin-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let member: Client
let stranger: Client

async function actor(userId: string, workspace: string): Promise<Client> {
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
      ('${MEMBER}','Member','pin-member@test.invalid',true),
      ('${STRANGER}','Stranger','pin-stranger@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS}','pins','Pins'),
      ('${OTHER_WS}','pins-other','Pins other');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${MEMBER}','member'),
      ('${OTHER_WS}','${STRANGER}','owner');
    insert into api.instruments(id,workspace_id,name)
      values ('${INSTRUMENT}','${WS}','Plate reader 2');
    insert into api.pipeline_definitions(id,workspace_id,key,name)
      values ('${PIPELINE}','${WS}','weekly','Weekly summary')`)
  member = await actor(MEMBER, WS)
  stranger = await actor(STRANGER, OTHER_WS)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('pinning instruments and pipelines', () => {
  it('pins and unpins them for a member', async () => {
    for (const [kind, id] of [
      ['instrument', INSTRUMENT],
      ['pipeline', PIPELINE],
    ]) {
      const pinned = await member.query(
        `select api.set_record_favourite($1, $2, true) as at`,
        [kind, id],
      )
      expect(pinned.rows[0].at).not.toBeNull()
    }
    const mine = await member.query(
      `select object_kind from api.user_favourites order by object_kind`,
    )
    expect(mine.rows.map((r) => r.object_kind)).toEqual([
      'instrument',
      'pipeline',
    ])
    await member.query(
      `select api.set_record_favourite('instrument', $1, false)`,
      [INSTRUMENT],
    )
    const after = await member.query(
      `select object_kind from api.user_favourites`,
    )
    expect(after.rows.map((r) => r.object_kind)).toEqual(['pipeline'])
  })

  it('ignores a pin on another workspace’s instrument', async () => {
    const { rows } = await stranger.query(
      `select api.set_record_favourite('instrument', $1, true) as at`,
      [INSTRUMENT],
    )
    expect(rows[0].at).toBeNull()
    const theirs = await migrator.query(
      `select count(*)::int as n from api.user_favourites where user_id = $1`,
      [STRANGER],
    )
    expect(theirs.rows[0].n).toBe(0)
  })
})

describe('folding pins per page', () => {
  it('keeps folds for many pages at once', async () => {
    const folds = [
      'work',
      'lab',
      'data',
      'methods',
      'pins-projects',
      'pins-experiments',
      'pins-samples',
      'pins-materials',
      'pins-instruments',
      'pins-datasets',
      'pins-pipelines',
    ]
    await member.query(`select api.set_nav_folded($1)`, [folds])
    const { rows } = await member.query(
      `select nav_folded from api.user_preferences`,
    )
    expect(rows[0].nav_folded).toHaveLength(folds.length)
  })
})
