/**
 * Step timers: the sweep that tells people a timer has ended.
 *
 * The page alerts on its own while it is open. This covers the rest: it writes
 * the bell notification for every timer that has ended, so someone who locked
 * their phone or closed the tab finds it waiting (and gets an email if they
 * asked for those). One call to `internal.sweep_step_timers()` does it all, in
 * one transaction.
 *
 * Same start pattern as the other sweeps: an unref'd interval, never started
 * under test runners unless explicitly enabled.
 */
import type { QueryResultRow } from 'pg'

import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from './logger'

/** A timer is a matter of minutes, so the bell should follow within half a minute. */
export const STEP_TIMER_INTERVAL_MS = 20_000

export interface StepTimerConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
  end: () => Promise<void>
}

export interface StepTimerDeps {
  connect: () => Promise<StepTimerConnection>
}

/** Run one sweep and return how many timers it notified. */
export async function sweepStepTimers(deps: StepTimerDeps): Promise<number> {
  const conn = await deps.connect()

  try {
    const { rows } = await conn.query<{ n: number }>(
      `SELECT internal.sweep_step_timers() AS n`,
    )

    return rows[0]?.n ?? 0
  } finally {
    await conn.end()
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let bootTimer: ReturnType<typeof setTimeout> | null = null

/**
 * The process-wide started flag. A development reload evaluates this module
 * again while the first scheduler's interval is still live, so the guard has
 * to live on `globalThis`, not in this module's scope.
 */
declare global {
  var __sheetbaseStepTimerSchedulerStarted: boolean | undefined
}

function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true

  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

async function defaultConnect(): Promise<StepTimerConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()

  return client
}

export function startStepTimerScheduler(
  options: { deps?: StepTimerDeps; intervalMs?: number } = {},
): void {
  if (typeof window !== 'undefined') return

  if (schedulerDisabled()) return

  if (globalThis.__sheetbaseStepTimerSchedulerStarted) return
  globalThis.__sheetbaseStepTimerSchedulerStarted = true

  const deps = options.deps ?? { connect: defaultConnect }

  const tick = async () => {
    try {
      const notified = await sweepStepTimers(deps)

      if (notified) logger.info('step timers notified', { notified })
    } catch (error) {
      logger.warn('step timer sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  bootTimer = setTimeout(() => void tick(), 5_000)
  bootTimer.unref()
  timer = setInterval(
    () => void tick(),
    options.intervalMs ?? STEP_TIMER_INTERVAL_MS,
  )
  timer.unref()
}

/** Clear the timers and the per-process guard (tests and shutdown). */
export function stopStepTimerScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer)

  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
  delete globalThis.__sheetbaseStepTimerSchedulerStarted
}
