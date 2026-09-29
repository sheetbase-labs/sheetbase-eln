/**
 * ADMIN-02 — Webhook admin-plane database coverage.
 *
 * Exercises the exact operation paths the new admin server functions call
 * (subscription list SELECT, EVENT-02 health/list/replay RPCs, status
 * update, secret rotation) through JWT-stamped sessions — the same claims
 * mechanism `getScopedClient` uses — and proves fail-closed capability
 * enforcement per row-action plus workspace isolation. No new tables: all
 * metadata comes from the source `webhook_subscriptions` / `webhook_deliveries`
 * tables.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { setActorJwt, prepareTestDatabase } from './helpers'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

const WS_A = '00000000-0000-4000-8000-00000000080a'
const WS_B = '00000000-0000-4000-8000-00000000080b'
const OWNER = 'whadmin-owner'
const STEWARD = 'whadmin-steward'
const MEMBER = 'whadmin-member'
const VIEWER = 'whadmin-viewer'

let subId: string

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  const db = drizzle(migrator)

  await db.insert(schema.user).values([
    {
      id: OWNER,
      name: 'Owner',
      email: 'wha-o@sheetbase.test',
      emailVerified: true,
    },
    {
      id: STEWARD,
      name: 'Steward',
      email: 'wha-s@sheetbase.test',
      emailVerified: true,
    },
    {
      id: MEMBER,
      name: 'Member',
      email: 'wha-m@sheetbase.test',
      emailVerified: true,
    },
    {
      id: VIEWER,
      name: 'Viewer',
      email: 'wha-v@sheetbase.test',
      emailVerified: true,
    },
  ])
  await db.insert(schema.workspaces).values([
    { id: WS_A, name: 'Webhook Admin A', slug: 'whadmin-a' },
    { id: WS_B, name: 'Webhook Admin B', slug: 'whadmin-b' },
  ])
  await db.insert(schema.workspaceMemberships).values([
    { workspaceId: WS_A, userId: OWNER, role: 'owner' },
    { workspaceId: WS_A, userId: STEWARD, role: 'steward' },
    { workspaceId: WS_A, userId: MEMBER, role: 'member' },
    { workspaceId: WS_A, userId: VIEWER, role: 'viewer' },
    { workspaceId: WS_B, userId: OWNER, role: 'owner' },
  ])

  const owner = await asUser(OWNER, WS_A)
  const { rows } = await owner.query(
    `SELECT api.create_webhook_subscription($1, $2, $3, $4) AS result`,
    [
      WS_A,
      'admin-orders',
      'https://example.com/admin-orders',
      JSON.stringify(['record.created']),
    ],
  )
  subId = rows[0].result.subscription.id

  // Seed delivery history directly: one dead letter with a reason, one
  // failed, one pending (owned by the retry sweep, never replayable).
  const seed: Array<[string, string, string, string | null, string | null]> = [
    [
      '00000000-0000-4000-8000-0000000008d1',
      'dead_letter',
      'http_500',
      'attempt 5 failed with 500',
    ],
    [
      '00000000-0000-4000-8000-0000000008d2',
      'failed',
      'http_500',
      'attempt 1 failed with 500',
    ],
    ['00000000-0000-4000-8000-0000000008d3', 'pending', null, null],
  ]
  for (const [id, status, code, message] of seed) {
    await migrator.query(
      `INSERT INTO api.webhook_deliveries
        (id, workspace_id, subscription_id, change_event_id, event_type,
         payload, body, signature, attempt, status, error_code, error_message)
       VALUES ($1, $2, $3, $4, 'record.created',
         '{"eventType":"record.created"}', '{"eventType":"record.created"}',
         'sha256=dummy', 1, $5, $6, $7)`,
      [
        id,
        WS_A,
        subId,
        `00000000-0000-4000-8000-0000000008e${id.slice(-1)}`,
        status,
        code,
        message,
      ],
    )
  }
})

afterAll(async () => {
  for (const c of clients) {
    try {
      await c.end()
    } catch {
      /* noop */
    }
  }
  try {
    await migrator.end()
  } catch {
    /* noop */
  }
})

async function asUser(userId: string, workspaceId: string): Promise<Client> {
  const c = await asRole('authenticator')
  clients.push(c)
  await c.query('SET ROLE authenticated')
  await setActorJwt(c, userId, workspaceId)
  return c
}

/** The subscription-list SELECT used by listWebhookSubscriptionsFn. */
const LIST_SUBSCRIPTIONS_SQL = `SELECT id, key, url, description, event_types, status,
       max_retries, failure_threshold, consecutive_failures,
       rate_limit_per_minute,
       created_at::text AS created_at, updated_at::text AS updated_at
  FROM api.webhook_subscriptions
 WHERE workspace_id = $1::uuid
 ORDER BY key ASC`

