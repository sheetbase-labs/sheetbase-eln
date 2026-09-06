/**
 * ADMIN-02 — Webhook operations admin plane.
 *
 * Server functions behind the `/admin` webhooks section and the
 * external-access overview. Every function requires `integrations.manage`
 * through the canonical `api.has_capability` check (fail-closed, same gate
 * as the section definition); the underlying `api.*_webhook_*` RPCs enforce
 * the same capability server-side, so the UI gate never substitutes
 * enforcement. Signing secrets are never returned except once on rotation.
 *
 * No new tracking tables: subscription lifecycle comes from
 * `api.webhook_subscriptions`, health from EVENT-02's
 * `api.get_webhook_endpoint_health`, and history from EVENT-02's
 * `api.list_webhook_deliveries`.
 */
import { createServerFn } from '@tanstack/react-start'

import { requireCapability } from '#/lib/admin-platform'

export type WebhookSubscriptionStatus =
  'active' | 'paused' | 'disabled' | 'archived'

export type WebhookDeliveryStatus =
  'pending' | 'delivered' | 'failed' | 'retrying' | 'dead_letter'

export interface WebhookSubscriptionWire {
  id: string
  key: string
  url: string
  description: string | null
  eventTypes: string[]
  status: WebhookSubscriptionStatus
  maxRetries: number
  failureThreshold: number
  consecutiveFailures: number
  rateLimitPerMinute: number | null
  createdAt: string
  updatedAt: string
}

export interface WebhookLastErrorWire {
  code: string | null
  message: string | null
  at: string | null
  deliveryId: string | null
}

export interface WebhookEndpointHealthWire {
  subscriptionId: string
  key: string
  url: string
  status: WebhookSubscriptionStatus
  consecutiveFailures: number
  failureThreshold: number
  maxRetries: number
  rateLimitPerMinute: number | null
  total24h: number
  delivered24h: number
  failed24h: number
  deadLetter24h: number
  retrying24h: number
  pending24h: number
  successRate24h: number | null
  lastDeliveredAt: string | null
  oldestPendingAt: string | null
  lastError: WebhookLastErrorWire | null
}

