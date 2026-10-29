/**
 * Real PostgreSQL: a subscription that cannot be signed is recorded once, so
 * the catch-up sweep stops re-trying the same events every minute.
 */
import { randomUUID } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import {
  processRetries,
  reconcileWebhookDeliveries,
} from '#/lib/webhook-delivery'
import { migratorUrl, prepareTestDatabase } from './helpers'

const receiver = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('#/lib/webhook-http.server', () => ({
  safeWebhookFetch: receiver.post,
}))

let db: Client
const WS = randomUUID()
const NO_SECRET_HOOK = randomUUID()
const TEAMS = randomUUID()

beforeAll(async () => {
  db = (await prepareTestDatabase()).migrator
  await db.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'nosecret','No secret')`,
    [WS],
  )
  await db.query(
    `INSERT INTO api.webhook_subscriptions
       (id,workspace_id,key,url,channel_type,recipient_user_id,created_at)
     VALUES ($1,$3,'hook','https://example.com/hook','webhook',NULL,now()-interval '1 day'),
            ($2,$3,'teams','https://example.webhook.office.com/x','teams',NULL,now()-interval '1 day')`,
    [NO_SECRET_HOOK, TEAMS, WS],
  )
  receiver.post.mockResolvedValue(new Response('ok'))
  for (let i = 0; i < 3; i++) {
    await db.query(
      `INSERT INTO api.change_events
         (workspace_id,sequence,entity_type,entity_uuid,operation,payload)
       VALUES ($1,$2,'record',gen_random_uuid(),'create','{}')`,
      [WS, i + 1],
    )
  }
})

afterAll(async () => {
  await db?.end()
})

it('accounts for every event once, however many sweeps run', async () => {
  const first = await reconcileWebhookDeliveries(migratorUrl())
  expect(first).toBe(3)
  // Nothing is left to re-process: the second sweep finds no event without a
  // delivery record.
  expect(await reconcileWebhookDeliveries(migratorUrl())).toBe(0)

  const { rows } = await db.query<{
    subscription_id: string
    status: string
    n: number
  }>(
    `SELECT subscription_id, status, count(*)::int AS n
       FROM api.webhook_deliveries GROUP BY 1, 2`,
  )
  const by = (id: string) => rows.filter((r) => r.subscription_id === id)
  expect(by(NO_SECRET_HOOK)).toEqual([
    { subscription_id: NO_SECRET_HOOK, status: 'dead_letter', n: 3 },
  ])
  // Teams needs no signing secret: its cards are delivered normally.
  await processRetries(migratorUrl())
  const teams = await db.query<{ status: string }>(
    `SELECT status FROM api.webhook_deliveries WHERE subscription_id = $1`,
    [TEAMS],
  )
  expect(teams.rows.map((r) => r.status)).toEqual([
    'delivered',
    'delivered',
    'delivered',
  ])
  const headers = receiver.post.mock.calls.map((c) =>
    JSON.stringify(c[1]?.headers),
  )
  expect(headers.every((h) => !h.includes('x-sheetbase-signature'))).toBe(true)
})
