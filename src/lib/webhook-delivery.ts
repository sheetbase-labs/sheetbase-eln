/**
 * API-06 — Webhook delivery engine.
 *
 * Server-only module that listens for change events (via Postgres LISTEN on
 * the `sheetbase_change` channel), matches them against active webhook
 * subscriptions, creates delivery records, and attempts HTTP POST delivery
 * with HMAC-SHA256 signed payloads.
 *
 * Retry strategy: exponential backoff with jitter. After a configurable
 * number of consecutive failures, the subscription is auto-disabled.
 *
 * This module is designed to run as a long-lived process started by the app
 * server. It opens a dedicated `pg` connection for LISTEN and uses the app's
 * Drizzle client for delivery record management.
 */
import { Client } from 'pg'

import { env } from '#/env.server'
import { logger } from '#/lib/logger'
import {
  mapEventType,
  matchesFilter,
  buildEventPayload,
} from '#/lib/webhook-events'
import type { ChangeEventInput } from '#/lib/webhook-events'
import { signPayload } from '#/lib/webhook-signing'

// ---------------------------------------------------------------------------
// Configuration.
// ---------------------------------------------------------------------------

/** Maximum HTTP timeout for a single delivery attempt (ms). */
const DELIVERY_TIMEOUT_MS = 30_000

/** Base delay for exponential backoff (ms). */
const BACKOFF_BASE_MS = 1_000

/** Maximum backoff delay cap (ms). */
const BACKOFF_MAX_MS = 300_000 // 5 minutes

/** Jitter factor (±%). */
const BACKOFF_JITTER = 0.2

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface WebhookSubscriptionRow {
  id: string
  workspace_id: string
  key: string
  url: string
  event_types: string[]
  max_retries: number
  failure_threshold: number
  status: string
}

export interface WebhookDeliveryRow {
  id: string
  workspace_id: string
  subscription_id: string
  change_event_id: string
  event_type: string
  payload: Record<string, unknown>
  signature: string
  attempt: number
  status: string
  next_attempt_at: string | null
}

interface NotificationPayload {
  workspace_id: string
  sequence: number
  id: string
  entity_type: string
  operation: string
}

// ---------------------------------------------------------------------------
// Backoff calculation.
// ---------------------------------------------------------------------------

/**
 * Exponential backoff with jitter for retry scheduling.
 * delay = min(base * 2^attempt, max) * (1 ± jitter)
 */
export function computeBackoff(
  attempt: number,
  baseMs: number = BACKOFF_BASE_MS,
  maxMs: number = BACKOFF_MAX_MS,
  jitter: number = BACKOFF_JITTER,
): number {
  const exponential = baseMs * Math.pow(2, attempt)
  const capped = Math.min(exponential, maxMs)
  const jitterAmount = capped * jitter * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(capped + jitterAmount))
}

// ---------------------------------------------------------------------------
// Delivery attempt.
// ---------------------------------------------------------------------------

export interface DeliveryResult {
  success: boolean
  responseStatus?: number
  responseBody?: string
  errorCode?: string
  errorMessage?: string
}

/**
 * Attempt a single HTTP POST delivery of a webhook payload.
 * Returns the result including HTTP status and any error info.
 */
export async function attemptDelivery(
  url: string,
  body: string,
  signature: string,
  timeoutMs: number = DELIVERY_TIMEOUT_MS,
): Promise<DeliveryResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sheetbase-signature': signature,
        'x-sheetbase-event': 'change',
        'user-agent': 'Sheetbase-Webhook/1.0',
      },
      body,
      signal: controller.signal,
    })
    const responseText = await response.text().catch(() => '')
    // 2xx = success; anything else triggers retry.
    if (response.status >= 200 && response.status < 300) {
      return {
        success: true,
        responseStatus: response.status,
        responseBody: responseText.slice(0, 10_000),
      }
    }
    return {
      success: false,
      responseStatus: response.status,
      responseBody: responseText.slice(0, 10_000),
      errorCode: 'http_error',
      errorMessage: `HTTP ${response.status}`,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        errorCode: 'timeout',
        errorMessage: `Request timed out after ${timeoutMs}ms`,
      }
    }
    return {
      success: false,
      errorCode: 'delivery_error',
      errorMessage: err instanceof Error ? err.message : 'Unknown delivery error',
    }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Subscription matching.
// ---------------------------------------------------------------------------

/**
 * Query active webhook subscriptions for a workspace that match the given
 * event type. Returns the subscription rows (without secrets).
 */
export async function findMatchingSubscriptions(
  workspaceId: string,
  eventType: string,
  connectionString: string = env.DATABASE_URL,
): Promise<WebhookSubscriptionRow[]> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const { rows } = await client.query<WebhookSubscriptionRow>(
      `SELECT id, workspace_id, key, url, event_types, max_retries,
              failure_threshold, status
         FROM api.webhook_subscriptions
        WHERE workspace_id = $1 AND status = 'active'`,
      [workspaceId],
    )
    return rows.filter((sub) =>
      matchesFilter(eventType, sub.event_types),
    )
  } finally {
    await client.end()
  }
}

