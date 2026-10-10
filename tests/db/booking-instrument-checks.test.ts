/**
 * LAB-06.3 — booking an instrument checks qualification and calibration.
 *
 * A calendar resource that names an instrument in its metadata represents that
 * instrument, so the booking path refuses an unqualified booker (SB115) and an
 * instrument whose latest calibration is overdue (SB116), while a resource with
 * no instrument is unaffected.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c900'
const INSTRUMENT = '00000000-0000-4000-8000-00000000c901'
const ADMIN = 'lab063-admin'
const QUALIFIED = 'lab063-qualified'
const UNQUALIFIED = 'lab063-unqualified'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let resource: string
let plainResource: string

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [ADMIN, QUALIFIED, UNQUALIFIED]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'lab063','LAB-06.3')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'analyst'),($1,$4,'analyst')`,
    [WS, ADMIN, QUALIFIED, UNQUALIFIED],
  )
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,instrument_type,qualified_for,created_by_user_id)
     values($1,$2,'Plate reader PR-01','qpcr','qPCR',$3)`,
    [INSTRUMENT, WS, ADMIN],
  )

  const admin = await actor(ADMIN)
  resource = (
    await admin.query<{ id: string }>(
      `select id from api.create_calendar_resource($1,'Plate reader PR-01','PR-01','instrument',null,1,'UTC',null,$2::jsonb)`,
      [WS, JSON.stringify({ instrumentId: INSTRUMENT })],
    )
  ).rows[0]!.id
  plainResource = (
    await admin.query<{ id: string }>(
      `select id from api.create_calendar_resource($1,'Meeting room','ROOM-1','room',null,4,'UTC',null,'{}'::jsonb)`,
      [WS],
    )
  ).rows[0]!.id

  // A current calibration so only the qualification rule is in play first.
  await migrator.query(
    `insert into api.instrument_calibrations(instrument_id,workspace_id,performed_at,due_at)
     values($1,$2,now() - interval '10 days',now() + interval '30 days')`,
    [INSTRUMENT, WS],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

async function book(client: Client, resourceId: string, hour = 9) {
  return client.query(
    `select * from api.create_booking($1,$2,'Run plate', $3::timestamptz, $4::timestamptz)`,
    [
      WS,
      resourceId,
      new Date(Date.UTC(2026, 10, 2, hour)).toISOString(),
      new Date(Date.UTC(2026, 10, 2, hour + 1)).toISOString(),
    ],
  )
}

async function qualify(userId: string, validUntil: Date) {
  const admin = await actor(ADMIN)
  await admin.query(
    'select * from api.set_instrument_qualification($1,$2,$3)',
    [INSTRUMENT, userId, validUntil.toISOString()],
  )
}

describe('LAB-06.3 instrument booking checks', () => {
  it('refuses a booker without a current qualification', async () => {
    const unqualified = await actor(UNQUALIFIED)
    await expectDenied(book(unqualified, resource), 'SB115')
    await qualify(UNQUALIFIED, new Date(Date.now() + 30 * 86_400_000))
    await expect(book(unqualified, resource)).resolves.toBeDefined()
  })

  it('refuses a booker whose qualification has expired', async () => {
    // A grant always starts in the future, so the expiry is aged directly.
    await qualify(QUALIFIED, new Date(Date.now() + 30 * 86_400_000))
    await migrator.query(
      `update api.instrument_qualifications set valid_until = now() - interval '1 day'
        where instrument_id=$1 and user_id=$2`,
      [INSTRUMENT, QUALIFIED],
    )
    const qualified = await actor(QUALIFIED)
    await expectDenied(book(qualified, resource, 11), 'SB115')
  })

  it('refuses an instrument whose calibration is overdue', async () => {
    await qualify(QUALIFIED, new Date(Date.now() + 30 * 86_400_000))
    await migrator.query(
      `update api.instrument_calibrations set due_at = now() - interval '1 day'
        where instrument_id=$1`,
      [INSTRUMENT],
    )
    const qualified = await actor(QUALIFIED)
    await expectDenied(book(qualified, resource, 13), 'SB116')
  })

  it('leaves a resource without an instrument unaffected', async () => {
    const unqualified = await actor(UNQUALIFIED)
    await migrator.query(
      `delete from api.instrument_qualifications where instrument_id=$1 and user_id=$2`,
      [INSTRUMENT, UNQUALIFIED],
    )
    await expect(book(unqualified, plainResource, 15)).resolves.toBeDefined()
  })
})
