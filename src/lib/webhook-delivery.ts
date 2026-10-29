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
import { isIP } from 'node:net'
import { safeWebhookFetch } from './webhook-http.server'

import { env } from '#/env.server'
import { logger } from '#/lib/logger'
import {
  mapEventType,
  matchesFilter,
  buildEventPayload,
} from '#/lib/webhook-events'
import type { ChangeEventInput } from '#/lib/webhook-events'
import { signPayload, deriveWebhookSecretKey } from '#/lib/webhook-signing'
import { sealSecret, openSecret } from '#/lib/connector-secrets.server'

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
// SSRF protection — reject loopback/private/reserved webhook targets.
// ---------------------------------------------------------------------------

/**
 * Validate that a webhook URL is safe for server-side fetch.
 * Rejects non-HTTPS, credentials in URL, and loopback/private/resolved
 * hostnames. Fail-closed: any parse or resolution error rejects.
 */
export function validateWebhookUrl(url: string): {
  ok: boolean
  reason?: string
} {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'invalid URL' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'must be HTTPS' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials in URL are not allowed' }
  }
  const hostname = parsed.hostname
  // Reject IP literals that are loopback/private/reserved.
  if (isIP(hostname)) {
    if (isPrivateOrLoopbackIP(hostname)) {
      return { ok: false, reason: 'private/loopback IP not allowed' }
    }
  } else {
    // Reject common internal hostnames.
    const lower = hostname.toLowerCase()
    if (
      lower === 'localhost' ||
      lower.endsWith('.local') ||
      lower.endsWith('.internal') ||
      lower === 'metadata.google.internal'
    ) {
      return { ok: false, reason: 'internal hostname not allowed' }
    }
  }
  return { ok: true }
}

/**
 * Check if an IP address is private, loopback, or reserved.
 * Covers IPv4 and IPv6.
 */
function isPrivateOrLoopbackIP(ip: string): boolean {
  // IPv6 loopback
  if (ip === '::1' || ip === '::') return true
  // IPv4-mapped IPv6
  const v4part = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  const addr = v4part ? v4part[1] : ip
  if (isIP(addr) === 4) {
    const parts = addr.split('.').map(Number)
    // 127.0.0.0/8 — loopback
    if (parts[0] === 127) return true
    // 10.0.0.0/8 — private
    if (parts[0] === 10) return true
    // 172.16.0.0/12 — private
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    // 192.168.0.0/16 — private
    if (parts[0] === 192 && parts[1] === 168) return true
    // 169.254.0.0/16 — link-local (cloud metadata)
    if (parts[0] === 169 && parts[1] === 254) return true
    // 0.0.0.0/8 — reserved
    if (parts[0] === 0) return true
    // 100.64.0.0/10 — CGNAT (Tailscale)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true
  }
  if (isIP(ip) === 6) {
    // fc00::/7 — unique local
    const first = parseInt(ip.slice(0, 2), 16)
    if ((first & 0xfe) === 0xfc) return true
    // fe80::/10 — link-local
    if ((first & 0xff) === 0xfe) return true
  }
  return false
}

/**
 * Validate a redirect Location header against the SSRF policy.
 * Returns the resolved URL if safe, or null if the redirect should be
 * rejected.
 */
