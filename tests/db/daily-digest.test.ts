/**
 * WORK-03.4 — the daily digest enqueues once per day at the user's digest time.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000000f0a'
const USER = 'digest-user'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES ('${USER}', 'Digest User', 'digest@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'digest-ws', 'Digest WS')`,
  )
  await migrator.query(
    `INSERT INTO api.user_preferences (user_id, digest_time)
     VALUES ('${USER}', to_char(now() AT TIME ZONE 'UTC', 'HH24:MI'))`,
  )
  await migrator.query(
    `INSERT INTO api.notification_preferences (user_id, event_type, in_app, email, digest)
     VALUES ('${USER}', 'review_requested', true, false, true)`,
  )
  await migrator.query(
    `INSERT INTO internal.notifications (workspace_id, user_id, event_type, title)
     VALUES ('${WS}', '${USER}', 'review_requested', 'Review requested')`,
  )
})

afterAll(async () => {
  await migrator.end()
})

describe('enqueue_daily_digests', () => {
  it('enqueues one digest email and is idempotent per day', async () => {
    const first = await migrator.query<{ n: number }>(
      `SELECT internal.enqueue_daily_digests() AS n`,
    )
    expect(first.rows[0]!.n).toBe(1)

    const deliveries = await migrator.query<{
      event_type: string
      body: string
    }>(`SELECT event_type, body FROM internal.email_deliveries`)
    expect(deliveries.rows).toHaveLength(1)
    expect(deliveries.rows[0]?.event_type).toBe('digest')
    expect(deliveries.rows[0]?.body).toContain('Review requested')

    const second = await migrator.query<{ n: number }>(
      `SELECT internal.enqueue_daily_digests() AS n`,
    )
    expect(second.rows[0]!.n).toBe(0)
  })

  it("reads the digest time on the person's own wall clock", async () => {
    await migrator.query(`DELETE FROM internal.email_deliveries`)
    await migrator.query(
      `UPDATE api.user_preferences
          SET timezone = 'Pacific/Auckland', digest_last_sent_on = NULL,
              digest_time = to_char(now() AT TIME ZONE 'Pacific/Auckland', 'HH24:MI')
        WHERE user_id = '${USER}'`,
    )
    const hit = await migrator.query<{ n: number }>(
      `SELECT internal.enqueue_daily_digests() AS n`,
    )
    expect(hit.rows[0]!.n).toBe(1)

    await migrator.query(
      `UPDATE api.user_preferences
          SET digest_last_sent_on = NULL,
              digest_time = to_char(now() AT TIME ZONE 'UTC', 'HH24:MI')
        WHERE user_id = '${USER}'`,
    )
    const miss = await migrator.query<{ n: number }>(
      `SELECT internal.enqueue_daily_digests() AS n`,
    )
    expect(miss.rows[0]!.n).toBe(0)
  })
})
