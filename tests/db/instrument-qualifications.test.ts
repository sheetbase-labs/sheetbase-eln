/**
 * LAB-06.2 — instrument qualification.
 *
 * The instrument page shows who may run an instrument and until when; grants are
 * an admin action on the instrument's workspace, are audited, and the effective
 * state is the expiry that has not passed. The booking path (LAB-06.3) reads the
 * same `internal.instrument_qualified` predicate.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c800'
const OTHER_WS = '00000000-0000-4000-8000-00000000c801'
const INSTRUMENT = '00000000-0000-4000-8000-00000000c802'
const ADMIN = 'lab06-admin'
const ANALYST = 'lab06-analyst'
const OUTSIDER = 'lab06-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [ADMIN, ANALYST, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'lab06','LAB-06'),($2,'lab06-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'analyst'),($5,$4,'owner')`,
    [WS, ADMIN, ANALYST, OUTSIDER, OTHER_WS],
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

async function grant(
  client: Client,
  userId: string,
  validUntil: Date,
  qualifiedFor: string | null = null,
) {
  return client.query(
    'select * from api.set_instrument_qualification($1,$2,$3,$4)',
    [INSTRUMENT, userId, validUntil.toISOString(), qualifiedFor],
  )
}

async function list(client: Client) {
  return (
    await client.query<{ user_id: string; current: boolean }>(
      'select user_id,current from api.instrument_qualification_list($1)',
      [INSTRUMENT],
    )
  ).rows
}

describe('LAB-06.2 instrument qualification', () => {
  it('grants a qualification with an expiry and reports who is current', async () => {
    const admin = await actor(ADMIN)
    const until = new Date(Date.now() + 90 * 86_400_000)
    const { rows } = await grant(admin, ANALYST, until, 'qPCR')
    expect(rows[0]).toMatchObject({ user_id: ANALYST })
    expect(await list(admin)).toEqual([{ user_id: ANALYST, current: true }])

    const instrument = await migrator.query<{ qualified_for: string }>(
      'select qualified_for from api.instruments where id=$1',
      [INSTRUMENT],
    )
    expect(instrument.rows[0]!.qualified_for).toBe('qPCR')

    // The predicate the booking path uses agrees.
    const qualified = await migrator.query<{ q: boolean }>(
      'select internal.instrument_qualified($1,$2) q',
      [INSTRUMENT, ANALYST],
    )
    expect(qualified.rows[0]!.q).toBe(true)
    const unknown = await migrator.query<{ q: boolean }>(
      'select internal.instrument_qualified($1,$2) q',
      [INSTRUMENT, ADMIN],
    )
    expect(unknown.rows[0]!.q).toBe(false)
  })

  it('treats a passed expiry as not qualified and audits the grant', async () => {
    const admin = await actor(ADMIN)
    await migrator.query(
      `update api.instrument_qualifications set valid_until = now() - interval '1 day'
        where instrument_id=$1 and user_id=$2`,
      [INSTRUMENT, ANALYST],
    )
    expect(await list(admin)).toEqual([{ user_id: ANALYST, current: false }])
    const events = await migrator.query<{ payload: Record<string, unknown> }>(
      `select payload from api.change_events where entity_type='instrument' and entity_uuid=$1`,
      [INSTRUMENT],
    )
    expect(
      events.rows.some(
        (event) => event.payload.effect === 'qualification_granted',
      ),
    ).toBe(true)
  })

  it('refuses a past expiry, a non-member, a non-admin and another workspace', async () => {
    const admin = await actor(ADMIN)
    await expectDenied(
      grant(admin, ANALYST, new Date(Date.now() - 86_400_000)),
      '22023',
    )
    await expectDenied(
      grant(admin, 'not-a-member', new Date(Date.now() + 86_400_000)),
      '22023',
    )
    const analyst = await actor(ANALYST)
    await expectDenied(
      grant(analyst, ANALYST, new Date(Date.now() + 86_400_000)),
      '42501',
    )
    const outsider = await actor(OUTSIDER, OTHER_WS)
    await expectDenied(
      grant(outsider, OUTSIDER, new Date(Date.now() + 86_400_000)),
      '42501',
    )
    expect(await list(outsider)).toEqual([])
  })

  it('revokes a qualification', async () => {
    const admin = await actor(ADMIN)
    await grant(admin, ANALYST, new Date(Date.now() + 30 * 86_400_000))
    await admin.query('select api.revoke_instrument_qualification($1,$2)', [
      INSTRUMENT,
      ANALYST,
    ])
    expect(await list(admin)).toEqual([])
  })
})
