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
import { z } from 'zod'

import { requireCapability } from '#/lib/admin-platform'

const subscriptionStatusSchema = z.enum([
  'active',
  'paused',
  'disabled',
  'archived',
])

const deliveryStatusSchema = z.enum([
  'pending',
  'delivered',
  'failed',
  'retrying',
  'dead_letter',
])

const channelTypeSchema = z.enum(['webhook', 'teams', 'email'])

export type WebhookSubscriptionStatus = z.infer<typeof subscriptionStatusSchema>

export type WebhookDeliveryStatus = z.infer<typeof deliveryStatusSchema>

export type WebhookChannelType = z.infer<typeof channelTypeSchema>

// SQL contracts: 0000_baseline.sql webhook tables and EVENT-02 RPCs.
// Do not coerce here: native PG Dates must reach the existing String mapping.
const numericSchema = z.union([
  z.number(),
  z
    .string()
    .refine((value) => value.trim() !== '' && Number.isFinite(Number(value))),
])

const timestampSchema = z.union([z.string(), z.date()]).nullish()
const nullableTextSchema = z.string().nullish()

const subscriptionRowSchema = z.object({
  id: z.string(),
  key: z.string(),
  url: nullableTextSchema,
  channel_type: channelTypeSchema.nullish(),
  recipient_user_id: nullableTextSchema,
  recipient_name: nullableTextSchema,
  description: nullableTextSchema,
  // The column is JSONB without an array CHECK; retain the mapper's fallback.
  event_types: z.json().nullish(),
  status: subscriptionStatusSchema,
  max_retries: numericSchema,
  failure_threshold: numericSchema,
  consecutive_failures: numericSchema,
  rate_limit_per_minute: numericSchema.nullish(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
})

const healthRowSchema = z.object({
  subscription_id: z.string(),
  key: z.string(),
  url: nullableTextSchema,
  status: subscriptionStatusSchema,
  consecutive_failures: numericSchema,
  failure_threshold: numericSchema,
  max_retries: numericSchema,
  rate_limit_per_minute: numericSchema.nullish(),
  total_24h: numericSchema,
  delivered_24h: numericSchema,
  failed_24h: numericSchema,
  dead_letter_24h: numericSchema,
  retrying_24h: numericSchema,
  pending_24h: numericSchema,
  success_rate_24h: numericSchema.nullish(),
  last_delivered_at: timestampSchema,
  oldest_pending_at: timestampSchema,
  last_error: z
    .object({
      code: nullableTextSchema,
      message: nullableTextSchema,
      at: timestampSchema,
      delivery_id: nullableTextSchema,
    })
    .nullish(),
})

const deliveryRowSchema = z.object({
  id: z.string(),
  subscription_id: z.string(),
  change_event_id: z.string(),
  event_type: z.string(),
  attempt: numericSchema,
  status: deliveryStatusSchema,
  response_status: numericSchema.nullish(),
  response_body: nullableTextSchema,
  error_code: nullableTextSchema,
  error_message: nullableTextSchema,
  replay_of_delivery_id: nullableTextSchema,
  next_attempt_at: timestampSchema,
  delivered_at: timestampSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
})

const recipientRowSchema = z.object({
  user_id: z.string(),
  name: nullableTextSchema,
  email: nullableTextSchema,
})

const incomingRowSchema = z.object({
  id: z.string(),
  display_id: nullableTextSchema,
  name: z.string(),
  enabled: z.boolean(),
  last_call_at: timestampSchema,
})

const recordRowSchema = z.object({
  event_id: z.string(),
  identifier: z.string(),
})

const healthResultSchema = z.object({
  data: z.array(healthRowSchema).nullish(),
  generated_at: timestampSchema,
})

const deliveryListResultSchema = z.object({
  data: z.array(deliveryRowSchema).nullish(),
  total: numericSchema.nullish(),
  limit: numericSchema.nullish(),
  offset: numericSchema.nullish(),
})

const subscriptionMutationRowSchema = subscriptionRowSchema
  .partial()
  .extend({ id: nullableTextSchema })
  .nullish()

const createResultSchema = z.object({
  subscription: subscriptionMutationRowSchema,
  signing_secret: nullableTextSchema,
})

const rotateResultSchema = z.object({
  subscriptionId: nullableTextSchema,
  signing_secret: nullableTextSchema,
})

const replayResultSchema = z.object({
  replayed_count: numericSchema.nullish(),
  delivery_ids: z.array(z.string()).nullish(),
})

export interface WebhookSubscriptionWire {
  id: string
  key: string
  /** Empty for an email destination, which names a person instead. */
  url: string
  channelType: WebhookChannelType
  recipientUserId: string | null
  recipientName: string | null
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

function num(value: z.infer<typeof numericSchema> | null | undefined): number {
  return Number(value ?? 0)
}

function str(value: string | Date | null | undefined): string | null {
  return value != null ? String(value) : null
}

export function toSubscriptionWire(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public PG/JSON boundary, decoded immediately below.
  input: unknown,
): WebhookSubscriptionWire {
  const row = subscriptionRowSchema.parse(input)
  const rawEventTypes = row.event_types

  return {
    id: String(row.id),
    key: String(row.key),
    url: row.url != null ? String(row.url) : '',
    channelType: row.channel_type ?? 'webhook',
    recipientUserId: str(row.recipient_user_id),
    recipientName: str(row.recipient_name),
    description: str(row.description),
    eventTypes: Array.isArray(rawEventTypes) ? rawEventTypes.map(String) : [],
    status: row.status,
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public PG/JSON boundary, decoded immediately below.
  input: unknown,
): WebhookEndpointHealthWire {
  const row = healthRowSchema.parse(input)
  const rawError = row.last_error

  return {
    subscriptionId: String(row.subscription_id),
    key: String(row.key),
    url: row.url != null ? String(row.url) : '',
    status: row.status,
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public PG/JSON boundary, decoded immediately below.
  input: unknown,
): WebhookDeliveryWire {
  const row = deliveryRowSchema.parse(input)

  return {
    id: String(row.id),
    subscriptionId: String(row.subscription_id),
    changeEventId: String(row.change_event_id),
    eventType: String(row.event_type),
    attempt: num(row.attempt),
    status: row.status,
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
  const message =
    cause instanceof Error
      ? cause.message
      : z.coerce.string().parse(cause ?? '')

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

/** Names for the people email destinations send to. `internal.user` is not
 * readable by the signed-in role, so this uses the app connection, and only
 * for members of this workspace. */
async function recipientNames(
  workspaceId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>()

  if (userIds.length === 0) return names

  const [{ db }, { sql }] = await Promise.all([
    import('#/db/client.server'),
    import('drizzle-orm'),
  ])

  const result = await db.execute(sql`
    SELECT m.user_id, u.name, u.email
      FROM api.workspace_memberships m
      JOIN internal."user" u ON u.id = m.user_id
     WHERE m.workspace_id = ${workspaceId}::uuid
       AND m.user_id = ANY(${userIds}::text[])
  `)

  for (const row of z.array(recipientRowSchema).parse(result.rows)) {
    names.set(String(row.user_id), String(row.name || row.email || ''))
  }

  return names
}

export interface WebhookRecipientWire {
  userId: string
  name: string
  email: string
}

export const webhookRecipientKeys = {
  list: (workspaceId: string) =>
    ['admin-001', 'webhook-recipients', workspaceId] as const,
}

/** The people an email destination can send to: current workspace members. */
export const listWebhookRecipientsFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<WebhookRecipientWire[]> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )

    try {
      const [{ db }, { sql }] = await Promise.all([
        import('#/db/client.server'),
        import('drizzle-orm'),
      ])

      const result = await db.execute(sql`
        SELECT m.user_id, u.name, u.email
          FROM api.workspace_memberships m
          JOIN internal."user" u ON u.id = m.user_id
         WHERE m.workspace_id = ${data.workspaceId}::uuid
           AND m.suspended_at IS NULL
         ORDER BY lower(coalesce(nullif(u.name, ''), u.email))
      `)

      return z
        .array(recipientRowSchema)
        .parse(result.rows)
        .map((row) => ({
          userId: String(row.user_id),
          name: String(row.name ?? ''),
          email: String(row.email ?? ''),
        }))
    } finally {
      await session.release()
    }
  })

export const listWebhookSubscriptionsFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<WebhookSubscriptionWire[]> => {
    const session = await requireCapability(
      data.workspaceId,
      'settings.integrations.view',
    )

    try {
      // RLS restricts rows to workspace members; the section gate plus the
      // requireCapability check above restrict callers to integration
      // managers. Secrets live in internal.webhook_secrets (invisible here).
      const { rows } = await session.client.query(
        `SELECT id, key, url, description, event_types, status,
                max_retries, failure_threshold, consecutive_failures,
                rate_limit_per_minute, channel_type, recipient_user_id,
                created_at::text AS created_at, updated_at::text AS updated_at
           FROM api.webhook_subscriptions
          WHERE workspace_id = $1::uuid
          ORDER BY key ASC`,
        [data.workspaceId],
      )

      const subscriptions = z.array(subscriptionRowSchema).parse(rows)

      const names = await recipientNames(
        data.workspaceId,
        subscriptions.flatMap((row) =>
          row.recipient_user_id != null ? [row.recipient_user_id] : [],
        ),
      )

      return subscriptions.map((row) =>
        toSubscriptionWire({
          ...row,
          recipient_name: names.get(String(row.recipient_user_id)) ?? null,
        }),
      )
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
      'settings.integrations.view',
    )

    try {
      const { rows } = await session.client.query(
        `SELECT api.get_webhook_endpoint_health($1::uuid, $2::uuid) AS result`,
        [data.workspaceId, data.subscriptionId ?? null],
      )

      const envelope = z
        .array(z.object({ result: healthResultSchema.nullish() }))
        .parse(rows)

      const result = healthResultSchema.parse(envelope[0]?.result ?? {})

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
      const { rows } = await session.client.query<
        z.infer<typeof subscriptionRowSchema>
      >(
        `SELECT * FROM api.update_webhook_subscription(
           $1::uuid, $2::uuid, NULL, NULL, NULL, $3, NULL, NULL, NULL
         )`,
        [data.workspaceId, data.subscriptionId, data.status],
      )

      const row = rows.at(0)

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
      const { rows } = await session.client.query<
        z.infer<typeof subscriptionRowSchema>
      >(`SELECT * FROM api.delete_webhook_subscription($1::uuid, $2::uuid)`, [
        data.workspaceId,
        data.subscriptionId,
      ])

      const row = rows.at(0)

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
// createWebhookSubscriptionFn — a new outgoing endpoint; the signing secret
// comes back once, here, and is never readable again
// ---------------------------------------------------------------------------

export interface CreatedWebhookWire {
  subscription: WebhookSubscriptionWire
  signingSecret: string | null
}

/** A key the database accepts, made from what the person called the webhook. */
export function webhookKeyFor(name: string, salt: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 36)
    .replace(/-+$/g, '')

  return `${slug || 'webhook'}-${salt}`.slice(0, 49)
}

export const createWebhookSubscriptionFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      workspaceId: string
      name: string
      /** Ignored for an email destination. */
      url: string
      eventTypes: string[]
      channelType?: WebhookChannelType
      recipientUserId?: string | null
    }) => input,
  )
  .handler(async ({ data }): Promise<CreatedWebhookWire> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )

    try {
      const salt = Math.random().toString(36).slice(2, 8)
      const channelType = data.channelType ?? 'webhook'

      const { rows } = await session.client.query(
        `SELECT api.create_webhook_subscription(
           $1::uuid, $2, $3, $4::jsonb, $5,
           5, 10, NULL, NULL, $6, $7
         ) AS result`,
        [
          data.workspaceId,
          webhookKeyFor(data.name, salt),
          channelType === 'email' ? null : data.url.trim(),
          JSON.stringify(data.eventTypes),
          data.name.trim() || null,
          channelType,
          channelType === 'email' ? (data.recipientUserId ?? null) : null,
        ],
      )

      const envelope = z
        .array(z.object({ result: createResultSchema.nullish() }))
        .parse(rows)

      const result = createResultSchema.parse(envelope[0]?.result ?? {})
      const subscription = result.subscription

      if (!subscription?.id) throw new Error('The webhook was not created.')

      return {
        subscription: toSubscriptionWire(subscription),
        signingSecret: result.signing_secret
          ? String(result.signing_secret)
          : null,
      }
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

      const envelope = z
        .array(z.object({ result: rotateResultSchema.nullish() }))
        .parse(rows)

      const result = rotateResultSchema.parse(envelope[0]?.result ?? {})

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
      'settings.integrations.view',
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

      const envelope = z
        .array(z.object({ result: deliveryListResultSchema.nullish() }))
        .parse(rows)

      const result = deliveryListResultSchema.parse(envelope[0]?.result ?? {})

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
      const { rows } = await session.client.query<
        z.infer<typeof deliveryRowSchema>
      >(`SELECT * FROM api.replay_webhook_delivery($1::uuid, $2::uuid)`, [
        data.workspaceId,
        data.deliveryId,
      ])

      const row = rows.at(0)

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

      const envelope = z
        .array(z.object({ result: replayResultSchema.nullish() }))
        .parse(rows)

      const result = replayResultSchema.parse(envelope[0]?.result ?? {})
      const rawIds = result.delivery_ids

      return {
        replayedCount: num(result.replayed_count),
        deliveryIds: rawIds ?? [],
      }
    } finally {
      await session.release()
    }
  })