export function validateRedirect(
  location: string,
  baseUrl: string,
): { ok: boolean; reason?: string } {
  let resolved: URL
  try {
    resolved = new URL(location, baseUrl)
  } catch {
    return { ok: false, reason: 'invalid redirect URL' }
  }
  return validateWebhookUrl(resolved.toString())
}

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
  /** EVENT-02: max attempts per rolling minute (null = unlimited). */
  rate_limit_per_minute: number | null
}
export interface WebhookDeliveryRow {
  id: string
  workspace_id: string
  subscription_id: string
  change_event_id: string
  event_type: string
  payload: Record<string, unknown>
  body: string
  signature: string
  attempt: number
  status: string
  replay_of_delivery_id: string | null
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
 * Uses redirect: 'manual' and validates each redirect target against the
 * SSRF policy to prevent redirect-based SSRF attacks.
 * Returns the result including HTTP status and any error info.
 *
 * EVENT-02: pass the change_event id as `idempotencyKey`. It is sent as
 * `X-Sheetbase-Event-Id` (mirroring the payload event id) so receivers can
 * deduplicate across retries and replays. Retries and replays reuse the
 * same key; no downstream duplication for receivers that honor it.
 */
export async function attemptDelivery(
  url: string,
  body: string,
  signature: string,
  timeoutMs: number = DELIVERY_TIMEOUT_MS,
  maxRedirects: number = 3,
  idempotencyKey?: string,
): Promise<DeliveryResult> {
  // Validate the initial URL against the SSRF policy.
  const urlCheck = validateWebhookUrl(url)
  if (!urlCheck.ok) {
    return {
      success: false,
      errorCode: 'ssrf_blocked',
      errorMessage: `Webhook URL rejected: ${urlCheck.reason}`,
    }
  }

  let currentUrl = url
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await safeWebhookFetch(currentUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sheetbase-signature': signature,
          'x-sheetbase-event': 'change',
          ...(idempotencyKey ? { 'x-sheetbase-event-id': idempotencyKey } : {}),
          'user-agent': 'Sheetbase-Webhook/1.0',
        },
        body,
        signal: controller.signal,
        redirect: 'manual',
      })

      // Handle redirects (3xx) — validate each target.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          return {
            success: false,
            responseStatus: response.status,
            errorCode: 'redirect_error',
            errorMessage: 'Redirect response missing Location header',
          }
        }
        if (redirectCount >= maxRedirects) {
          return {
            success: false,
            responseStatus: response.status,
            errorCode: 'redirect_error',
            errorMessage: `Too many redirects (max ${maxRedirects})`,
          }
        }
        const redirectCheck = validateRedirect(location, currentUrl)
        if (!redirectCheck.ok) {
          return {
            success: false,
            responseStatus: response.status,
            errorCode: 'ssrf_blocked',
            errorMessage: `Redirect target rejected: ${redirectCheck.reason}`,
          }
        }
        const resolved = new URL(location, currentUrl).toString()
        currentUrl = resolved
        continue // Re-attempt with the new URL.
      }

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
        errorMessage:
          err instanceof Error ? err.message : 'Unknown delivery error',
      }
    } finally {
      clearTimeout(timer)
    }
  }
  // Should not reach here, but return a failure as a safety net.
  return {
    success: false,
    errorCode: 'redirect_error',
    errorMessage: 'Exceeded maximum redirects',
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
  eventCreatedAt?: string,
): Promise<WebhookSubscriptionRow[]> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const { rows } = await client.query<WebhookSubscriptionRow>(
      `SELECT id, workspace_id, key, url, event_types, max_retries,
              failure_threshold, status, rate_limit_per_minute
         FROM api.webhook_subscriptions
        WHERE workspace_id = $1 AND status = 'active'
          AND ($2::timestamptz IS NULL OR created_at <= $2)`,
      [workspaceId, eventCreatedAt ?? null],
    )
    return rows.filter((sub) => matchesFilter(eventType, sub.event_types))
  } finally {
    await client.end()
  }
}

/**
 * Fetch the signing secret for a subscription. The secret is stored as
 * AES-256-GCM ciphertext in internal.webhook_secrets using the sealed-secret
 * pattern (v1.<iv>.<tag>.<data>). If the stored value is not yet encrypted
 * (legacy plaintext), it is encrypted on first read and the row is updated.
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
    const stored = rows[0].ciphertext.toString('utf8')
    // If already encrypted (sealed envelope), decrypt and return.
    if (stored.startsWith('v1.')) {
      const key = webhookSecretKey()
      return openSecret(stored, key)
    }
    // Legacy plaintext — encrypt on first read and update the row.
    const key = webhookSecretKey()
    const sealed = sealSecret(stored, key)
    await client.query(
      `UPDATE internal.webhook_secrets
          SET ciphertext = $1, updated_at = now()
        WHERE subscription_id = $2 AND secret_name = 'signing_secret'`,
      [Buffer.from(sealed, 'utf8'), subscriptionId],
    )
    return stored
  } finally {
    await client.end()
  }
}

/** Derive the webhook-specific encryption key from the master secret. */
function webhookSecretKey(): Buffer {
  const master = process.env.BETTER_AUTH_SECRET
  if (!master || master.length === 0) {
    throw new Error('BETTER_AUTH_SECRET is not configured.')
  }
  return deriveWebhookSecretKey(master)
}

// ---------------------------------------------------------------------------
// Delivery record management.
// ---------------------------------------------------------------------------

/**
 * Create a pending delivery record for a subscription + change event.
 * Stores the exact signed body text for retry/replay byte-accuracy.
 * Returns the delivery row.
 */
