/**
 * RM-116: Inbox read state. `mark_work_items_seen` records the caller's own
 * seen keys; a person reads only their own; a non-member is denied.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000210a'
const OTHER_WS = '00000000-0000-4000-8000-00000000210b'
const USER = 'wiv-user'
const OTHER = 'wiv-other'
const OUTSIDER = 'wiv-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
     ($1,'User','wiv-user@test.invalid',true),
     ($2,'Other','wiv-other@test.invalid',true),
     ($3,'Outsider','wiv-outsider@test.invalid',true)`,
    [USER, OTHER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'wiv','WIV'),($2,'wiv2','WIV2')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, USER, OTHER, OTHER_WS, OUTSIDER],
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

const mark = (client: Client, keys: string[]) =>
  client.query('select api.mark_work_items_seen($1::text[]) as n', [keys])

describe('mark_work_items_seen', () => {
  it('records the caller’s seen keys', async () => {
    const user = await actor(USER, WS)
    const { rows } = await mark(user, ['data_issue:DS-1', 'run_failed:PL-1'])
    expect(Number(rows[0].n)).toBe(2)
    const seen = await user.query<{ item_key: string }>(
      'select item_key from api.work_item_views order by item_key',
    )
    expect(seen.rows.map((r) => r.item_key)).toEqual([
      'data_issue:DS-1',
      'run_failed:PL-1',
    ])
  })

  it('shows a person only their own seen keys', async () => {
    const other = await actor(OTHER, WS)
    const { rows } = await other.query(
      'select item_key from api.work_item_views',
    )
    expect(rows).toHaveLength(0)
  })

  it('denies a non-member', async () => {
    const outsider = await actor(OUTSIDER, WS)
    await expect(mark(outsider, ['x:1'])).rejects.toMatchObject({
      code: '42501',
    })
  })
})
