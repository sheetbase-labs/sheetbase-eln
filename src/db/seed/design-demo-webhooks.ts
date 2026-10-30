/**
 * The demo's webhooks deliver. Their addresses (a document-management system
 * and a Teams channel) do not exist, so every delivery failed and the
 * connections page said "Failing" all day. With sign-in off they are pointed
 * at the app's own receiver (`/api/demo/webhook-sink`), so each signature the
 * demo makes is delivered and the failing history clears as it retries.
 */
import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'

import { sealSecret } from '#/lib/connector-secrets.server'
import { deriveWebhookSecretKey } from '#/lib/webhook-signing'

import { demoWebhookSinkUrl } from '#/lib/demo-webhook-sink'
import { demoSigningEnabled } from './design-demo-signing'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'

export async function seedDemoWebhooks(db: Db): Promise<void> {
  if (!demoSigningEnabled()) return
  await giveSigningSecrets(db)
  const url = demoWebhookSinkUrl(
    process.env.BETTER_AUTH_URL ??
      (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : undefined),
  )
  if (!url) return
  await db.execute(sql`
    UPDATE api.webhook_subscriptions SET url = ${url}
     WHERE workspace_id = ${PROCESS}
       AND key IN ('document-management', 'aav9-process-teams')`)
}

/**
 * A delivery is signed, and the engine will not send one for a subscription
 * with no signing secret ("no signing secret for subscription"), so the
 * seeded subscriptions need the secret a real one is created with.
 */
async function giveSigningSecrets(db: Db): Promise<void> {
  const master = process.env.BETTER_AUTH_SECRET
  if (!master) return
  const key = deriveWebhookSecretKey(master)
  const subscriptions = await db.execute<{ id: string }>(sql`
    SELECT s.id FROM api.webhook_subscriptions s
     WHERE s.workspace_id = ${PROCESS}
       AND NOT EXISTS (SELECT 1 FROM internal.webhook_secrets w WHERE w.subscription_id = s.id)`)
  for (const { id } of subscriptions.rows) {
    const sealed = sealSecret(randomBytes(32).toString('base64url'), key)
    await db.execute(sql`
      INSERT INTO internal.webhook_secrets (workspace_id, subscription_id, secret_name, ciphertext)
      VALUES (${PROCESS}, ${id}, 'signing_secret', ${Buffer.from(sealed, 'utf8')})
      ON CONFLICT DO NOTHING`)
  }
}
