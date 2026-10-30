/**
 * WORK-03.4 — the email worker driver.
 *
 * A per-process interval (unref'd, never started under test runners) that
 * enqueues due daily digests and, when SMTP is configured, sends due
 * deliveries through the outbox worker. Mirrors the pipeline scheduler's
 * start pattern.
 */
import { PooledClient } from '#/db/pool.server'
import { logger } from './logger'

import { env } from '#/env.server'
import {
  createSmtpTransport,
  processEmailDeliveries,
  readSmtpConfig,
} from './email-delivery.server'
import type { EmailQuery } from './email-delivery.server'
import { sweepInboxEmails } from './inbox-email.server'

export const EMAIL_INTERVAL_MS = 60_000

let timer: ReturnType<typeof setInterval> | null = null
const startedGlobalKey = '__sheetbaseEmailSchedulerStarted'

export function startEmailScheduler(): void {
  if (typeof window !== 'undefined') return
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.SHEETBASE_SCHEDULER_ENABLED === 'false'
  ) {
    return
  }
  const g = globalThis as unknown as Record<string, unknown>
  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true

  const tick = async () => {
    const client = new PooledClient({ connectionString: env.DATABASE_URL })
    await client.connect()
    try {
      const smtp = readSmtpConfig()
      // Inbox-only events have no notification row: this queues their emails
      // (when email can be sent) and records what the digest will list.
      await sweepInboxEmails(client, env.BETTER_AUTH_URL, {
        email: smtp !== null,
      })
      // The digest is enqueued regardless of transport so it is not lost.
      await client.query('SELECT internal.enqueue_daily_digests()')
      if (!smtp) return
      const query: EmailQuery = {
        query: ((sql: string, params?: unknown[]) =>
          client.query(sql, params)) as EmailQuery['query'],
      }
      const transport = await createSmtpTransport(smtp)
      await processEmailDeliveries(query, transport)
    } finally {
      await client.end()
    }
  }

  const onError = (error: unknown) => {
    logger.warn('email sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const first = setTimeout(() => void tick().catch(onError), 5_000)
  first.unref()
  timer = setInterval(() => void tick().catch(onError), EMAIL_INTERVAL_MS)
  timer.unref()
}
