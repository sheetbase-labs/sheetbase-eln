/**
 * WORK-03.1 — notification preferences are per-user: own-row reads, upsert by
 * event type, quiet hours and digest time, and HH:MM validation.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const USER = 'notif-user'
const OTHER = 'notif-other'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${USER}', 'Notif User', 'notif@sheetbase.test', true),
      ('${OTHER}', 'Notif Other', 'notif-other@sheetbase.test', true)`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ])
  return client
}

describe('notification preferences', () => {
  it('upserts a preference per event type', async () => {
    const user = await asAuthenticated(USER)
    await user.query(
      `SELECT api.save_notification_preference('review_requested', true, false, false)`,
    )
    const again = await user.query<{ email: boolean; digest: boolean }>(
      `SELECT * FROM api.save_notification_preference('review_requested', true, true, false)`,
    )
    expect(again.rows[0]?.email).toBe(true)

    const rows = await user.query(
      `SELECT event_type FROM api.notification_preferences`,
    )
    expect(rows.rows).toEqual([{ event_type: 'review_requested' }])
  })

  it('is invisible to another user', async () => {
    const other = await asAuthenticated(OTHER)
    const rows = await other.query(
      `SELECT event_type FROM api.notification_preferences`,
    )
    expect(rows.rows).toEqual([])
  })

  it('refuses an unknown event type', async () => {
    const user = await asAuthenticated(USER)
    await expect(
      user.query(
        `SELECT api.save_notification_preference('nonsense', true, true, false)`,
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('stores quiet hours and digest time and validates HH:MM', async () => {
    const user = await asAuthenticated(USER)
    const { rows } = await user.query<{
      quiet_hours_start: string
      digest_time: string
    }>(`SELECT * FROM api.set_notification_timing('22:00', '07:00', '08:30')`)
    expect(rows[0]?.quiet_hours_start).toBe('22:00')
    expect(rows[0]?.digest_time).toBe('08:30')

    await expect(
      user.query(`SELECT api.set_notification_timing('2200', NULL, NULL)`),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