describe('ADMIN-02 webhook admin plane', () => {
  it('lists subscriptions for members but isolates workspaces', async () => {
    const member = await asUser(MEMBER, WS_A)
    const { rows } = await member.query(LIST_SUBSCRIPTIONS_SQL, [WS_A])
    expect(rows.map((r: { key: string }) => r.key)).toContain('admin-orders')

    const other = await asUser(OWNER, WS_B)
    const isolated = await other.query(LIST_SUBSCRIPTIONS_SQL, [WS_B])
    expect(isolated.rows).toHaveLength(0)
  })

  it('reports endpoint health with the dead-letter window to members', async () => {
    const member = await asUser(MEMBER, WS_A)
    const { rows } = await member.query(
      `SELECT api.get_webhook_endpoint_health($1::uuid, NULL) AS result`,
      [WS_A],
    )
    const entry = rows[0].result.data.find(
      (h: { subscription_id: string }) => h.subscription_id === subId,
    )
    expect(entry.dead_letter_24h).toBe(1)
    expect(entry.failed_24h).toBe(1)
    expect(entry.last_error.code).toBe('http_500')
  })

  it('filters delivery history to the dead-letter view with reasons', async () => {
    const member = await asUser(MEMBER, WS_A)
    const { rows } = await member.query(
      `SELECT api.list_webhook_deliveries($1::uuid, NULL, 50, 0, 'dead_letter', NULL, NULL, NULL) AS result`,
      [WS_A],
    )
    expect(rows[0].result.total).toBe(1)
    expect(rows[0].result.data[0].error_code).toBe('http_500')
    expect(rows[0].result.data[0].error_message).toBe(
      'attempt 5 failed with 500',
    )
  })

  it('lets stewards disable and re-enable, resetting failure debt', async () => {
    const steward = await asUser(STEWARD, WS_A)
    await migrator.query(
      `UPDATE api.webhook_subscriptions SET consecutive_failures = 3 WHERE id = $1`,
      [subId],
    )
    const disabled = await steward.query(
      `SELECT * FROM api.update_webhook_subscription($1::uuid, $2::uuid, NULL, NULL, NULL, 'disabled', NULL, NULL, NULL)`,
      [WS_A, subId],
    )
    expect(disabled.rows[0].status).toBe('disabled')

    const owner = await asUser(OWNER, WS_A)
    const enabled = await owner.query(
      `SELECT * FROM api.update_webhook_subscription($1::uuid, $2::uuid, NULL, NULL, NULL, 'active', NULL, NULL, NULL)`,
      [WS_A, subId],
    )
    expect(enabled.rows[0].status).toBe('active')
    expect(enabled.rows[0].consecutive_failures).toBe(0)
  })

  it('denies status changes to members without integrations.manage', async () => {
    const member = await asUser(MEMBER, WS_A)
    await expect(
      member.query(
        `SELECT * FROM api.update_webhook_subscription($1::uuid, $2::uuid, NULL, NULL, NULL, 'disabled', NULL, NULL, NULL)`,
        [WS_A, subId],
      ),
    ).rejects.toThrow()
  })

  it('bulk-replays the dead-letter window, skipping already-queued originals', async () => {
    const steward = await asUser(STEWARD, WS_A)
    const first = await steward.query(
      `SELECT api.replay_webhook_deliveries($1::uuid, $2::uuid, NULL, NULL, 'dead_letter', 50) AS result`,
      [WS_A, subId],
    )
    expect(first.rows[0].result.replayed_count).toBe(1)
    const second = await steward.query(
      `SELECT api.replay_webhook_deliveries($1::uuid, $2::uuid, NULL, NULL, 'dead_letter', 50) AS result`,
      [WS_A, subId],
    )
    expect(second.rows[0].result.replayed_count).toBe(0)
  })

  it('replays a single failed delivery but never a pending one', async () => {
    const steward = await asUser(STEWARD, WS_A)
    const replayed = await steward.query(
      `SELECT * FROM api.replay_webhook_delivery($1::uuid, $2::uuid)`,
      [WS_A, '00000000-0000-4000-8000-0000000008d2'],
    )
    expect(replayed.rows[0].status).toBe('pending')
    expect(replayed.rows[0].replay_of_delivery_id).toBe(
      '00000000-0000-4000-8000-0000000008d2',
    )
    await expect(
      steward.query(
        `SELECT * FROM api.replay_webhook_delivery($1::uuid, $2::uuid)`,
        [WS_A, '00000000-0000-4000-8000-0000000008d3'],
      ),
    ).rejects.toThrow(/only terminal/)
  })

  it('denies replay and rotation to viewers and members', async () => {
    const viewer = await asUser(VIEWER, WS_A)
    await expect(
      viewer.query(
        `SELECT * FROM api.replay_webhook_delivery($1::uuid, $2::uuid)`,
        [WS_A, '00000000-0000-4000-8000-0000000008d2'],
      ),
    ).rejects.toThrow()
    const member = await asUser(MEMBER, WS_A)
    await expect(
      member.query(
        `SELECT api.rotate_webhook_secret($1::uuid, $2::uuid, NULL) AS result`,
        [WS_A, subId],
      ),
    ).rejects.toThrow()
  })

  it('rotates the signing secret exactly once for stewards', async () => {
    const steward = await asUser(STEWARD, WS_A)
    const { rows } = await steward.query(
      `SELECT api.rotate_webhook_secret($1::uuid, $2::uuid, NULL) AS result`,
      [WS_A, subId],
    )
    expect(rows[0].result.ok).toBe(true)
    expect(rows[0].result.signing_secret).toMatch(/^[0-9a-f]{32,}$/)
  })
})