export async function createDeliveryRecord(
  workspaceId: string,
  subscriptionId: string,
  changeEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
  body: string,
  signature: string,
  connectionString: string = env.DATABASE_URL,
): Promise<WebhookDeliveryRow | null> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const { rows } = await client.query<WebhookDeliveryRow>(
      `INSERT INTO api.webhook_deliveries
         (workspace_id, subscription_id, change_event_id, event_type,
          payload, body, signature, attempt, status, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'pending', now())
       ON CONFLICT (subscription_id, change_event_id)
         WHERE replay_of_delivery_id IS NULL
       DO NOTHING
       RETURNING *`,
      [
        workspaceId,
        subscriptionId,
        changeEventId,
        eventType,
        JSON.stringify(payload),
        body,
        signature,
      ],
    )
    // null when a delivery already exists for this (subscription, change_event)
    return rows.length > 0 ? rows[0] : null
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
  transaction?: Client,
): Promise<void> {
  const client = transaction ?? new Client({ connectionString })
  if (!transaction) await client.connect()
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
      // Determine if we should retry or dead-letter. EVENT-02: exhausted
      // backoff lands in the explicit dead_letter state (visible DLQ
      // surface with reason + payload reference); the retry sweep never
      // picks it up again — recovery is an explicit operator replay.
      const shouldRetry = attempt < maxRetries
      const status = shouldRetry ? 'retrying' : 'dead_letter'
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
    if (!transaction) await client.end()
  }
}

// ---------------------------------------------------------------------------
// Rate limiting — per-endpoint rolling-minute attempt budget.
// ---------------------------------------------------------------------------

/**
 * Count delivery attempts for a subscription in the trailing minute.
 * Every attempt touches `updated_at` (via record_webhook_delivery_result),
 * so the window approximates attempts, not rows. When `includeSelf` is
 * false the given delivery is excluded — fresh rows must not count
 * themselves, or a quiet endpoint's first delivery would always defer.
 */
