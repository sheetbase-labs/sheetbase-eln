/**
 * Instrument out of service and the repair log (migration 0060).
 *
 * Proves: the people who run an instrument can mark it down (with a reason) and
 * back in service, and others cannot; while it is down every route to a new
 * booking is refused with SB135 (single, edited and repeating bookings share the
 * gate) and other instruments are unaffected; everyone with a booking still ahead
 * is told when it goes down and when it comes back, never the person acting, and
 * never someone whose booking is in the past or cancelled; existing bookings stay;
 * a retired instrument cannot be marked down; the repair log is append-only
 * history that marking an instrument back in service can add to.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-0000000060a0'
const ADMIN = 'oos-admin'
const TECH = 'oos-tech'
const BOOKER = 'oos-booker'
const GUEST = 'oos-guest'
const PAST = 'oos-past'
const VIEWER = 'oos-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

let instrumentId: string
let otherId: string
let futureBookingId: string

const DAY = 86_400_000

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [ADMIN, TECH, BOOKER, GUEST, PAST, VIEWER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'oos','Out of service')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'scientist'),($1,$4,'scientist'),($1,$5,'scientist'),
     ($1,$6,'scientist'),($1,$7,'viewer')`,
    [WS, ADMIN, TECH, BOOKER, GUEST, PAST, VIEWER],
  )
  const admin = await actor(ADMIN)
  const create = async (name: string) =>
    (
      await admin.query<{ id: string }>(
        `select * from api.create_instrument($1,$2,'qpcr',null,null,null,'Lab A',null,'{}'::jsonb,0,'none')`,
        [WS, name],
      )
    ).rows[0]!.id
  instrumentId = await create('Plate reader PR-01')
  otherId = await create('Centrifuge C-02')
  for (const id of [instrumentId, otherId]) {
    for (const user of [ADMIN, TECH, BOOKER, GUEST, PAST]) {
      await admin.query(
        'select * from api.set_instrument_qualification($1,$2,$3)',
        [id, user, new Date(Date.now() + 90 * DAY).toISOString()],
      )
    }
    await migrator.query(
      `insert into api.instrument_calibrations(instrument_id,workspace_id,performed_at,due_at)
       values($1,$2,now() - interval '10 days',now() + interval '60 days')`,
      [id, WS],
    )
  }

  // BOOKER books ahead (GUEST is added to it); PAST has a booking that has already
  // finished; TECH has a booking that is cancelled.
  const booker = await actor(BOOKER)
  futureBookingId = (
    await booker.query<{ id: string }>(
      `select * from api.create_booking($1,$2,'Plate run',$3::timestamptz,$4::timestamptz,'UTC','confirmed',false,null,null,null,null,null,$5::jsonb)`,
      [
        WS,
        instrumentId,
        new Date(Date.now() + 3 * DAY).toISOString(),
        new Date(Date.now() + 3 * DAY + 3_600_000).toISOString(),
        JSON.stringify([{ userId: GUEST, role: 'participant' }]),
      ],
    )
  ).rows[0]!.id
  const tech = await actor(TECH)
  const cancelled = await tech.query<{ id: string }>(
    `select * from api.create_booking($1,$2,'Cancelled run',$3::timestamptz,$4::timestamptz)`,
    [
      WS,
      instrumentId,
      new Date(Date.now() + 5 * DAY).toISOString(),
      new Date(Date.now() + 5 * DAY + 3_600_000).toISOString(),
    ],
  )
  await tech.query('select * from api.cancel_booking($1)', [
    cancelled.rows[0]!.id,
  ])
  await migrator.query(
    `insert into api.calendar_bookings
       (workspace_id,resource_id,title,status,starts_at,ends_at,timezone,created_by_user_id)
     values($1,$2,'Old run','confirmed',now() - interval '3 days',now() - interval '3 days' + interval '1 hour','UTC',$3)`,
    [WS, instrumentId, PAST],
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

function book(client: Client, resourceId: string, daysAhead: number) {
  return client.query(
    `select * from api.create_booking($1,$2,'New run',$3::timestamptz,$4::timestamptz)`,
    [
      WS,
      resourceId,
      new Date(Date.now() + daysAhead * DAY).toISOString(),
      new Date(Date.now() + daysAhead * DAY + 3_600_000).toISOString(),
    ],
  )
}

async function notices(event = 'instrument_service') {
  const { rows } = await migrator.query<{
    user_id: string
    title: string
    body: string
  }>(
    `select user_id,title,body from internal.notifications
      where event_type = $1 and workspace_id = $2 order by created_at, user_id`,
    [event, WS],
  )
  return rows
}

describe('marking an instrument out of service', () => {
  it('is for the people who run instruments, and needs a reason', async () => {
    const viewer = await actor(VIEWER)
    await expectDenied(
      viewer.query(
        'select * from api.set_instrument_out_of_service($1,true,$2)',
        [instrumentId, 'Lamp failed'],
      ),
      '42501',
    )
    const tech = await actor(TECH)
    await expectDenied(
      tech.query(
        'select * from api.set_instrument_out_of_service($1,true,$2)',
        [instrumentId, '  '],
      ),
      '22023',
    )
  })

  it('stops new bookings, tells everyone booked, and leaves their bookings alone', async () => {
    const tech = await actor(TECH)
    const down = await tech.query(
      'select * from api.set_instrument_out_of_service($1,true,$2,$3)',
      [instrumentId, 'Lamp failed', '2026-12-01'],
    )
    expect(down.rows[0]).toMatchObject({
      out_of_service_reason: 'Lamp failed',
      out_of_service_by: TECH,
    })
    expect(down.rows[0].out_of_service_at).not.toBeNull()

    // New bookings are refused on every route; the neighbouring instrument is fine.
    const booker = await actor(BOOKER)
    await expectDenied(book(booker, instrumentId, 8), 'SB135')
    await expectDenied(
      booker.query(
        `select * from api.edit_booking($1, p_starts_at => $2::timestamptz, p_ends_at => $3::timestamptz)`,
        [
          futureBookingId,
          new Date(Date.now() + 4 * DAY).toISOString(),
          new Date(Date.now() + 4 * DAY + 3_600_000).toISOString(),
        ],
      ),
      'SB135',
    )
    expect((await book(booker, otherId, 8)).rows).toHaveLength(1)

    // The existing booking is still there.
    const kept = await migrator.query(
      `select status from api.calendar_bookings where id = $1`,
      [futureBookingId],
    )
    expect(kept.rows[0].status).toBe('confirmed')

    // The creator and the added participant are told once each; not the person
    // acting, not the person whose booking is cancelled, not the one in the past.
    const sent = await notices()
    expect(sent.map((n) => n.user_id).sort()).toEqual([BOOKER, GUEST])
    expect(sent[0]!.title).toBe('Plate reader PR-01 is out of service')
    expect(sent[0]!.body).toContain('Lamp failed.')
    expect(sent[0]!.body).toContain('Expected back 1 Dec.')
    expect(sent[0]!.body).toContain('Plate run')
  })

  it('updates the reason without telling everyone again', async () => {
    const tech = await actor(TECH)
    const before = (await notices()).length
    const again = await tech.query(
      'select * from api.set_instrument_out_of_service($1,true,$2)',
      [instrumentId, 'Lamp failed, engineer booked'],
    )
    expect(again.rows[0].out_of_service_reason).toBe(
      'Lamp failed, engineer booked',
    )
    expect(again.rows[0].out_of_service_by).toBe(TECH)
    expect((await notices()).length).toBe(before)
  })

  it('comes back into service, tells the same people, and can log the repair', async () => {
    const tech = await actor(TECH)
    const up = await tech.query(
      'select * from api.set_instrument_out_of_service($1,false,null,null,$2)',
      [instrumentId, 'Replaced the lamp'],
    )
    expect(up.rows[0]).toMatchObject({
      out_of_service_at: null,
      out_of_service_reason: null,
      expected_back_on: null,
    })
    const sent = await notices()
    const back = sent.filter((n) => n.title.endsWith('is back in service'))
    expect(back.map((n) => n.user_id).sort()).toEqual([BOOKER, GUEST])

    const booker = await actor(BOOKER)
    expect((await book(booker, instrumentId, 8)).rows).toHaveLength(1)

    const log = await booker.query(
      `select kind, summary, logged_by from api.instrument_service_log where instrument_id = $1`,
      [instrumentId],
    )
    expect(log.rows).toEqual([
      { kind: 'repair', summary: 'Replaced the lamp', logged_by: TECH },
    ])
  })

  it('cannot mark a retired instrument down', async () => {
    const admin = await actor(ADMIN)
    await admin.query('select * from api.set_instrument_retired($1,true)', [
      otherId,
    ])
    await expectDenied(
      admin.query(
        'select * from api.set_instrument_out_of_service($1,true,$2)',
        [otherId, 'Broken'],
      ),
      '22023',
    )
  })
})

describe('the repair and service log', () => {
  it('records a visit and shows it to every member', async () => {
    const tech = await actor(TECH)
    const entry = await tech.query(
      `select * from api.log_instrument_service($1,'service',current_date,$2,$3,$4)`,
      [
        instrumentId,
        'Annual service',
        'Replaced seals; ran the check plate.',
        'Vendor engineer',
      ],
    )
    expect(entry.rows[0]).toMatchObject({
      kind: 'service',
      summary: 'Annual service',
      performed_by: 'Vendor engineer',
      logged_by: TECH,
    })
    const viewer = await actor(VIEWER)
    const seen = await viewer.query(
      `select summary from api.instrument_service_log where instrument_id = $1 order by created_at`,
      [instrumentId],
    )
    expect(seen.rows.map((r) => r.summary)).toEqual([
      'Replaced the lamp',
      'Annual service',
    ])
  })

  it('is closed to outsiders, bad input and direct writes', async () => {
    const viewer = await actor(VIEWER)
    await expectDenied(
      viewer.query(
        `select * from api.log_instrument_service($1,'repair',current_date,'x')`,
        [instrumentId],
      ),
      '42501',
    )
    const tech = await actor(TECH)
    await expectDenied(
      tech.query(
        `select * from api.log_instrument_service($1,'wrong',current_date,'x')`,
        [instrumentId],
      ),
      '22023',
    )
    await expectDenied(
      tech.query(
        `select * from api.log_instrument_service($1,'repair',current_date + 30,'x')`,
        [instrumentId],
      ),
      '22023',
    )
    await expectDenied(
      tech.query(
        `insert into api.instrument_service_log(workspace_id,instrument_id,kind,visited_on,summary)
         values($1,$2,'repair',current_date,'sneaky')`,
        [WS, instrumentId],
      ),
      '42501',
    )
  })
})
