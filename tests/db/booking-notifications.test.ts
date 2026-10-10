/**
 * WORK-03.2 — instrument bookings notify their participants.
 *
 * A generic trigger emits a booking change event when the booking row is inserted,
 * which is before the participants are written; api.create_booking therefore emits
 * again once the participants exist, and the notification trigger derives an
 * instrument_booking notification for them (never for the person who booked).
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ensureSessions, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-000000050000'
const RESOURCE = '00000000-0000-4000-8000-000000050001'
const BOOKER = 'work032-booker'
const GUEST = 'work032-guest'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [BOOKER, GUEST]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await ensureSessions(migrator, [BOOKER, GUEST])
  await migrator.query(`insert into api.workspaces(id,slug,name) values($1,'work032','WORK-03.2')`, [
    WS,
  ])
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'member')`,
    [WS, BOOKER, GUEST],
  )
  await migrator.query(
    `insert into api.calendar_resources(id,workspace_id,name,code,resource_type,created_by_user_id)
     values($1,$2,'Plate reader PR-01','PR-01','instrument',$3)`,
    [RESOURCE, WS, BOOKER],
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
  await setActorJwt(client, userId, WS, { session_id: `session-${userId}` })
  return client
}

describe('WORK-03.2 instrument booking notifications', () => {
  it('notifies the other participant, not the person who booked', async () => {
    const booker = await actor(BOOKER)
    const booking = await booker.query<{ id: string }>(
      `select (api.create_booking($1,$2,'Plate reader slot',
                '2026-09-26T09:00:00Z'::timestamptz,'2026-09-26T10:00:00Z'::timestamptz,
                'UTC','confirmed',false,null,null,null,null,null,
                $3::jsonb, '[]'::jsonb)).id as id`,
      [WS, RESOURCE, JSON.stringify([{ userId: BOOKER }, { userId: GUEST }])],
    )
    const bookingId = booking.rows[0]!.id

    const events = await migrator.query<{ operation: string }>(
      `select operation from api.change_events
        where entity_type='calendar_booking' and entity_uuid=$1`,
      [bookingId],
    )
    expect(events.rows.map((row) => row.operation)).toContain('create')

    const notes = await migrator.query<{ user_id: string; event_type: string }>(
      `select user_id, event_type from internal.notifications
        where event_type='instrument_booking' order by user_id`,
    )
    expect(notes.rows.map((row) => row.user_id)).toEqual([GUEST])
  })
})
