/** Real PostgreSQL: a subscription's destination type decides what is sent. */
import { randomUUID } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { processChangeEvent, processRetries } from '#/lib/webhook-delivery'
import { migratorUrl, prepareTestDatabase } from './helpers'

const receiver = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('#/lib/webhook-http.server', () => ({
  safeWebhookFetch: receiver.post,
}))

let db: Client
const WS = randomUUID()
const PERSON = 'channels-person'
const HOOK = randomUUID()
const TEAMS = randomUUID()
const MAIL = randomUUID()

beforeAll(async () => {
  db = (await prepareTestDatabase()).migrator
  await db.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified")
     VALUES ($1,'Casey Person','casey@test.invalid',true)`,
    [PERSON],
  )
  await db.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'channels','Channels')`,
    [WS],
  )
  await db.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
     VALUES ($1,$2,'steward')`,
    [WS, PERSON],
  )
  await db.query(
    `INSERT INTO api.webhook_subscriptions
       (id,workspace_id,key,url,channel_type,recipient_user_id,created_at)
     VALUES ($1,$4,'hook','https://example.com/hook','webhook',NULL,now()-interval '1 day'),
            ($2,$4,'teams','https://example.webhook.office.com/x','teams',NULL,now()-interval '1 day'),
            ($3,$4,'mail',NULL,'email',$5,now()-interval '1 day')`,
    [HOOK, TEAMS, MAIL, WS, PERSON],
  )
  await db.query(
    `INSERT INTO internal.webhook_secrets(subscription_id,workspace_id,secret_name,ciphertext)
     VALUES ($1,$3,'signing_secret',$4),($2,$3,'signing_secret',$4)`,
    [HOOK, TEAMS, WS, Buffer.from('channel-test-secret')],
  )
})

beforeEach(async () => {
  await db.query('DELETE FROM api.webhook_deliveries')
  await db.query('DELETE FROM internal.email_deliveries')
  receiver.post.mockReset().mockResolvedValue(new Response('ok'))
})

afterAll(async () => {
  await db?.end()
})

async function approvalEvent() {
  const { rows } = await db.query(
    `INSERT INTO api.change_events
       (workspace_id,sequence,entity_type,entity_uuid,operation,payload)
     VALUES ($1,(SELECT coalesce(max(sequence),0)+1 FROM api.change_events WHERE workspace_id=$1),
       'approval_request',gen_random_uuid(),'create','{"state":"pending"}')
     RETURNING id, workspace_id, sequence, entity_type, operation`,
    [WS],
  )
  return rows[0]
}

it('sends each destination the body its type needs', async () => {
  await processChangeEvent(await approvalEvent(), migratorUrl())
  await processRetries(migratorUrl())

  // Only the two address-based destinations are posted to.
  expect(receiver.post).toHaveBeenCalledTimes(2)
  const bodies = receiver.post.mock.calls.map((call) =>
    JSON.stringify(call).includes('MessageCard') ? 'card' : 'json',
  )
  expect(bodies.sort()).toEqual(['card', 'json'])
})

it('emails a person instead of posting, once per event', async () => {
  const event = await approvalEvent()
  await processChangeEvent(event, migratorUrl())
  await processChangeEvent(event, migratorUrl())
  await processRetries(migratorUrl())

  const { rows } = await db.query<{ to_email: string; subject: string }>(
    `SELECT to_email, subject FROM internal.email_deliveries WHERE user_id = $1`,
    [PERSON],
  )
  expect(rows).toEqual([
    { to_email: 'casey@test.invalid', subject: 'An approval is requested' },
  ])
  const settled = await db.query<{ status: string }>(
    `SELECT status FROM api.webhook_deliveries WHERE subscription_id = $1`,
    [MAIL],
  )
  expect(settled.rows).toEqual([{ status: 'delivered' }])
})