// ---------------------------------------------------------------------------
// fetchWebhookDeliveryRecordsFn — the record each delivery was about, by the
// identifier people read (EXP-0141), so the deliveries table names records
// rather than change-event ids.
// ---------------------------------------------------------------------------

export const fetchWebhookDeliveryRecordsFn = createServerFn({ method: 'POST' })
  .validator(
    (input: { workspaceId: string; changeEventIds: string[] }) => input,
  )
  .handler(async ({ data }): Promise<Record<string, string>> => {
    if (data.changeEventIds.length === 0) return {}

    const session = await requireCapability(
      data.workspaceId,
      'settings.integrations.view',
    )

    try {
      const { rows } = await session.client.query(
        `SELECT e.id::text AS event_id, r.identifier
           FROM api.change_events e
           JOIN api.records r ON r.id = e.record_id
          WHERE e.workspace_id = $1::uuid AND e.id = ANY($2::uuid[])`,
        [data.workspaceId, data.changeEventIds.slice(0, 200)],
      )

      return Object.fromEntries(
        z
          .array(recordRowSchema)
          .parse(rows)
          .map((row) => [String(row.event_id), String(row.identifier)]),
      )
    } finally {
      await session.release()
    }
  })

// ---------------------------------------------------------------------------
// listIncomingWebhooksFn — pipelines that start from an incoming webhook, for
// the read-only list under Integrations. They are set up on the pipeline's
// Triggers tab; no secret leaves the server.
// ---------------------------------------------------------------------------