export interface WebhookDeliveryWire {
  id: string
  subscriptionId: string
  changeEventId: string
  eventType: string
  attempt: number
  status: WebhookDeliveryStatus
  responseStatus: number | null
  responseBody: string | null
  errorCode: string | null
  errorMessage: string | null
  replayOfDeliveryId: string | null
  nextAttemptAt: string | null
  deliveredAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WebhookDeliveryListWire {
  data: WebhookDeliveryWire[]
  total: number
  limit: number
  offset: number
}

export interface WebhookHealthResultWire {
  data: WebhookEndpointHealthWire[]
  generatedAt: string
}

export interface RotatedWebhookSecretWire {
  subscriptionId: string
  signingSecret: string
}

export interface WebhookBulkReplayWire {
  replayedCount: number
  deliveryIds: string[]
}

export const webhookAdminKeys = {
  subscriptions: (workspaceId: string) =>
    ['admin-001', 'webhook-subscriptions', workspaceId] as const,
  health: (workspaceId: string, subscriptionId?: string) =>
    [
      'admin-001',
      'webhook-health',
      workspaceId,
      subscriptionId ?? 'all',
    ] as const,
  deliveries: (
    workspaceId: string,
    filters: Record<string, string | undefined>,
  ) => ['admin-001', 'webhook-deliveries', workspaceId, filters] as const,
}

function num(value: unknown): number {
  return Number(value ?? 0)
}

function str(value: unknown): string | null {
  return value != null ? String(value) : null
}

export function toSubscriptionWire(
  row: Record<string, unknown>,
): WebhookSubscriptionWire {
  const rawEventTypes = row.event_types
  return {
    id: String(row.id),
    key: String(row.key),
    url: String(row.url),
    description: str(row.description),
    eventTypes: Array.isArray(rawEventTypes) ? rawEventTypes.map(String) : [],
    status: String(row.status) as WebhookSubscriptionStatus,
    maxRetries: num(row.max_retries),
    failureThreshold: num(row.failure_threshold),
    consecutiveFailures: num(row.consecutive_failures),
    rateLimitPerMinute:
      row.rate_limit_per_minute != null ? num(row.rate_limit_per_minute) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export function toHealthWire(
  row: Record<string, unknown>,
): WebhookEndpointHealthWire {
  const rawError = row.last_error as Record<string, unknown> | null
  return {
    subscriptionId: String(row.subscription_id),
    key: String(row.key),
    url: String(row.url),
    status: String(row.status) as WebhookSubscriptionStatus,
    consecutiveFailures: num(row.consecutive_failures),
    failureThreshold: num(row.failure_threshold),
    maxRetries: num(row.max_retries),
    rateLimitPerMinute:
      row.rate_limit_per_minute != null ? num(row.rate_limit_per_minute) : null,
    total24h: num(row.total_24h),
    delivered24h: num(row.delivered_24h),
    failed24h: num(row.failed_24h),
    deadLetter24h: num(row.dead_letter_24h),
    retrying24h: num(row.retrying_24h),
    pending24h: num(row.pending_24h),
    successRate24h:
      row.success_rate_24h != null ? Number(row.success_rate_24h) : null,
    lastDeliveredAt: str(row.last_delivered_at),
    oldestPendingAt: str(row.oldest_pending_at),
    lastError: rawError
      ? {
          code: str(rawError.code),
          message: str(rawError.message),
          at: str(rawError.at),
          deliveryId: str(rawError.delivery_id),
        }
      : null,
  }
}

export function toDeliveryWire(
  row: Record<string, unknown>,
): WebhookDeliveryWire {
  return {
    id: String(row.id),
    subscriptionId: String(row.subscription_id),
    changeEventId: String(row.change_event_id),
    eventType: String(row.event_type),
    attempt: num(row.attempt),
    status: String(row.status) as WebhookDeliveryStatus,
    responseStatus:
      row.response_status != null ? num(row.response_status) : null,
    responseBody: str(row.response_body),
    errorCode: str(row.error_code),
    errorMessage: str(row.error_message),
    replayOfDeliveryId: str(row.replay_of_delivery_id),
    nextAttemptAt: str(row.next_attempt_at),
    deliveredAt: str(row.delivered_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/** Map webhook admin failures to operator-actionable messages. */
export function describeWebhookAdminError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '')
  if (message.startsWith('permission_denied')) {
    return 'You do not have permission to manage webhooks (integrations.manage required).'
  }
  if (message.includes('SB036')) {
    return 'The webhook subscription or delivery was not found.'
  }
  if (message.includes('SB034')) {
    return `Invalid webhook request: ${message}`
  }
  if (message.includes('SB033')) {
    return 'This action belongs to a different workspace.'
  }
  if (
    /42501|permission denied|not allowed|required for this operation/i.test(
      message,
    )
  ) {
    return 'You do not have permission to manage webhooks (integrations.manage required).'
  }
  return message || 'Could not complete the webhook operation. Try again.'
}

// ---------------------------------------------------------------------------
// listWebhookSubscriptionsFn — subscription registry (no secrets)
// ---------------------------------------------------------------------------

export const listWebhookSubscriptionsFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<WebhookSubscriptionWire[]> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )
    try {
      // RLS restricts rows to workspace members; the section gate plus the
      // requireCapability check above restrict callers to integration
      // managers. Secrets live in internal.webhook_secrets (invisible here).
      const { rows } = await session.client.query(
        `SELECT id, key, url, description, event_types, status,
                max_retries, failure_threshold, consecutive_failures,
                rate_limit_per_minute,
                created_at::text AS created_at, updated_at::text AS updated_at
           FROM api.webhook_subscriptions
          WHERE workspace_id = $1::uuid
          ORDER BY key ASC`,
        [data.workspaceId],
      )
      return rows.map((row: Record<string, unknown>) => toSubscriptionWire(row))
    } finally {
      await session.release()
    }
  })

// ---------------------------------------------------------------------------
// fetchWebhookHealthFn — EVENT-02 endpoint health (24h window, last error,
// consecutive failures / auto-disable state, retry debt, rate limit)
// ---------------------------------------------------------------------------

export const fetchWebhookHealthFn = createServerFn({ method: 'POST' })
  .validator(
    (input: { workspaceId: string; subscriptionId?: string | null }) => input,
  )
  .handler(async ({ data }): Promise<WebhookHealthResultWire> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )
    try {
      const { rows } = await session.client.query(
        `SELECT api.get_webhook_endpoint_health($1::uuid, $2::uuid) AS result`,
        [data.workspaceId, data.subscriptionId ?? null],
      )
      const result = (rows[0]?.result ?? {}) as {
        data?: Array<Record<string, unknown>>
        generated_at?: unknown
      }
      return {
        data: (result.data ?? []).map(toHealthWire),
        generatedAt: String(result.generated_at ?? ''),
      }
    } finally {
      await session.release()
    }
  })

// ---------------------------------------------------------------------------
// setWebhookSubscriptionStatusFn — enable (active) / disable / pause through
// the canonical update RPC. Re-enabling resets consecutive_failures.
// ---------------------------------------------------------------------------

export const setWebhookSubscriptionStatusFn = createServerFn({
  method: 'POST',
})
  .validator(
    (input: {
      workspaceId: string
      subscriptionId: string
      status: 'active' | 'paused' | 'disabled'
    }) => input,
  )
  .handler(async ({ data }): Promise<WebhookSubscriptionWire> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )
    try {
      const { rows } = await session.client.query(
        `SELECT * FROM api.update_webhook_subscription(
           $1::uuid, $2::uuid, NULL, NULL, NULL, $3, NULL, NULL, NULL
         )`,
        [data.workspaceId, data.subscriptionId, data.status],
      )
      const row = rows[0] as Record<string, unknown> | undefined
      if (!row?.id) {
        throw new Error('Webhook subscription not found or update failed.')
      }
      return toSubscriptionWire({
        ...row,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
      })
    } finally {
      await session.release()
    }
  })

// ---------------------------------------------------------------------------
// archiveWebhookSubscriptionFn — soft-archive through the canonical RPC
// ---------------------------------------------------------------------------

export const archiveWebhookSubscriptionFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; subscriptionId: string }) => input)
  .handler(async ({ data }): Promise<WebhookSubscriptionWire> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )
    try {
      const { rows } = await session.client.query(
        `SELECT * FROM api.delete_webhook_subscription($1::uuid, $2::uuid)`,
        [data.workspaceId, data.subscriptionId],
      )
      const row = rows[0] as Record<string, unknown> | undefined
      if (!row?.id) {
        throw new Error('Webhook subscription not found or archive failed.')
      }
      return toSubscriptionWire({
        ...row,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
      })
    } finally {
      await session.release()
    }
  })

// ---------------------------------------------------------------------------
// rotateWebhookSecretFn — new signing secret, returned exactly once
// ---------------------------------------------------------------------------

export const rotateWebhookSecretFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; subscriptionId: string }) => input)
  .handler(async ({ data }): Promise<RotatedWebhookSecretWire> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )
    try {
      const { rows } = await session.client.query(
        `SELECT api.rotate_webhook_secret($1::uuid, $2::uuid, NULL) AS result`,
        [data.workspaceId, data.subscriptionId],
      )
      const result = (rows[0]?.result ?? {}) as Record<string, unknown>
      if (!result.signing_secret) {
        throw new Error('Webhook secret rotation failed.')
      }
      return {
        subscriptionId: String(result.subscriptionId ?? data.subscriptionId),
        signingSecret: String(result.signing_secret),
      }
    } finally {
      await session.release()
    }
  })

// ---------------------------------------------------------------------------
// listWebhookDeliveriesFn — EVENT-02 delivery history with subscription,
// status (including dead_letter), event-type and time-window filters
// ---------------------------------------------------------------------------

export const listWebhookDeliveriesFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      workspaceId: string
      subscriptionId?: string | null
      status?: WebhookDeliveryStatus | null
      eventType?: string | null
      since?: string | null
      until?: string | null
      limit?: number | null
      offset?: number | null
    }) => input,
  )
  .handler(async ({ data }): Promise<WebhookDeliveryListWire> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )
    try {
      const { rows } = await session.client.query(
        `SELECT api.list_webhook_deliveries(
           $1::uuid, $2::uuid, $3::int, $4::int, $5, $6, $7::timestamptz, $8::timestamptz
         ) AS result`,
        [
          data.workspaceId,
          data.subscriptionId ?? null,
          data.limit ?? 50,
          data.offset ?? 0,
          data.status ?? null,
          data.eventType?.trim() ? data.eventType.trim() : null,
          data.since?.trim() ? data.since.trim() : null,
          data.until?.trim() ? data.until.trim() : null,
        ],
      )
      const result = (rows[0]?.result ?? {}) as {
        data?: Array<Record<string, unknown>>
        total?: unknown
        limit?: unknown
        offset?: unknown
      }
      return {
        data: (result.data ?? []).map(toDeliveryWire),
        total: num(result.total),
        limit: num(result.limit),
        offset: num(result.offset),
      }
    } finally {
      await session.release()
    }
  })

// ---------------------------------------------------------------------------
// replayWebhookDeliveryFn — single terminal delivery replay (EVENT-02 RPC)
// ---------------------------------------------------------------------------

export const replayWebhookDeliveryFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; deliveryId: string }) => input)
  .handler(async ({ data }): Promise<WebhookDeliveryWire> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )
    try {
      const { rows } = await session.client.query(
        `SELECT * FROM api.replay_webhook_delivery($1::uuid, $2::uuid)`,
        [data.workspaceId, data.deliveryId],
      )
      const row = rows[0] as Record<string, unknown> | undefined
      if (!row?.id) {
        throw new Error('Webhook delivery replay failed.')
      }
      return toDeliveryWire(row)
    } finally {
      await session.release()
    }
  })

// ---------------------------------------------------------------------------
// replayWebhookDeliveriesFn — windowed bulk replay (EVENT-02 RPC, safe to
// re-run: originals with a queued replay are skipped, one audit event)
// ---------------------------------------------------------------------------

export const replayWebhookDeliveriesFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      workspaceId: string
      subscriptionId?: string | null
      since?: string | null
      until?: string | null
      status?: 'dead_letter' | 'failed' | 'delivered' | null
      limit?: number | null
    }) => input,
  )
  .handler(async ({ data }): Promise<WebhookBulkReplayWire> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )
    try {
      const { rows } = await session.client.query(
        `SELECT api.replay_webhook_deliveries(
           $1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, $5, $6::int
         ) AS result`,
        [
          data.workspaceId,
          data.subscriptionId ?? null,
          data.since?.trim() ? data.since.trim() : null,
          data.until?.trim() ? data.until.trim() : null,
          data.status ?? 'dead_letter',
          data.limit ?? 50,
        ],
      )
      const result = (rows[0]?.result ?? {}) as Record<string, unknown>
      const rawIds = result.delivery_ids
      return {
        replayedCount: num(result.replayed_count),
        deliveryIds: Array.isArray(rawIds) ? rawIds.map(String) : [],
      }
    } finally {
      await session.release()
    }
  })
