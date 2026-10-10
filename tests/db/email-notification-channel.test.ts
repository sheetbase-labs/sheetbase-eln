/**
 * PIPE-05.1 — email notification destinations.
 *
 * The outbox (internal.email_deliveries) and its transport already existed; what an email
 * destination needed was a way to be configured. A destination is keyed by a URL for webhook
 * and teams, and by a person for email, so this proves the two shapes are kept apart: an email
 * destination needs a recipient and no URL, a webhook needs a URL and no recipient, the
 * recipient has to be in the workspace being configured, and an email destination is given no
 * signing secret because an outbox row is not a signed request.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { setActorJwt, prepareTestDatabase } from './helpers'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

const WS_A = '00000000-0000-4000-8000-00000000081a'
const WS_B = '00000000-0000-4000-8000-00000000081b'
const OWNER = 'emailch-owner'
const MEMBER = 'emailch-member'
const OUTSIDER = 'emailch-outsider'

async function asUser(userId: string, workspaceId: string): Promise<Client> {
  const c = await asRole('authenticator')
  clients.push(c)
  await c.query('SET ROLE authenticated')
  await setActorJwt(c, userId, workspaceId)
  return c
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  const db = drizzle(migrator)

  await db.insert(schema.user).values([
    {
      id: OWNER,
      name: 'Owner',
      email: 'emailch-o@sheetbase.test',
      emailVerified: true,
    },
    {
      id: MEMBER,
      name: 'Member',
      email: 'emailch-m@sheetbase.test',
      emailVerified: true,
    },
    {
      id: OUTSIDER,
      name: 'Outsider',
      email: 'emailch-x@sheetbase.test',
      emailVerified: true,
    },
  ])
  await db.insert(schema.workspaces).values([
    { id: WS_A, name: 'Email Channel A', slug: 'emailch-a' },
    { id: WS_B, name: 'Email Channel B', slug: 'emailch-b' },
  ])
  await db.insert(schema.workspaceMemberships).values([
    { workspaceId: WS_A, userId: OWNER, role: 'owner' },
    { workspaceId: WS_A, userId: MEMBER, role: 'member' },
    { workspaceId: WS_B, userId: OUTSIDER, role: 'owner' },
  ])
})

afterAll(async () => {
  for (const c of clients) await c.end().catch(() => {})
  await migrator?.end().catch(() => {})
})

describe('email notification destinations', () => {
  it('configures an email destination by naming a person, with no URL and no signing secret', async () => {
    const owner = await asUser(OWNER, WS_A)
    const { rows } = await owner.query(
      `SELECT api.create_webhook_subscription($1, $2, $3, $4, NULL, 5, 10, NULL, NULL, 'email', $5) AS result`,
      [
        WS_A,
        'email-owner',
        null,
        JSON.stringify(['pipeline.run.completed']),
        MEMBER,
      ],
    )
    const result = rows[0].result
    expect(result.subscription.channel_type).toBe('email')
    expect(result.subscription.recipient_user_id).toBe(MEMBER)
    expect(result.subscription.url).toBeNull()
    expect(result.signing_secret).toBeNull()

    // No secret row: an outbox row is not a signed request.
    const { rows: secrets } = await migrator.query(
      `SELECT count(*)::int AS n FROM internal.webhook_secrets WHERE subscription_id = $1`,
      [result.subscription.id],
    )
    expect(secrets[0].n).toBe(0)
  })

  it('refuses an email destination with nobody to send to', async () => {
    const owner = await asUser(OWNER, WS_A)
    await expect(
      owner.query(
        `SELECT api.create_webhook_subscription($1, $2, $3, NULL, NULL, 5, 10, NULL, NULL, 'email', NULL)`,
        [WS_A, 'email-nobody', null],
      ),
    ).rejects.toThrow(/needs a recipient/)
  })

  it('refuses an email destination that also carries a URL', async () => {
    const owner = await asUser(OWNER, WS_A)
    await expect(
      owner.query(
        `SELECT api.create_webhook_subscription($1, $2, $3, NULL, NULL, 5, 10, NULL, NULL, 'email', $4)`,
        [WS_A, 'email-url', 'https://example.com/nope', MEMBER],
      ),
    ).rejects.toThrow(/does not take a URL/)
  })

  it('refuses a recipient outside the workspace being configured', async () => {
    const owner = await asUser(OWNER, WS_A)
    await expect(
      owner.query(
        `SELECT api.create_webhook_subscription($1, $2, $3, NULL, NULL, 5, 10, NULL, NULL, 'email', $4)`,
        [WS_A, 'email-outsider', null, OUTSIDER],
      ),
    ).rejects.toThrow(/not a member of this workspace/)
  })

  it('refuses a webhook destination that names a recipient', async () => {
    const owner = await asUser(OWNER, WS_A)
    await expect(
      owner.query(
        `SELECT api.create_webhook_subscription($1, $2, $3, NULL, NULL, 5, 10, NULL, NULL, 'webhook', $4)`,
        [WS_A, 'webhook-recipient', 'https://example.com/ok', MEMBER],
      ),
    ).rejects.toThrow(/only an email destination names a recipient/)
  })

  it('still requires an https URL for a webhook destination', async () => {
    const owner = await asUser(OWNER, WS_A)
    await expect(
      owner.query(
        `SELECT api.create_webhook_subscription($1, $2, $3, NULL, NULL, 5, 10, NULL, NULL, 'webhook', NULL)`,
        [WS_A, 'webhook-insecure', 'http://example.com/plain'],
      ),
    ).rejects.toThrow(/must be https/)
  })
})