export interface IncomingWebhookWire {
  pipelineId: string
  displayId: string | null
  name: string
  enabled: boolean
  lastCallAt: string | null
}

export const listIncomingWebhooksFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<IncomingWebhookWire[]> => {
    const session = await requireCapability(
      data.workspaceId,
      'settings.integrations.view',
    )

    await session.release()

    const [{ db }, { sql }] = await Promise.all([
      import('#/db/client.server'),
      import('drizzle-orm'),
    ])

    const result = await db.execute(sql`
      SELECT d.id, d.display_id, d.name, t.enabled,
             (SELECT max(r.created_at)::text
                FROM api.pipeline_runs r
                JOIN api.pipeline_definition_versions v ON v.id = r.definition_version_id
               WHERE v.definition_id = d.id
                 AND r.trigger_occurrence_id LIKE 'webhook:' || d.id::text || ':%') AS last_call_at
        FROM internal.pipeline_webhook_triggers t
        JOIN api.pipeline_definitions d ON d.id = t.definition_id
       WHERE t.workspace_id = ${data.workspaceId}::uuid
       ORDER BY d.name ASC
    `)

    return z
      .array(incomingRowSchema)
      .parse(result.rows)
      .map((row) => ({
        pipelineId: String(row.id),
        displayId: str(row.display_id),
        name: String(row.name),
        enabled: Boolean(row.enabled),
        lastCallAt: str(row.last_call_at),
      }))
  })
