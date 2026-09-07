import type { ExecConnection } from './pipeline-execute.server'
import type { PipelineConfig } from './pipelines/config'
import { resolvePipelineActionValue } from './pipeline-actions.server'
import { openSecret } from './connector-secrets.server'
import { deriveWebhookSecretKey, signPayload } from './webhook-signing'

/** Enqueue signed POSTs in the output transaction; the existing delivery engine owns retries. */
export async function queuePipelineNotifications(
  conn: ExecConnection,
  run: { id: string; workspace_id: string; definition_version_id: string },
  config: PipelineConfig,
  result: Record<string, unknown>,
  context: {
    parameters: Record<string, unknown>
    previous: Array<Record<string, unknown>>
    output: Record<string, unknown>
    actions: Record<string, unknown>
  },
): Promise<void> {
  if (!config.notifications?.length) return
  await conn.query('SET ROLE NONE')
  const { rows: events } = await conn.query<{ id: string; created_at: string }>(
    `SELECT id, created_at::text FROM api.change_events
     WHERE workspace_id = $1 AND entity_type = 'pipeline_run' AND entity_uuid = $2 AND operation = 'create'
     ORDER BY sequence LIMIT 1`,
    [run.workspace_id, run.id],
  )
  const event = events.at(0)
  if (!event)
    throw new Error('The run event could not be found; no webhook was queued.')
  const deliveryIds: string[] = []
  for (const target of config.notifications) {
    const { rows } = await conn.query<{ ciphertext: Buffer }>(
      `SELECT sec.ciphertext FROM api.webhook_subscriptions sub
       JOIN internal.webhook_secrets sec ON sec.subscription_id = sub.id AND sec.secret_name = 'signing_secret'
       WHERE sub.id = $1 AND sub.workspace_id = $2 AND sub.status = 'active'`,
      [target.subscriptionId, run.workspace_id],
    )
    const stored = rows[0]?.ciphertext.toString('utf8')
    if (!stored)
      throw new Error(
        'A webhook destination is unavailable. Choose an active destination and retry.',
      )
    const master = process.env.BETTER_AUTH_SECRET
    if (!master) throw new Error('Webhook signing is not configured.')
    const secret = stored.startsWith('v1.')
      ? openSecret(stored, deriveWebhookSecretKey(master))
      : stored
    const payload = {
      schemaVersion: '1',
      eventType: 'pipeline.run.completed',
      eventId: event.id,
      workspaceId: run.workspace_id,
      runId: run.id,
      definitionVersionId: run.definition_version_id,
      ...(target.payload
        ? { data: resolvePipelineActionValue(target.payload, context) }
        : {}),
      result: {
        rowCount: result.rowCount,
        outputDatasetId: result.outputDatasetId,
        outputDatasetVersionId: result.outputDatasetVersionId,
        outputLabel: result.outputLabel,
      },
    }
    const body = JSON.stringify(payload)
    if (Buffer.byteLength(body) > 64 * 1024)
      throw new Error(
        'Webhook payload exceeds 64 KiB. Choose fewer values to send.',
      )
    const signature = signPayload(body, secret)
    const inserted = await conn.query<{ id: string }>(
      `INSERT INTO api.webhook_deliveries
       (workspace_id, subscription_id, change_event_id, event_type, payload, body, signature, attempt, status, next_attempt_at)
       VALUES ($1, $2, $3, 'pipeline.run.completed', $4::jsonb, $5, $6, 0, 'pending', now())
       ON CONFLICT (subscription_id, change_event_id) WHERE replay_of_delivery_id IS NULL DO NOTHING RETURNING id`,
      [
        run.workspace_id,
        target.subscriptionId,
        event.id,
        JSON.stringify(payload),
        body,
        signature,
      ],
    )
    if (inserted.rows[0]) deliveryIds.push(inserted.rows[0].id)
  }
  result.notificationDeliveryIds = deliveryIds
}
