/**
 * WORK-03.4 — the email outbox: enqueue, claim, send and backoff/dead-letter.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000000e0a'
const USER = 'email-user'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES ('${USER}', 'Email User', 'email@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'email-ws', 'Email WS')`,
  )
})

afterAll(async () => {
  await migrator.end()
})

async function enqueue(subject: string): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT internal.enqueue_email_delivery($1, $2, 'review_requested', $3, 'body') AS id`,
    [WS, USER, subject],
  )
  return rows[0]!.id
}

describe('email outbox', () => {
  it('claims a due delivery and marks it sending', async () => {
    const id = await enqueue('A')
    const claimed = await migrator.query<{
      id: string
      status: string
      attempt: number
    }>(`SELECT * FROM internal.claim_due_email_deliveries(10)`)
    expect(claimed.rows).toHaveLength(1)
    expect(claimed.rows[0]).toMatchObject({
      id,
      status: 'sending',
      attempt: 1,
    })
  })

  it('marks a delivery sent', async () => {
    const id = await enqueue('B')
    await migrator.query(`SELECT internal.claim_due_email_deliveries(10)`)
    const done = await migrator.query<{ status: string; sent_at: string }>(
      `SELECT * FROM internal.finish_email_delivery($1, true, NULL)`,
      [id],
    )
    expect(done.rows[0]?.status).toBe('sent')
    expect(done.rows[0]?.sent_at).not.toBeNull()
  })

  it('schedules backoff on failure and dead-letters after five attempts', async () => {
    const id = await enqueue('C')
    await migrator.query(`SELECT internal.claim_due_email_deliveries(10)`)
    const retry = await migrator.query<{
      status: string
      next_attempt_at: string
    }>(`SELECT * FROM internal.finish_email_delivery($1, false, 'SMTP down')`, [
      id,
    ])
    expect(retry.rows[0]?.status).toBe('pending')
    expect(new Date(retry.rows[0]!.next_attempt_at).getTime()).toBeGreaterThan(
      Date.now(),
    )

    await migrator.query(
      `UPDATE internal.email_deliveries SET attempt = 5 WHERE id = $1`,
      [id],
    )
    const dead = await migrator.query<{ status: string }>(
      `SELECT * FROM internal.finish_email_delivery($1, false, 'gave up')`,
      [id],
    )
    expect(dead.rows[0]?.status).toBe('dead')
  })
})

describe('quiet hours', () => {
  it('holds non-urgent email but always delivers signature requests', async () => {
    await migrator.query(`DELETE FROM internal.email_deliveries`)
    await migrator.query(
      `INSERT INTO api.user_preferences (user_id, quiet_hours_start, quiet_hours_end)
       VALUES ('${USER}',
               to_char(now() AT TIME ZONE 'UTC' - interval '1 hour', 'HH24:MI'),
               to_char(now() AT TIME ZONE 'UTC' + interval '1 hour', 'HH24:MI'))`,
    )
    const heldFlag = await migrator.query<{ h: boolean }>(
      `SELECT internal.email_held_for_quiet_hours($1, 'material_expiring') AS h`,
      [USER],
    )
    expect(heldFlag.rows[0]?.h).toBe(true)

    await migrator.query(
      `SELECT internal.enqueue_email_delivery($1, $2, 'material_expiring', 'Lot expiring', 'body')`,
      [WS, USER],
    )
    const held = await migrator.query(
      `SELECT * FROM internal.claim_due_email_deliveries(10)`,
    )
    expect(held.rows).toHaveLength(0)

    const urgent = await migrator.query<{ id: string }>(
      `SELECT internal.enqueue_email_delivery($1, $2, 'signature_requested', 'Signature requested', 'body') AS id`,
      [WS, USER],
    )
    const claimed = await migrator.query<{ id: string }>(
      `SELECT * FROM internal.claim_due_email_deliveries(10)`,
    )
    expect(claimed.rows.map((row) => row.id)).toEqual([urgent.rows[0]!.id])
  })
})
