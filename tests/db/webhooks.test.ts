/**
 * API-06 — Webhooks integration test.
 *
 * Tests webhook subscription CRUD, delivery record creation, replay,
 * auto-disablement, and capability enforcement against a freshly migrated
 * database.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { setActorJwt, migratorUrl, prepareTestDatabase } from './helpers'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let db: ReturnType<typeof drizzle<typeof schema>>
const clients: Array<Client> = []

const WS_A = '00000000-0000-4000-8000-00000000070a'
const OWNER_A = 'webhook-owner-a'
const MEMBER_A = 'webhook-member-a'
const VIEWER_A = 'webhook-viewer-a'

const CRED_A = '00000000-0000-4000-8000-00000000070c'

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })

  // Create users and workspace.
  await db.insert(schema.user).values([
    { id: OWNER_A, name: 'Owner A', email: 'whk-a@sheetbase.test', emailVerified: true },
    { id: MEMBER_A, name: 'Member A', email: 'whk-mem@sheetbase.test', emailVerified: true },
    { id: VIEWER_A, name: 'Viewer A', email: 'whk-view@sheetbase.test', emailVerified: true },
  ])

  await db.insert(schema.workspaces).values({
    id: WS_A,
    name: 'Webhook Test Workspace',
    slug: 'whk-test',
  })

  await db.insert(schema.workspaceMemberships).values([
    { workspaceId: WS_A, userId: OWNER_A, role: 'owner' },
    { workspaceId: WS_A, userId: MEMBER_A, role: 'member' },
    { workspaceId: WS_A, userId: VIEWER_A, role: 'viewer' },
  ])

  // Create an API credential for api_client tests.
  await db.insert(schema.apiCredentials).values({
    id: CRED_A,
    workspaceId: WS_A,
    name: 'test-webhook-credential',
    scopes: ['webhooks:read', 'webhooks:write'],
    createdByUserId: OWNER_A,
    kind: 'service',
    secretHash: 'dummy-hash-for-testing-only',
    displayPrefix: 'whk_test_prefix',
  })
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

async function asOwner(): Promise<Client> {
  const c = await asRole('authenticator')
  clients.push(c)
  await c.query('SET ROLE authenticated')
  await setActorJwt(c, OWNER_A, WS_A)
  return c
}

async function asApiCredential(): Promise<Client> {
  const c = await asRole('authenticator')
  clients.push(c)
  await c.query('SET ROLE api_client')
  await c.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({
      role: 'api_client',
      workspace_id: WS_A,
      credential_id: CRED_A,
      scopes: ['webhooks:read', 'webhooks:write'],
    }),
  ])
  return c
}

describe('API-06 Webhooks', () => {
  describe('create_webhook_subscription', () => {
    it('creates a subscription as workspace owner', async () => {
      const c = await asOwner()
      const { rows } = await c.query(
        `SELECT api.create_webhook_subscription($1, $2, $3, $4, $5) AS result`,
        [
          WS_A,
          'test-hook-1',
          'https://example.com/webhook',
          JSON.stringify(['record.created', 'dataset.versioned']),
          'Test webhook subscription',
        ],
      )
      expect(rows).toHaveLength(1)
      const sub = rows[0].result.subscription
      expect(sub.key).toBe('test-hook-1')
      expect(sub.url).toBe('https://example.com/webhook')
      expect(sub.status).toBe('active')
      expect(sub.max_retries).toBe(5)
      expect(sub.failure_threshold).toBe(10)
      expect(sub.consecutive_failures).toBe(0)
      expect(sub.created_by_user_id).toBe(OWNER_A)
      // Signing secret is returned exactly once.
      expect(rows[0].result.signing_secret).toMatch(/^[0-9a-f]{32,}$/)
    })

    it('rejects non-HTTPS URLs', async () => {
      const c = await asOwner()
      await expect(
        c.query(
          `SELECT * FROM api.create_webhook_subscription($1, $2, $3)`,
          [WS_A, 'test-hook-http', 'http://example.com/webhook'],
        ),
      ).rejects.toThrow()
    })

    it('rejects invalid keys', async () => {
      const c = await asOwner()
      await expect(
        c.query(
          `SELECT * FROM api.create_webhook_subscription($1, $2, $3)`,
          [WS_A, 'Bad Key!', 'https://example.com/webhook'],
        ),
      ).rejects.toThrow()
    })

    it('rejects duplicate keys in the same workspace', async () => {
      const c = await asOwner()
      await expect(
        c.query(
          `SELECT * FROM api.create_webhook_subscription($1, $2, $3)`,
          [WS_A, 'test-hook-1', 'https://example.com/other'],
        ),
      ).rejects.toThrow()
    })

    it('creates a subscription as api_client credential', async () => {
      const c = await asApiCredential()
      const { rows } = await c.query(
        `SELECT api.create_webhook_subscription($1, $2, $3, $4) AS result`,
        [WS_A, 'cred-hook-1', 'https://example.com/cred-webhook', JSON.stringify([])],
      )
      expect(rows).toHaveLength(1)
      const sub = rows[0].result.subscription
      expect(sub.key).toBe('cred-hook-1')
      expect(sub.created_by_credential_id).toBe(CRED_A)
      expect(sub.created_by_user_id).toBeNull()
    })
  })

  describe('update_webhook_subscription', () => {
    it('updates URL and status', async () => {
      const c = await asOwner()
      const { rows: created } = await c.query(
        `SELECT api.create_webhook_subscription($1, $2, $3) AS result`,
        [WS_A, 'update-test', 'https://example.com/initial'],
      )
      const subId = created[0].result.subscription.id

      const { rows } = await c.query(
        `SELECT * FROM api.update_webhook_subscription($1, $2, $3, $4, $5)`,
        [WS_A, subId, 'https://example.com/updated', null, 'Updated description'],
      )
      expect(rows[0].url).toBe('https://example.com/updated')
      expect(rows[0].description).toBe('Updated description')
    })

    it('resets consecutive_failures when re-enabling', async () => {
      const c = await asOwner()
      // Create a subscription, then manually set it to disabled with failures.
      const { rows: created } = await c.query(
        `SELECT api.create_webhook_subscription($1, $2, $3) AS result`,
        [WS_A, 'reenable-test', 'https://example.com/re'],
      )
      const subId = created[0].result.subscription.id

      await migrator.query(
        `UPDATE api.webhook_subscriptions SET consecutive_failures = 10, status = 'disabled' WHERE id = $1`,
        [subId],
      )

      const { rows } = await c.query(
        `SELECT * FROM api.update_webhook_subscription($1, $2, NULL, NULL, NULL, $3)`,
        [WS_A, subId, 'active'],
      )
      expect(rows[0].status).toBe('active')
      expect(rows[0].consecutive_failures).toBe(0)
    })

    it('rejects update from a viewer', async () => {
      const c = await asOwner()
      const { rows: created } = await c.query(
        `SELECT api.create_webhook_subscription($1, $2, $3) AS result`,
        [WS_A, 'viewer-test', 'https://example.com/vt'],
      )
      const subId = created[0].result.subscription.id

      const viewer = await asRole('authenticator')
      clients.push(viewer)
      await viewer.query('SET ROLE authenticated')
      await setActorJwt(viewer, VIEWER_A, WS_A)
      await expect(
        viewer.query(
          `SELECT * FROM api.update_webhook_subscription($1, $2, $3)`,
          [WS_A, subId, 'https://example.com/hacked'],
        ),
      ).rejects.toThrow()
    })
  })

  describe('delete_webhook_subscription', () => {
    it('archives the subscription (soft delete)', async () => {
      const c = await asOwner()
      const { rows: created } = await c.query(
        `SELECT api.create_webhook_subscription($1, $2, $3) AS result`,
        [WS_A, 'delete-test', 'https://example.com/del'],
      )
      const subId = created[0].result.subscription.id

      const { rows } = await c.query(
        `SELECT * FROM api.delete_webhook_subscription($1, $2)`,
        [WS_A, subId],
      )
      expect(rows[0].status).toBe('archived')
    })
  })

  describe('rotate_webhook_secret', () => {
    it('rotates the signing secret', async () => {
      const c = await asOwner()
      const { rows: created } = await c.query(
        `SELECT api.create_webhook_subscription($1, $2, $3) AS result`,
        [WS_A, 'rotate-test', 'https://example.com/rot'],
      )
      const subId = created[0].result.subscription.id

      const { rows } = await c.query(
        `SELECT api.rotate_webhook_secret($1, $2) AS result`,
        [WS_A, subId],
      )
      expect(rows[0].result.ok).toBe(true)
      // The new signing secret is returned exactly once.
      expect(rows[0].result.signing_secret).toMatch(/^[0-9a-f]{32,}$/)
    })
  })

  describe('list_webhook_deliveries', () => {
    it('returns paginated delivery history', async () => {
      const c = await asOwner()
      const { rows } = await c.query(
        `SELECT api.list_webhook_deliveries($1, $2, $3, $4) AS result`,
        [WS_A, null, 10, 0],
      )
      const result = rows[0].result
      expect(result.total).toBe(0)
      expect(result.data).toEqual([])
      expect(result.limit).toBe(10)
      expect(result.offset).toBe(0)
    })

    it('works with api_client role', async () => {
      const c = await asApiCredential()
      const { rows } = await c.query(
        `SELECT api.list_webhook_deliveries($1) AS result`,
        [WS_A],
      )
      expect(rows[0].result.data).toEqual([])
    })
  })

  describe('replay_webhook_delivery', () => {
    it('creates a new pending delivery from an existing one', async () => {
      const c = await asOwner()
      // Create a subscription.
      const { rows: subs } = await c.query(
        `SELECT api.create_webhook_subscription($1, $2, $3) AS result`,
        [WS_A, 'replay-test', 'https://example.com/replay'],
      )
      const subId = subs[0].result.subscription.id

      // Insert a delivery record directly as migrator.
      const changeEventId = '00000000-0000-4000-8000-0000000000e1'
      const deliveryId = '00000000-0000-4000-8000-0000000000d1'
      const body = JSON.stringify({ eventType: 'record.created' })
      await migrator.query(
        `INSERT INTO api.webhook_deliveries
          (id, workspace_id, subscription_id, change_event_id, event_type,
           payload, body, signature, attempt, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'delivered')`,
        [
          deliveryId,
          WS_A,
          subId,
          changeEventId,
          'record.created',
          JSON.stringify({ eventType: 'record.created' }),
          body,
          'sha256=dummy',
        ],
      )

      const { rows } = await c.query(
        `SELECT * FROM api.replay_webhook_delivery($1, $2)`,
        [WS_A, deliveryId],
      )
      expect(rows[0].status).toBe('pending')
      expect(rows[0].attempt).toBe(0)
      expect(rows[0].event_type).toBe('record.created')
      expect(rows[0].body).toBe(body)
      expect(rows[0].id).not.toBe(deliveryId) // new row
    })

    it('rejects replay from a viewer', async () => {
      const c = await asOwner()
      const { rows: subs } = await c.query(
        `SELECT api.create_webhook_subscription($1, $2, $3) AS result`,
        [WS_A, 'replay-viewer-test', 'https://example.com/rvt'],
      )
      const subId = subs[0].result.subscription.id

      const deliveryId = '00000000-0000-4000-8000-0000000000d2'
      await migrator.query(
        `INSERT INTO api.webhook_deliveries
          (id, workspace_id, subscription_id, change_event_id, event_type,
           payload, body, signature, status)
         VALUES ($1, $2, $3, '00000000-0000-4000-8000-0000000000e2', 'dataset.updated', $4, $5, 'sha256=x', 'delivered')`,
        [deliveryId, WS_A, subId, JSON.stringify({ eventType: 'dataset.updated' }), JSON.stringify({ eventType: 'dataset.updated' })],
      )

      const viewer = await asRole('authenticator')
      clients.push(viewer)
      await viewer.query('SET ROLE authenticated')
      await setActorJwt(viewer, VIEWER_A, WS_A)
      await expect(
        viewer.query(
          `SELECT * FROM api.replay_webhook_delivery($1, $2)`,
          [WS_A, deliveryId],
        ),
      ).rejects.toThrow()
    })
  })

  describe('auto-disablement', () => {
    it('disables subscription after failure threshold is reached', async () => {
      const c = await asOwner()
      const { rows: subs } = await c.query(
        `SELECT api.create_webhook_subscription($1, $2, $3, $4, $5, $6, $7) AS result`,
        [
          WS_A,
          'auto-disable-test',
          'https://example.com/ad',
          JSON.stringify([]),
          'Auto disable test',
          5, // max_retries
          3, // failure_threshold
        ],
      )
      const subId = subs[0].result.subscription.id

      // Create a delivery and fail it 3 times.
      const deliveryId = '00000000-0000-4000-8000-0000000000a1'
      await migrator.query(
        `INSERT INTO api.webhook_deliveries
          (id, workspace_id, subscription_id, change_event_id, event_type,
           payload, body, signature, status)
         VALUES ($1, $2, $3, '00000000-0000-4000-8000-0000000000a0', 'record.created', $4, $5, 'sha256=x', 'pending')`,
        [deliveryId, WS_A, subId, JSON.stringify({ eventType: 'record.created' }), JSON.stringify({ eventType: 'record.created' })],
      )

      // Fail 3 times — should auto-disable.
      for (let i = 0; i < 3; i++) {
        await migrator.query(
          `SELECT api.record_webhook_delivery_result($1, $2, $3, $4, $5, $6, $7, NULL)`,
          [WS_A, deliveryId, 'failed', null, null, 'http_error', 'HTTP 500'],
        )
      }

      const { rows: statusRows } = await migrator.query(
        `SELECT s.status, s.consecutive_failures, d.attempt
           FROM api.webhook_subscriptions s, api.webhook_deliveries d
          WHERE s.id = $1 AND d.id = $2`,
        [subId, deliveryId],
      )
      expect(statusRows[0].status).toBe('disabled')
      expect(statusRows[0].consecutive_failures).toBe(3)
      // attempt is incremented on each failure.
      expect(statusRows[0].attempt).toBe(3)
    })
  })

  describe('signing secret storage', () => {
    it('stores a signing secret in internal.webhook_secrets', async () => {
      const c = await asOwner()
      const { rows: subs } = await c.query(
        `SELECT api.create_webhook_subscription($1, $2, $3) AS result`,
        [WS_A, 'secret-test', 'https://example.com/sec'],
      )
      const subId = subs[0].result.subscription.id

      const { rows: secrets } = await migrator.query(
        `SELECT secret_name, ciphertext FROM internal.webhook_secrets WHERE subscription_id = $1`,
        [subId],
      )
      expect(secrets).toHaveLength(1)
      expect(secrets[0].secret_name).toBe('signing_secret')
      // The RPC stores the raw secret as plaintext; the app server encrypts
      // it on first read using the sealed-secret pattern (sealSecret/openSecret).
      // The generated secret is a 64-char hex string (two UUIDs concatenated).
      expect(secrets[0].ciphertext.toString('utf8')).toMatch(/^[0-9a-f]{64}$/)
    })
  })
})