export async function countRecentAttempts(
  subscriptionId: string,
  excludeDeliveryId: string | null,
  includeSelf: boolean,
  connectionString: string = env.DATABASE_URL,
): Promise<number> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM api.webhook_deliveries
        WHERE subscription_id = $1
          AND updated_at > now() - interval '1 minute'
          AND (attempt > 0 OR status = 'delivered')
          AND ($2 OR id <> $3)`,
      [subscriptionId, includeSelf, excludeDeliveryId],
    )
    return rows[0].n
  } finally {
    await client.end()
  }
}

// ---------------------------------------------------------------------------
// Full delivery flow for a single change event.
// ---------------------------------------------------------------------------

/**
 * Process a single change event notification: find matching subscriptions,
 * create delivery records. Only the transactional retry processor attempts HTTP.
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
  const eventType = mapEventType(
    eventRow.entityType,
    eventRow.operation,
    eventRow.payload,
  )
  if (!eventType) return // Not in the webhook surface.

  // Find matching subscriptions.
  const subscriptions = await findMatchingSubscriptions(
    eventRow.workspaceId,
    eventType,
    connectionString,
    eventRow.createdAt,
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

      // Create delivery record (idempotent — skips if one already exists).
      await createDeliveryRecord(
        sub.workspace_id,
        sub.id,
        eventRow.id,
        eventType,
        payloadJson,
        body,
        signature,
        connectionString,
      )
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
 * Uses FOR UPDATE SKIP LOCKED to prevent concurrent delivery by overlapping
 * timers or app replicas. Uses the stored body text for byte-accurate
 * signature verification.
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
    // Keep ownership through HTTP and settlement. A crashed worker rolls back,
    // releasing its locks for recovery. Receivers must still deduplicate when an
    // HTTP success precedes a lost connection/commit (at-least-once delivery).
    // Each transaction owns one row so unrelated deliveries can commit without
    // waiting for a whole batch's network requests.
    for (let selected = 0; selected < batchSize; selected++) {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `SELECT d.id, d.workspace_id, d.subscription_id, d.change_event_id,
              d.event_type, d.payload, d.body, d.signature, d.attempt,
              d.status, d.next_attempt_at,
              s.url, s.max_retries, s.failure_threshold, s.status AS sub_status,
              s.rate_limit_per_minute
         FROM api.webhook_deliveries d
         JOIN api.webhook_subscriptions s ON s.id = d.subscription_id
        WHERE d.status IN ('pending', 'retrying')
          AND d.next_attempt_at IS NOT NULL
          AND d.next_attempt_at <= now()
          AND s.status = 'active'
          ORDER BY d.next_attempt_at ASC
        LIMIT 1
        FOR UPDATE OF d, s SKIP LOCKED`,
      )
      const row = rows[0]
      if (!row) {
        await client.query('COMMIT')
        break
      }
      // EVENT-02: per-endpoint rate budget — defer over-budget retries
      // without attempting (the row's own last attempt counts, so a
      // just-failed delivery is not immediately re-attempted).
      if (row.rate_limit_per_minute) {
        const recent = await countRecentAttempts(
          row.subscription_id,
          row.id,
          row.status !== 'pending',
          connectionString,
        )
        if (recent >= row.rate_limit_per_minute) {
          await client.query(
            `UPDATE api.webhook_deliveries
                SET next_attempt_at = now() + interval '1 minute', updated_at = now()
              WHERE id = $1`,
            [row.id],
          )
          await client.query('COMMIT')
          continue
        }
      }
      // The result RPC increments attempt on failure; it is already the
      // number of failed attempts, not a zero-based retry index to increment.
      const attempt = row.attempt
      // Use the stored body text (byte-accurate with the original signature).
      // The idempotency key is the original change_event id.
      const result = await attemptDelivery(
        row.url,
        row.body,
        row.signature,
        DELIVERY_TIMEOUT_MS,
        3,
        row.change_event_id,
      )

      await recordDeliveryResult(
        row.workspace_id,
        row.id,
        result,
        attempt,
        row.max_retries,
        connectionString,
        client,
      )
      processed++
      await client.query('COMMIT')
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
  return processed
}

// ---------------------------------------------------------------------------
// LISTEN-based delivery engine.
// ---------------------------------------------------------------------------

/** Maximum events to process during a single catch-up sweep. */
const CATCHUP_BATCH_SIZE = 500
/** Delay before reconnecting the LISTEN client after an error. */
const RECONNECT_DELAY_MS = 5_000

/**
 * Reconcile all retained events since each subscription's creation. There is
 * no age cutoff: outages older than 24 hours use this same repair path. Events
 * before subscription creation are not historical subscriptions/backfills.
 * Pages advance even for unsupported operations or missing signing secrets;
 * those cannot starve later events and are reconsidered on the next sweep.
 */
export async function reconcileWebhookDeliveries(
  connectionString: string = env.DATABASE_URL,
): Promise<number> {
  const client = new Client({ connectionString })
  await client.connect()
  let processed = 0
  try {
    // Entity types that are in the webhook event surface.
    const entityTypes = [
      'record',
      'dataset',
      'dataset_version',
      'review_submission',
      'review_decision',
      'signature',
      'sheet_instance',
      'project',
      'sheet_definition',
      'sheet_definition_version',
      'notebook_template',
      'notebook_template_version',
    ]
    let afterSequence = '0'
    let afterId = '00000000-0000-0000-0000-000000000000'
    for (;;) {
      const { rows } = await client.query(
        `SELECT ce.id, ce.workspace_id, ce.sequence, ce.entity_type, ce.operation
         FROM api.change_events ce
        WHERE (ce.sequence, ce.id) > ($1::bigint, $3::uuid)
          AND ce.entity_type = ANY($2::text[])
          AND EXISTS (
            SELECT 1 FROM api.webhook_subscriptions s
             WHERE s.workspace_id = ce.workspace_id AND s.status = 'active'
               AND s.created_at <= ce.created_at
               AND NOT EXISTS (
                 SELECT 1 FROM api.webhook_deliveries wd
                  WHERE wd.change_event_id = ce.id AND wd.subscription_id = s.id
                    AND wd.replay_of_delivery_id IS NULL
               )
          )
        ORDER BY ce.sequence ASC, ce.id ASC
        LIMIT ${CATCHUP_BATCH_SIZE}`,
        [afterSequence, entityTypes, afterId],
      )
      if (rows.length === 0) break
      afterSequence = String(rows[rows.length - 1].sequence)
      afterId = rows[rows.length - 1].id

      for (const row of rows) {
        try {
          await processChangeEvent(
            {
              workspace_id: row.workspace_id,
              sequence: Number(row.sequence),
              id: row.id,
              entity_type: row.entity_type,
              operation: row.operation,
            },
            connectionString,
          )
          processed++
        } catch (err) {
          logger.error('webhook catch-up: error processing event', {
            eventId: row.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
    if (processed > 0) {
      logger.info('webhook startup catch-up processed', { count: processed })
    }
  } finally {
    await client.end()
  }
  return processed
}

/**
 * Start the webhook delivery engine. Opens a LISTEN connection on
 * `sheetbase_change` and processes events as they are emitted.
 *
 * After starting LISTEN, reconciles retained
 * change_events that were emitted while the engine was down (durable
 * consumption by sequence). The LISTEN notification is a wake-up; the
 * durable event row in `change_events` is the source of truth.
 *
 * Also starts a periodic retry processor for deliveries that failed and
 * are scheduled for retry. The LISTEN client reconnects automatically on
 * connection errors.
 *
 * Returns a stop function that cleanly shuts down both the listener and
 * the retry timer.
 */
const WEBHOOK_ENGINE_STOP = Symbol.for('sheetbase.webhook-delivery.stop')
type WebhookEngineGlobal = typeof globalThis & {
  [WEBHOOK_ENGINE_STOP]?: () => Promise<void>
}

export function startWebhookDeliveryEngine(
  connectionString: string = env.DATABASE_URL,
  retryIntervalMs: number = 60_000,
): () => Promise<void> {
  const registry = globalThis as WebhookEngineGlobal
  const running = registry[WEBHOOK_ENGINE_STOP]
  if (running) return running

  let listenClient: Client | null = null
  let retryTimer: ReturnType<typeof setInterval> | null = null
  let stopped = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let draining: Promise<void> | null = null
  let notifications = 0

  async function drainPending(): Promise<void> {
    let observed: number
    do {
      observed = notifications
      await reconcileWebhookDeliveries(connectionString)
      while (!stopped && (await processRetries(connectionString)) > 0) {
        // Drain all due batches, not just the first 50 rows.
      }
    } while (!stopped && observed !== notifications)
  }

  function drain(): Promise<void> {
    if (stopped) return Promise.resolve()
    if (draining) return draining
    draining = drainPending().finally(() => {
      draining = null
    })
    return draining
  }

  async function handleNotification(msg: { payload?: string }) {
    if (!msg.payload || stopped) return
    try {
      // Notifications only wake the durable reconciliation path.
      notifications++
      await drain()
    } catch (err) {
      logger.error('webhook listen: error processing notification', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function connectListener(): Promise<void> {
    if (stopped) return
    listenClient = new Client({ connectionString })
    listenClient.on('notification', handleNotification)
    listenClient.on('error', (err) => {
      if (stopped) return
      logger.error('webhook LISTEN connection error', {
        error: err instanceof Error ? err.message : String(err),
      })
      // Reconnect after a delay.
      scheduleReconnect()
    })
    listenClient.on('end', () => {
      if (stopped) return
      logger.warn('webhook LISTEN connection ended, reconnecting')
      scheduleReconnect()
    })
    await listenClient.connect()
    await listenClient.query('LISTEN sheetbase_change')
    logger.info('webhook LISTEN connected')
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null
      if (stopped) return
      try {
        // Clean up the old client.
        if (listenClient) {
          try {
            await listenClient.end()
          } catch {
            /* best effort */
          }
          listenClient = null
        }
        // LISTEN first, then repair the whole disconnected interval.
        await connectListener()
        await drain()
      } catch (err) {
        logger.error('webhook reconnect failed', {
          error: err instanceof Error ? err.message : String(err),
        })
        scheduleReconnect()
      }
    }, RECONNECT_DELAY_MS)
  }

  async function start() {
    // Start LISTEN.
    try {
      await connectListener()
      await drain()
    } catch (err) {
      logger.error('webhook LISTEN initial connect failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      scheduleReconnect()
    }

    if (stopped) return
    // Periodic reconciliation and retry processor.
    retryTimer = setInterval(async () => {
      if (stopped) return
      try {
        await drain()
      } catch (err) {
        logger.error('webhook retry processor error', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }, retryIntervalMs)

    logger.info('webhook delivery engine started')
  }

  const stop = async () => {
    stopped = true
    if (retryTimer) clearInterval(retryTimer)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    await started.catch(() => {})
    await draining?.catch(() => {})
    if (listenClient) {
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
    }
    if (registry[WEBHOOK_ENGINE_STOP] === stop) {
      delete registry[WEBHOOK_ENGINE_STOP]
    }
    logger.info('webhook delivery engine stopped')
  }
  // Register synchronously before startup begins. Request middleware can call
  // this function again while the first asynchronous connection is opening.
  registry[WEBHOOK_ENGINE_STOP] = stop
  const started = start()

  return stop
}
