/**
 * A person who cannot book an instrument asks to be qualified; owners are told
 * through the Inbox, a grant settles the request, and the person is told they
 * can book. Requests are visible to their author and to owners only.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c810'
const OTHER_WS = '00000000-0000-4000-8000-00000000c811'
const INSTRUMENT = '00000000-0000-4000-8000-00000000c812'
const ADMIN = 'qreq-admin'
const ANALYST = 'qreq-analyst'
const PEER = 'qreq-peer'
const OUTSIDER = 'qreq-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [ADMIN, ANALYST, PEER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'qreq','QREQ'),($2,'qreq-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'analyst'),($1,$4,'analyst'),($5,$6,'owner')`,
    [WS, ADMIN, ANALYST, PEER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,instrument_type,created_by_user_id)
     values($1,$2,'Plate reader PR-01','qpcr',$3)`,
    [INSTRUMENT, WS, ADMIN],
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

async function kinds(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ kind: string }>(
    'select kind from api.my_work_items',
  )
  return rows.map((row) => row.kind)
}

describe('instrument qualification requests', () => {
  it('lets a member ask once, however many times they press the button', async () => {
    const analyst = await actor(ANALYST)
    const first = await analyst.query(
      'select * from api.request_instrument_qualification($1,$2)',
      [INSTRUMENT, 'Running the PR-01 plates next week'],
    )
    const again = await analyst.query(
      'select * from api.request_instrument_qualification($1,$2)',
      [INSTRUMENT, null],
    )
    expect(again.rows[0].id).toBe(first.rows[0].id)
    expect(again.rows[0].note).toBe('Running the PR-01 plates next week')
    const { rows } = await migrator.query(
      `select count(*)::int n from api.instrument_qualification_requests where status='pending'`,
    )
    expect(rows[0].n).toBe(1)
  })

  it('tells owners, and only owners, that someone is waiting', async () => {
    expect(await kinds(await actor(ADMIN))).toContain('qualification_requested')
    expect(await kinds(await actor(PEER))).not.toContain(
      'qualification_requested',
    )
    // The requester is waiting, not being asked.
    expect(await kinds(await actor(ANALYST))).not.toContain(
      'qualification_requested',
    )
  })

  it('shows a request to its author and to owners, not to a colleague or another workspace', async () => {
    const sees = async (client: Client) =>
      (
        await client.query(
          'select id from api.instrument_qualification_requests',
        )
      ).rows.length
    expect(await sees(await actor(ANALYST))).toBe(1)
    expect(await sees(await actor(ADMIN))).toBe(1)
    expect(await sees(await actor(PEER))).toBe(0)
    expect(await sees(await actor(OUTSIDER, OTHER_WS))).toBe(0)
  })

  it('refuses a request for an instrument in another workspace', async () => {
    const outsider = await actor(OUTSIDER, OTHER_WS)
    await expectDenied(
      outsider.query(
        'select * from api.request_instrument_qualification($1,$2)',
        [INSTRUMENT, null],
      ),
      '42501',
    )
  })

  it('does not let a member decide a request', async () => {
    const analyst = await actor(ANALYST)
    const pending = await migrator.query<{ id: string }>(
      `select id from api.instrument_qualification_requests where status='pending'`,
    )
    await expectDenied(
      analyst.query(
        'select * from api.dismiss_instrument_qualification_request($1)',
        [pending.rows[0]!.id],
      ),
      '42501',
    )
  })

  it('settles the request when the qualification is granted and tells the requester', async () => {
    const admin = await actor(ADMIN)
    await admin.query(
      'select * from api.set_instrument_qualification($1,$2,$3)',
      [
        INSTRUMENT,
        ANALYST,
        new Date(Date.now() + 90 * 86_400_000).toISOString(),
      ],
    )
    const settled = await migrator.query(
      `select status, decided_by_user_id from api.instrument_qualification_requests
        where user_id=$1`,
      [ANALYST],
    )
    expect(settled.rows[0]).toMatchObject({
      status: 'granted',
      decided_by_user_id: ADMIN,
    })
    expect(await kinds(await actor(ADMIN))).not.toContain(
      'qualification_requested',
    )
    expect(await kinds(await actor(ANALYST))).toContain('qualification_granted')
  })

  it('will not take a request from someone who is already qualified', async () => {
    const analyst = await actor(ANALYST)
    await expectDenied(
      analyst.query(
        'select * from api.request_instrument_qualification($1,$2)',
        [INSTRUMENT, null],
      ),
      '22023',
    )
  })

  it('lets an owner dismiss a request, which clears their item', async () => {
    const peer = await actor(PEER)
    const asked = await peer.query(
      'select * from api.request_instrument_qualification($1,$2)',
      [INSTRUMENT, null],
    )
    const admin = await actor(ADMIN)
    expect(await kinds(admin)).toContain('qualification_requested')
    await admin.query(
      'select * from api.dismiss_instrument_qualification_request($1)',
      [asked.rows[0].id],
    )
    expect(await kinds(admin)).not.toContain('qualification_requested')
    expect(await kinds(peer)).not.toContain('qualification_granted')
  })
})
