/**
 * Notification channels: the worker that sends what the outbox holds.
 *
 * Every tick it claims the messages that are due
 * (internal.plugin_channel_deliveries, filled by a trigger on notifications),
 * hands each to the plugin's channel and records the outcome. A failure tries
 * again up to three times. Same start pattern as phone alerts: an unref'd
 * interval, never started under test runners unless explicitly enabled.
 */
import type { QueryResultRow } from 'pg'

import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from '../logger'
import { runChannelDelivery } from './outgoing-runtime.server'
import type { ChannelNotification } from './outgoing-runtime.server'

export const CHANNEL_INTERVAL_MS = 15_000

export interface ChannelConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
  end: () => Promise<void>
}

export interface ChannelDeps {
  connect: () => Promise<ChannelConnection>
  /** The address messages link into; the app's own. */
  baseUrl?: string
  /** Sends one message through the plugin; absent means the real runtime. */
  deliver?: typeof runChannelDelivery
}

interface DeliveryRow extends QueryResultRow {
  id: string
  workspace_id: string
  user_id: string
  extension_id: string
  channel_id: string
  destination: string
  payload: {
    event: string
    title: string
    body: string
    link: string
    at: string
  }
}

export interface ChannelRunResult {
  sent: number
  failed: number
}

/** Makes a link from the app's address; an absolute address is left as it is. */
export function absoluteLink(baseUrl: string, link: string): string {
  if (/^https?:\/\//i.test(link)) return link

  return `${baseUrl.replace(/\/+$/, '')}${link.startsWith('/') ? '' : '/'}${link}`
}

/** One pass: send what is due, then prune. */
export async function runChannelWorker(
  deps: ChannelDeps,
): Promise<ChannelRunResult> {
  const conn = await deps.connect()
  const result: ChannelRunResult = { sent: 0, failed: 0 }
  const deliver = deps.deliver ?? runChannelDelivery
  const baseUrl = deps.baseUrl ?? env.BETTER_AUTH_URL

  try {
    const claimed = await conn.query<DeliveryRow>(
      'SELECT id, workspace_id, user_id, extension_id, channel_id, destination, payload FROM internal.claim_due_plugin_channel_deliveries($1)',
      [50],
    )

    for (const delivery of claimed.rows) {
      let error: string | null = null

      try {
        const key = await conn.query<{ key: string }>(
          'SELECT key FROM api.extensions WHERE id = $1 AND workspace_id = $2',
          [delivery.extension_id, delivery.workspace_id],
        )

        const extensionKey = key.rows[0]?.key

        if (!extensionKey) throw new Error('The plugin is no longer installed.')

        const notification: ChannelNotification = {
          ...delivery.payload,
          link: absoluteLink(baseUrl, delivery.payload.link),
        }

        await deliver({
          workspaceId: delivery.workspace_id,
          actorUserId: delivery.user_id,
          extensionKey,
          channelId: delivery.channel_id,
          destination: delivery.destination,
          notification,
        })
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }

      await conn.query(
        'SELECT internal.finish_plugin_channel_delivery($1, $2, $3)',
        [delivery.id, error === null, error],
      )

      if (error === null) result.sent += 1
      else result.failed += 1
    }

    await conn.query('SELECT internal.prune_plugin_channel_deliveries()')

    return result
  } finally {
    await conn.end()
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let bootTimer: ReturnType<typeof setTimeout> | null = null

declare global {
  var __sheetbaseChannelSchedulerStarted: boolean | undefined
}

function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true

  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

async function defaultConnect(): Promise<ChannelConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()

  return client
}

export function startChannelScheduler(
  options: { deps?: ChannelDeps; intervalMs?: number } = {},
): void {
  if (typeof window !== 'undefined') return

  if (schedulerDisabled()) return

  if (globalThis.__sheetbaseChannelSchedulerStarted) return
  globalThis.__sheetbaseChannelSchedulerStarted = true

  const deps = options.deps ?? { connect: defaultConnect }
  let running = false

  const tick = async () => {
    if (running) return
    running = true

    try {
      const result = await runChannelWorker(deps)

      if (result.sent || result.failed)
        logger.info('notification channel worker ran', { ...result })
    } catch (error) {
      logger.warn('notification channel worker failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }

  bootTimer = setTimeout(() => void tick(), 4_000)
  bootTimer.unref()
  timer = setInterval(
    () => void tick(),
    options.intervalMs ?? CHANNEL_INTERVAL_MS,
  )
  timer.unref()
}

/** Clear the timers and the per-process guard (tests and shutdown). */
export function stopChannelScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer)

  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
  delete globalThis.__sheetbaseChannelSchedulerStarted
}
