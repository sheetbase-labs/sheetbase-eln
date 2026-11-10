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
import { runDueScheduledReports } from './scheduled-reports.server'

export const EMAIL_INTERVAL_MS = 60_000

let timer: ReturnType<typeof setInterval> | null = null

/** One sweep per process, even when this module is loaded twice (dev reload). */
const STARTED = Symbol.for('sheetbaseEmailSchedulerStarted')

/** The process-wide flags this module owns. */
interface EmailSchedulerFlags {
  [STARTED]?: boolean
}

export function startEmailScheduler(): void {
  if (typeof window !== 'undefined') return

  if (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.SHEETBASE_SCHEDULER_ENABLED === 'false'
  ) {
    return
  }

  // SAFETY: `globalThis` is the one process object Node runs; the symbol key is
  // this module's own, so no other code writes a value of another type to it.
  const g = globalThis as EmailSchedulerFlags

  if (g[STARTED]) return
  g[STARTED] = true

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

      const query: EmailQuery = {
        // SAFETY: `PooledClient.query` forwards to pg's client query, whose result carries the `rows` this interface names; the assertion narrows its overloads to the single shape the worker calls.
        query: ((sql: string, params?: unknown[]) =>
          client.query(sql, params)) as EmailQuery['query'],
      }

      // Scheduled reports are queued the same way: they wait for email.
      await runDueScheduledReports(query, env.BETTER_AUTH_URL)

      if (!smtp) return
      const transport = await createSmtpTransport(smtp)
      await processEmailDeliveries(query, transport)
    } finally {
      await client.end()
    }
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A rejected promise carries whatever was thrown; the message is read only when it is an Error and stringified otherwise.
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
