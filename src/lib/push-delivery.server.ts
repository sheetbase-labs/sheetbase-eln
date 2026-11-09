/**
 * Phone alerts: the worker behind Web Push.
 *
 * Every tick it makes sure the server key exists, writes the booking reminders
 * that have come due, sends what the outbox holds (internal.push_deliveries,
 * filled by a trigger on notifications) and sweeps old outcomes. Same start
 * pattern as the other schedulers: an unref'd interval, never started under
 * test runners unless explicitly enabled.
 */
import type { QueryResultRow } from 'pg'

import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from './logger'
import {
  generateVapidKeys,
  isValidDeviceKey,
  sendWebPush,
} from './web-push.server'
import type { PushMessage, PushOutcome, VapidKeys } from './web-push.server'

/** A timer should reach a locked phone within seconds, so poll briskly. */
export const PUSH_INTERVAL_MS = 15_000

export interface PushConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
  end: () => Promise<void>
}

export interface PushDeps {
  connect: () => Promise<PushConnection>
  send?: (
    target: { endpoint: string; p256dh: string; auth: string },
    message: PushMessage,
    keys: VapidKeys,
  ) => Promise<PushOutcome>
}

interface VapidRow extends QueryResultRow {
  public_key: string
  private_jwk: VapidKeys['privateJwk']
}

interface DeliveryRow extends QueryResultRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  payload: PushMessage
}

/** The server key, made on first use. Whoever inserts first wins. */
export async function ensureVapidKeys(
  conn: PushConnection,
): Promise<VapidKeys> {
  const existing = await conn.query<VapidRow>(
    'SELECT public_key, private_jwk FROM internal.push_vapid_keys',
  )

  let row = existing.rows.length > 0 ? existing.rows[0] : null

  if (!row) {
    const made = generateVapidKeys()

    const saved = await conn.query<VapidRow>(
      'SELECT public_key, private_jwk FROM internal.ensure_push_vapid_keys($1, $2::jsonb)',
      [made.publicKey, JSON.stringify(made.privateJwk)],
    )

    row = saved.rows[0]
  }

  return { publicKey: row.public_key, privateJwk: row.private_jwk }
}

/** The contact push services can reach: an https address, or a mailto. */
export function vapidSubject(
  baseUrl: string,
  override?: string | null,
): string {
  if (override) return override

  return baseUrl.startsWith('https://')
    ? baseUrl
    : 'mailto:no-reply@sheetbase.local'
}

export interface PushRunResult {
  reminders: number
  sent: number
  gone: number
  failed: number
}

/** One pass: reminders, then deliveries, then pruning. */
export async function runPushWorker(deps: PushDeps): Promise<PushRunResult> {
  const conn = await deps.connect()
  const result: PushRunResult = { reminders: 0, sent: 0, gone: 0, failed: 0 }

  try {
    const keys = await ensureVapidKeys(conn)

    const reminders = await conn.query<{ n: number }>(
      'SELECT internal.sweep_booking_reminders() AS n',
    )

    result.reminders = reminders.rows[0]?.n ?? 0

    const claimed = await conn.query<DeliveryRow>(
      'SELECT id, endpoint, p256dh, auth, payload FROM internal.claim_due_push_deliveries($1)',
      [50],
    )

    const send =
      deps.send ??
      ((target, message, vapid) =>
        sendWebPush(target, message, vapid, {
          subject: vapidSubject(env.BETTER_AUTH_URL, env.PUSH_VAPID_SUBJECT),
        }))

    for (const delivery of claimed.rows) {
      const outcome: PushOutcome = isValidDeviceKey(delivery.p256dh)
        ? await send(delivery, delivery.payload, keys)
        : { kind: 'gone' }

      const [label, error] =
        outcome.kind === 'sent'
          ? (['sent', null] as const)
          : outcome.kind === 'gone'
            ? (['gone', null] as const)
            : (['retry', outcome.error] as const)

      await conn.query('SELECT internal.finish_push_delivery($1, $2, $3)', [
        delivery.id,
        label,
        error,
      ])

      if (label === 'sent') result.sent += 1
      else if (label === 'gone') result.gone += 1
      else result.failed += 1
    }

    await conn.query('SELECT internal.prune_push_deliveries()')

    return result
  } finally {
    await conn.end()
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let bootTimer: ReturnType<typeof setTimeout> | null = null
const startedGlobalKey = '__sheetbasePushSchedulerStarted'

function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true

  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

async function defaultConnect(): Promise<PushConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()

  return client
}

export function startPushScheduler(
  options: { deps?: PushDeps; intervalMs?: number } = {},
): void {
  if (typeof window !== 'undefined') return

  if (schedulerDisabled()) return
  const g = globalThis as unknown as Record<string, unknown>

  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true

  const deps = options.deps ?? { connect: defaultConnect }
  let running = false

  const tick = async () => {
    if (running) return
    running = true

    try {
      const result = await runPushWorker(deps)

      if (result.sent || result.gone || result.failed || result.reminders) {
        logger.info('push worker ran', { ...result })
      }
    } catch (error) {
      logger.warn('push worker failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }

  bootTimer = setTimeout(() => void tick(), 3_000)
  bootTimer.unref()
  timer = setInterval(() => void tick(), options.intervalMs ?? PUSH_INTERVAL_MS)
  timer.unref()
}

/** Clear the timers and the per-process guard (tests and shutdown). */
export function stopPushScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer)

  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
  const g = globalThis as unknown as Record<string, unknown>
  delete g[startedGlobalKey]
}
