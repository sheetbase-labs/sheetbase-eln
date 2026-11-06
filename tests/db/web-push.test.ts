/**
 * Phone alerts (migration 0071).
 *
 * Proves: a device is saved for the signed-in person and moves to whoever turns
 * alerts on there; only the owner can remove it; a notification queues one
 * alert per device for an event the person has phone alerts on for, carrying
 * the unread count and the record link; muting phone for an event queues
 * nothing; quiet hours hold an alert but not a signature request; a failed send
 * retries then dies; a device the push service has dropped is forgotten; a
 * finished timer's alert shares the page's tag; booking reminders go to
 * everyone on a booking once, only inside the 15 minute window, never for a
 * cancelled booking; the server key is made once.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000071000'
const RECORD = '00000000-0000-4000-8000-000000071001'
const INSTRUMENT = '00000000-0000-4000-8000-000000071002'
const ANN = 'push-ann'
const BEN = 'push-ben'
const DEVICE_A = 'https://push.example.test/send/device-a'
const DEVICE_B = 'https://push.example.test/send/device-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function notify(
  userId: string,
  eventType: string,
  extra: { title?: string; recordId?: string | null; tag?: string | null } = {},
): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `INSERT INTO internal.notifications
       (workspace_id, user_id, event_type, title, record_id, dedupe_tag)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      WS,
      userId,
      eventType,
      extra.title ?? 'Something happened',
      extra.recordId ?? null,
      extra.tag ?? null,
    ],
  )
  return rows[0]!.id
}

const queued = (userId: string) =>
  migrator.query<{
    event_type: string
    status: string
    payload: Record<string, unknown>
    id: string
  }>(
    `SELECT id, event_type, status, payload FROM internal.push_deliveries
      WHERE user_id = $1 ORDER BY created_at, id`,
    [userId],
  )

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [ANN, BEN]) {
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'wp','Phone alerts')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'owner')`,
    [WS, ANN, BEN],
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     VALUES ($1,$2,'protocol_template','PRT-WP','Western blot protocol','active',$3)`,
    [RECORD, WS, ANN],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('devices', () => {
  it('saves a device for the signed-in person and lists only theirs', async () => {
    const ann = await actor(ANN)
    await ann.query(
      `SELECT api.save_push_subscription($1,'BKey','authsecret','Pixel')`,
      [DEVICE_A],
    )
    // Saving again is an update, not a second device.
    await ann.query(
      `SELECT api.save_push_subscription($1,'BKey2','authsecret','Pixel')`,
      [DEVICE_A],
    )
    const mine = await ann.query(`SELECT * FROM api.my_push_devices()`)
    expect(mine.rows).toHaveLength(1)
    const ben = await actor(BEN)
    expect(
      (await ben.query(`SELECT * FROM api.my_push_devices()`)).rows,
    ).toEqual([])
  })

  it('rejects anything that is not a push subscription', async () => {
    const ann = await actor(ANN)
    await expectDenied(
      ann.query(`SELECT api.save_push_subscription('http://insecure','k','a')`),
      '22023',
    )
    await expectDenied(
      ann.query(`SELECT api.save_push_subscription($1,'','a')`, [DEVICE_B]),
      '22023',
    )
  })

  it('does not let one person remove another person’s device', async () => {
    const ben = await actor(BEN)
    const removed = await ben.query<{ r: boolean }>(
      `SELECT api.remove_push_subscription($1) r`,
      [DEVICE_A],
    )
    expect(removed.rows[0]!.r).toBe(false)
    const ann = await actor(ANN)
    const own = await ann.query<{ r: boolean }>(
      `SELECT api.remove_push_subscription($1) r`,
      [DEVICE_A],
    )
    expect(own.rows[0]!.r).toBe(true)
  })

  it('moves a shared phone to whoever turns alerts on there', async () => {
    const ann = await actor(ANN)
    const ben = await actor(BEN)
    await ann.query(`SELECT api.save_push_subscription($1,'BKey','a')`, [
      DEVICE_B,
    ])
    await ben.query(`SELECT api.save_push_subscription($1,'BKey','a')`, [
      DEVICE_B,
    ])
    expect(
      (await ann.query(`SELECT * FROM api.my_push_devices()`)).rows,
    ).toEqual([])
    expect(
      (await ben.query(`SELECT * FROM api.my_push_devices()`)).rows,
    ).toHaveLength(1)
    await ben.query(`SELECT api.remove_push_subscription($1)`, [DEVICE_B])
  })
})

describe('queueing an alert', () => {
  it('queues one per device with the unread count and record link', async () => {
    const ann = await actor(ANN)
    await ann.query(
      `SELECT api.save_push_subscription($1,'BKey','a','Pixel')`,
      [DEVICE_A],
    )
    await ann.query(
      `SELECT api.save_push_subscription($1,'BKey','a','Laptop')`,
      [DEVICE_B],
    )
    await notify(ANN, 'signature_requested', {
      title: 'Signature requested',
      recordId: RECORD,
    })
    const { rows } = await queued(ANN)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.payload).toMatchObject({
      title: 'Signature requested',
      body: 'Western blot protocol',
      url: `/records/${RECORD}`,
      badge: 1,
    })
    await notify(ANN, 'comment_or_mention', { title: 'Comment on your record' })
    const second = await migrator.query(
      `SELECT payload FROM internal.push_deliveries WHERE user_id=$1 AND event_type='comment_or_mention' LIMIT 1`,
      [ANN],
    )
    expect(second.rows[0]!.payload).toMatchObject({ badge: 2, url: '/' })
  })

  it('queues nothing for someone with no device, or for an event they muted on phone', async () => {
    await notify(BEN, 'signature_requested')
    expect((await queued(BEN)).rows).toHaveLength(0)

    const ann = await actor(ANN)
    await ann.query(
      `SELECT api.save_notification_preference('reagent_order', true, false, false, false)`,
    )
    await ann.query(
      `SELECT api.save_notification_preference('step_timer', true, false, false, false)`,
    )
    const before = (await queued(ANN)).rows.length
    await notify(ANN, 'step_timer')
    await notify(ANN, 'reagent_order') // not a phone event by default
    expect((await queued(ANN)).rows).toHaveLength(before)
  })

  it('pushes an event that is off by default once the person turns it on', async () => {
    const ann = await actor(ANN)
    await ann.query(
      `SELECT api.save_notification_preference('reagent_order', true, false, false, true)`,
    )
    const before = (await queued(ANN)).rows.length
    await notify(ANN, 'reagent_order')
    expect((await queued(ANN)).rows).toHaveLength(before + 2)
  })

  it('keeps the event default when a preference is saved without a phone choice', async () => {
    const ann = await actor(ANN)
    await ann.query(
      `SELECT api.save_notification_preference('comment_or_mention', true, true, false)`,
    )
    const { rows } = await ann.query<{ push: boolean }>(
      `SELECT push FROM api.notification_preferences WHERE event_type='comment_or_mention'`,
    )
    expect(rows[0]!.push).toBe(true)
  })

  it('gives a finished timer the same tag the open page uses', async () => {
    await migrator.query(`DELETE FROM internal.push_deliveries`)
    const ann = await actor(ANN)
    await ann.query(
      `SELECT api.save_notification_preference('step_timer', true, false, false, true)`,
    )
    const block = await migrator.query<{ id: string }>(
      `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
       VALUES ($1,'procedure_step',$3::jsonb,1,$2) RETURNING id`,
      [
        RECORD,
        ANN,
        JSON.stringify({
          text: 'Incubate',
          stepNumber: 1,
          durationSeconds: 60,
        }),
      ],
    )
    await migrator.query(
      `INSERT INTO api.step_timers(workspace_id,user_id,record_id,block_id,label,duration_seconds,started_at,ends_at)
       VALUES ($1,$2,$3,$4,'Incubate',60,now()-interval '2 minutes',now()-interval '1 minute')`,
      [WS, ANN, RECORD, block.rows[0]!.id],
    )
    await migrator.query(`SELECT internal.sweep_step_timers()`)
    const timer = await migrator.query<{ id: string }>(
      `SELECT id FROM api.step_timers WHERE user_id=$1`,
      [ANN],
    )
    const { rows } = await queued(ANN)
    expect(rows).toHaveLength(2)
    // Both alerts are queued in one transaction, so they share created_at and
    // their order is the random id's: look for the tag, not a position.
    expect(rows.map((row) => row.payload)).toContainEqual(
      expect.objectContaining({
        title: 'Timer finished',
        tag: `step-timer-${timer.rows[0]!.id}`,
      }),
    )
  })
})

describe('sending', () => {
  it('claims due alerts and keeps a failing one for a retry, then gives up', async () => {
    await migrator.query(`DELETE FROM internal.push_deliveries`)
    await notify(ANN, 'signature_requested')
    const claimed = await migrator.query<{
      id: string
      endpoint: string
      attempt: number
    }>(
      `SELECT id, endpoint, attempt FROM internal.claim_due_push_deliveries(10)`,
    )
    expect(claimed.rows).toHaveLength(2)
    expect(claimed.rows[0]!.attempt).toBe(1)
    // Nothing else is due while those are in flight.
    expect(
      (
        await migrator.query(
          `SELECT * FROM internal.claim_due_push_deliveries(10)`,
        )
      ).rows,
    ).toHaveLength(0)

    const id = claimed.rows[0]!.id
    await migrator.query(`SELECT internal.finish_push_delivery($1,'sent')`, [
      claimed.rows[1]!.id,
    ])
    await migrator.query(
      `SELECT internal.finish_push_delivery($1,'retry','boom')`,
      [id],
    )
    let row = await migrator.query(
      `SELECT status, last_error FROM internal.push_deliveries WHERE id=$1`,
      [id],
    )
    expect(row.rows[0]).toMatchObject({ status: 'pending', last_error: 'boom' })
    for (const attempt of [2, 3]) {
      await migrator.query(
        `UPDATE internal.push_deliveries SET next_attempt_at=now(), attempt=$2 WHERE id=$1`,
        [id, attempt - 1],
      )
      await migrator.query(
        `SELECT * FROM internal.claim_due_push_deliveries(10)`,
      )
      await migrator.query(
        `SELECT internal.finish_push_delivery($1,'retry','boom')`,
        [id],
      )
    }
    row = await migrator.query(
      `SELECT status FROM internal.push_deliveries WHERE id=$1`,
      [id],
    )
    expect(row.rows[0]!.status).toBe('dead')
  })

  it('forgets a device the push service says is gone', async () => {
    await migrator.query(`DELETE FROM internal.push_deliveries`)
    await notify(ANN, 'signature_requested')
    const claimed = await migrator.query<{ id: string; endpoint: string }>(
      `SELECT id, endpoint FROM internal.claim_due_push_deliveries(10)`,
    )
    const gone = claimed.rows.find((r) => r.endpoint === DEVICE_B)!
    await migrator.query(`SELECT internal.finish_push_delivery($1,'gone')`, [
      gone.id,
    ])
    const ann = await actor(ANN)
    const devices = await ann.query<{ endpoint: string }>(
      `SELECT endpoint FROM api.my_push_devices()`,
    )
    expect(devices.rows.map((d) => d.endpoint)).toEqual([DEVICE_A])
  })

  it('holds an alert through quiet hours, but not a signature request', async () => {
    await migrator.query(`DELETE FROM internal.push_deliveries`)
    await migrator.query(
      `INSERT INTO api.user_preferences(user_id, quiet_hours_start, quiet_hours_end)
       VALUES ($1,'00:00','23:59')
       ON CONFLICT (user_id) DO UPDATE SET quiet_hours_start='00:00', quiet_hours_end='23:59'`,
      [ANN],
    )
    await notify(ANN, 'comment_or_mention')
    await notify(ANN, 'signature_requested')
    const claimed = await migrator.query<{ payload: { title: string } }>(
      `SELECT payload FROM internal.claim_due_push_deliveries(10)`,
    )
    expect(claimed.rows).toHaveLength(1)
    await migrator.query(
      `UPDATE api.user_preferences SET quiet_hours_start=NULL, quiet_hours_end=NULL WHERE user_id=$1`,
      [ANN],
    )
  })
})

describe('booking reminders', () => {
  async function booking(startsInMinutes: number, status = 'confirmed') {
    const { rows } = await migrator.query<{ id: string }>(
      `INSERT INTO api.calendar_bookings(workspace_id,resource_id,title,status,starts_at,ends_at,cancelled_at)
       VALUES ($1,$2,'Plate reader slot',$3, now() + make_interval(mins => $4), now() + make_interval(mins => $4 + 60),
               CASE WHEN $3='cancelled' THEN now() END) RETURNING id`,
      [WS, INSTRUMENT, status, startsInMinutes],
    )
    for (const user of [ANN, BEN]) {
      await migrator.query(
        `INSERT INTO api.calendar_booking_participants(workspace_id,booking_id,user_id,role) VALUES ($1,$2,$3,'participant')`,
        [WS, rows[0]!.id, user],
      )
    }
    return rows[0]!.id
  }

  beforeAll(async () => {
    await migrator.query(
      `INSERT INTO api.instruments(id,workspace_id,name,instrument_type,created_by_user_id)
       VALUES ($1,$2,'Plate reader PR-01','qpcr',$3)`,
      [INSTRUMENT, WS, ANN],
    )
  })

  it('reminds everyone on a booking about to start, once', async () => {
    await migrator.query(
      `DELETE FROM internal.notifications WHERE event_type='booking_reminder'`,
    )
    await migrator.query(`DELETE FROM internal.push_deliveries`)
    const soon = await booking(10)
    await booking(120) // too far off
    await booking(5, 'cancelled') // cancelled
    expect(
      (
        await migrator.query<{ n: number }>(
          `SELECT internal.sweep_booking_reminders() n`,
        )
      ).rows[0]!.n,
    ).toBe(2)
    expect(
      (
        await migrator.query<{ n: number }>(
          `SELECT internal.sweep_booking_reminders() n`,
        )
      ).rows[0]!.n,
    ).toBe(0)
    const notes = await migrator.query<{
      user_id: string
      title: string
      body: string
      dedupe_tag: string
    }>(
      `SELECT user_id, title, body, dedupe_tag FROM internal.notifications WHERE event_type='booking_reminder' ORDER BY user_id`,
    )
    expect(notes.rows.map((n) => n.user_id)).toEqual([ANN, BEN])
    expect(notes.rows[0]).toMatchObject({
      title: 'Booking starts soon',
      body: 'Plate reader slot · Plate reader PR-01',
      dedupe_tag: `booking-${soon}`,
    })
    // Ann still has one device, so her reminder is queued for it; Ben has none.
    expect(
      (await queued(ANN)).rows.filter(
        (r) => r.event_type === 'booking_reminder',
      ),
    ).toHaveLength(1)
    expect((await queued(BEN)).rows).toHaveLength(0)
  })

  it('skips a person who turned the reminder off everywhere', async () => {
    await migrator.query(
      `DELETE FROM internal.notifications WHERE event_type='booking_reminder'`,
    )
    const ben = await actor(BEN)
    await ben.query(
      `SELECT api.save_notification_preference('booking_reminder', false, false, false, false)`,
    )
    await booking(8)
    await migrator.query(`SELECT internal.sweep_booking_reminders()`)
    const notes = await migrator.query<{ user_id: string }>(
      `SELECT user_id FROM internal.notifications WHERE event_type='booking_reminder' AND title='Booking starts soon' ORDER BY user_id`,
    )
    expect(notes.rows.map((n) => n.user_id)).toEqual([ANN])
  })
})

describe('the server key', () => {
  it('is made once; a second attempt reads the first back', async () => {
    const first = await migrator.query<{ public_key: string }>(
      `SELECT * FROM internal.ensure_push_vapid_keys('first-public', '{"k":1}')`,
    )
    const second = await migrator.query<{ public_key: string }>(
      `SELECT * FROM internal.ensure_push_vapid_keys('second-public', '{"k":2}')`,
    )
    expect(first.rows[0]!.public_key).toBe('first-public')
    expect(second.rows[0]!.public_key).toBe('first-public')
    const ann = await actor(ANN)
    const key = await ann.query<{ k: string }>(
      `SELECT api.get_push_public_key() k`,
    )
    expect(key.rows[0]!.k).toBe('first-public')
  })
})