/**
 * Fetch the signing secret for a subscription. The secret is stored as
 * AES-256-GCM ciphertext in internal.webhook_secrets. For the MVP, the
 * secret is stored as raw text (the RPC stores it directly); a future
 * enhancement will encrypt it with the app-server key.
 */
export async function getSigningSecret(
  subscriptionId: string,
  connectionString: string = env.DATABASE_URL,
): Promise<string | null> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const { rows } = await client.query<{ ciphertext: Buffer }>(
      `SELECT ciphertext FROM internal.webhook_secrets
        WHERE subscription_id = $1 AND secret_name = 'signing_secret'`,
      [subscriptionId],
    )
    if (rows.length === 0) return null
    // For the MVP, the ciphertext column stores the raw secret as UTF-8 text.
    // A future enhancement will use AES-256-GCM encryption (sealSecret/openSecret).
    return rows[0].ciphertext.toString('utf8')
  } finally {
    await client.end()
  }
}

// ---------------------------------------------------------------------------
// Delivery record management.
// ---------------------------------------------------------------------------

/**
 * Create a pending delivery record for a subscription + change event.
 * Returns the delivery row.
 */
export async function createDeliveryRecord(
  workspaceId: string,
  subscriptionId: string,
  changeEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
  signature: string,
  connectionString: string = env.DATABASE_URL,
): Promise<WebhookDeliveryRow> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const { rows } = await client.query<WebhookDeliveryRow>(
      `INSERT INTO api.webhook_deliveries
         (workspace_id, subscription_id, change_event_id, event_type,
          payload, signature, attempt, status, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 'pending', now())
       RETURNING *`,
      [
        workspaceId,
        subscriptionId,
        changeEventId,
        eventType,
        JSON.stringify(payload),
        signature,
      ],
    )
    return rows[0]
  } finally {
    await client.end()
  }
}

/**
 * Record the result of a delivery attempt and schedule a retry if needed.
 */
