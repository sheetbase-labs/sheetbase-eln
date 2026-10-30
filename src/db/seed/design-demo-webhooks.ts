/**
 * The demo's webhooks deliver. Their addresses (a document-management system
 * and a Teams channel) do not exist, so every delivery failed and the
 * connections page said "Failing" all day. With sign-in off they are pointed
 * at the app's own receiver (`/api/demo/webhook-sink`), so each signature the
 * demo makes is delivered and the failing history clears as it retries.
 */
import { sql } from 'drizzle-orm'

import { demoWebhookSinkUrl } from '#/lib/demo-webhook-sink'
import { demoSigningEnabled } from './design-demo-signing'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'

export async function seedDemoWebhooks(db: Db): Promise<void> {
  if (!demoSigningEnabled()) return
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