export async function recordDeliveryResult(
  workspaceId: string,
  deliveryId: string,
  result: DeliveryResult,
  attempt: number,
  maxRetries: number,
  connectionString: string = env.DATABASE_URL,
): Promise<void> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    if (result.success) {
      await client.query(
        `SELECT api.record_webhook_delivery_result($1, $2, $3, $4, $5, NULL, NULL, NULL)`,
        [
          workspaceId,
          deliveryId,
          'delivered',
          result.responseStatus ?? null,
          result.responseBody ?? null,
        ],
      )
    } else {
      // Determine if we should retry or fail permanently.
      const shouldRetry = attempt < maxRetries
      const status = shouldRetry ? 'retrying' : 'failed'
      const nextAttemptAt = shouldRetry
        ? new Date(Date.now() + computeBackoff(attempt))
        : null

      await client.query(
        `SELECT api.record_webhook_delivery_result($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          workspaceId,
          deliveryId,
          status,
          result.responseStatus ?? null,
          result.responseBody ?? null,
          result.errorCode ?? null,
          result.errorMessage ?? null,
          nextAttemptAt,
        ],
      )
    }
  } finally {
    await client.end()
  }
}

// ---------------------------------------------------------------------------
// Full delivery flow for a single change event.
// ---------------------------------------------------------------------------

/**
 * Process a single change event notification: find matching subscriptions,
 * create delivery records, and attempt immediate delivery.
 */
export async function processChangeEvent(
  notification: NotificationPayload,
  connectionString: string = env.DATABASE_URL,
): Promise<void> {
  // Fetch the full change event row.
  const eventClient = new Client({ connectionString })
  await eventClient.connect()
  let eventRow: ChangeEventInput | null = null
  try {
    const { rows } = await eventClient.query(
      `SELECT id, workspace_id, sequence, entity_type, entity_uuid,
              operation, record_id, project_id, actor_user_id,
              actor_credential_id, client_id, payload, created_at::text
         FROM api.change_events
        WHERE id = $1`,
      [notification.id],
    )
    if (rows.length === 0) return
    const row = rows[0]
    eventRow = {
      id: row.id,
      workspaceId: row.workspace_id,
      sequence: Number(row.sequence),
      entityType: row.entity_type,
      entityUuid: row.entity_uuid,
      operation: row.operation,
      recordId: row.record_id,
      projectId: row.project_id,
      actorUserId: row.actor_user_id,
      actorCredentialId: row.actor_credential_id,
      clientId: row.client_id,
      payload: row.payload,
      createdAt: row.created_at,
    }
  } finally {
    await eventClient.end()
  }

  // Map to stable event type.
  const eventType = mapEventType(eventRow.entityType, eventRow.operation)
  if (!eventType) return // Not in the webhook surface.

  // Find matching subscriptions.
  const subscriptions = await findMatchingSubscriptions(
    eventRow.workspaceId,
    eventType,
    connectionString,
  )
  if (subscriptions.length === 0) return

  // Build the payload once (same for all subscriptions).
  const eventPayload = buildEventPayload(eventRow, eventType)
  const body = JSON.stringify(eventPayload)
  const payloadJson = eventPayload as unknown as Record<string, unknown>

  // Deliver to each subscription.
  for (const sub of subscriptions) {
    try {
      const secret = await getSigningSecret(sub.id, connectionString)
      if (!secret) {
        logger.warn('webhook: no signing secret for subscription', {
          subscriptionId: sub.id,
        })
        continue
      }
      const signature = signPayload(body, secret)

      // Create delivery record.
      const delivery = await createDeliveryRecord(
        sub.workspace_id,
        sub.id,
        eventRow.id,
        eventType,
        payloadJson,
        signature,
        connectionString,
      )

      // Attempt immediate delivery.
      const result = await attemptDelivery(sub.url, body, signature)

      // Record the result.
      await recordDeliveryResult(
        sub.workspace_id,
        delivery.id,
        result,
        0,
        sub.max_retries,
        connectionString,
      )

      logger.info('webhook delivery attempted', {
        subscriptionId: sub.id,
        deliveryId: delivery.id,
        eventType,
        success: result.success,
        responseStatus: result.responseStatus,
      })
    } catch (err) {
      logger.error('webhook delivery error', {
        subscriptionId: sub.id,
        eventType,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Retry processor — processes deliveries that are scheduled for retry.
// ---------------------------------------------------------------------------

/**
 * Process pending retry deliveries whose next_attempt_at has passed.
 * Called periodically by the delivery engine.
 */
export async function processRetries(
  connectionString: string = env.DATABASE_URL,
  batchSize: number = 50,
): Promise<number> {
  const client = new Client({ connectionString })
  await client.connect()
  let processed = 0
  try {
    // Fetch deliveries ready for retry.
    const { rows } = await client.query(
      `SELECT d.id, d.workspace_id, d.subscription_id, d.change_event_id,
              d.event_type, d.payload, d.signature, d.attempt,
              d.status, d.next_attempt_at,
              s.url, s.max_retries, s.failure_threshold, s.status AS sub_status
         FROM api.webhook_deliveries d
         JOIN api.webhook_subscriptions s ON s.id = d.subscription_id
        WHERE d.status IN ('pending', 'retrying')
          AND d.next_attempt_at IS NOT NULL
          AND d.next_attempt_at <= now()
          AND s.status = 'active'
        ORDER BY d.next_attempt_at ASC
        LIMIT $1`,
      [batchSize],
    )

    for (const row of rows) {
      const attempt = row.attempt + 1
      const body = JSON.stringify(row.payload)
      const result = await attemptDelivery(row.url, body, row.signature)

      await recordDeliveryResult(
        row.workspace_id,
        row.id,
        result,
        attempt,
        row.max_retries,
        connectionString,
      )
      processed++
    }
  } finally {
    await client.end()
  }
  return processed
}

// ---------------------------------------------------------------------------
// LISTEN-based delivery engine.
// ---------------------------------------------------------------------------

/**
 * Start the webhook delivery engine. Opens a LISTEN connection on
 * `sheetbase_change` and processes events as they are emitted.
 *
 * Also starts a periodic retry processor for deliveries that failed and
 * are scheduled for retry.
 *
 * Returns a stop function that cleanly shuts down both the listener and
 * the retry timer.
 */
export function startWebhookDeliveryEngine(
  connectionString: string = env.DATABASE_URL,
  retryIntervalMs: number = 60_000,
): () => Promise<void> {
  const listenClient = new Client({ connectionString })
  let retryTimer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  async function handleNotification(msg: { payload?: string }) {
    if (!msg.payload || stopped) return
    try {
      const notification = JSON.parse(msg.payload) as NotificationPayload
      await processChangeEvent(notification, connectionString)
    } catch (err) {
      logger.error('webhook listen: error processing notification', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function start() {
    await listenClient.connect()
    listenClient.on('notification', handleNotification)
    await listenClient.query('LISTEN sheetbase_change')

    // Periodic retry processor.
    retryTimer = setInterval(async () => {
      if (stopped) return
      try {
        const n = await processRetries(connectionString)
        if (n > 0) {
          logger.info('webhook retry processor', { processed: n })
        }
      } catch (err) {
        logger.error('webhook retry processor error', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }, retryIntervalMs)

    logger.info('webhook delivery engine started')
  }

  void start()

  return async () => {
    stopped = true
    if (retryTimer) clearInterval(retryTimer)
    try {
      await listenClient.query('UNLISTEN sheetbase_change')
    } catch {
      /* best effort */
    }
    try {
      await listenClient.end()
    } catch {
      /* best effort */
    }
    logger.info('webhook delivery engine stopped')
  }
}
