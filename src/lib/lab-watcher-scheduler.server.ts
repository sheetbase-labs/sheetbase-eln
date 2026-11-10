/**
 * Lab watchers: the sweep that runs the ones that are due.
 *
 * A watcher looks at the lab on its own schedule (hourly, daily or weekly) and
 * leaves a finding in its owner's Inbox for anything new. The database does
 * the looking in `internal.run_due_lab_watchers`; this only calls it on a
 * timer. Safe to run at any time and as often as wanted.
 *
 * Same start pattern as the other schedulers: an unref'd interval, never
 * started under test runners unless explicitly enabled.
 */
import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from './logger'

/** Fine enough for an hourly watcher, cheap enough to run all day. */
export const LAB_WATCHER_INTERVAL_MS = 5 * 60 * 1000

export interface LabWatcherConnection {
  query: (text: string) => Promise<{ rows: { found: number }[] }>
  end: () => Promise<void>
}

export interface LabWatcherDeps {
  connect: () => Promise<LabWatcherConnection>
}

/** Run every due watcher and return how many new findings they made. */
export async function sweepLabWatchers(deps: LabWatcherDeps): Promise<number> {
  const conn = await deps.connect()

  try {
    const { rows } = await conn.query(
      'SELECT internal.run_due_lab_watchers() AS found',
    )

    return rows[0]?.found ?? 0
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
  var __sheetbaseLabWatcherSchedulerStarted: boolean | undefined
}

function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true

  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

async function defaultConnect(): Promise<LabWatcherConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()

  return client
}

export function startLabWatcherScheduler(
  options: { deps?: LabWatcherDeps; intervalMs?: number } = {},
): void {
  if (typeof window !== 'undefined') return

  if (schedulerDisabled()) return

  if (globalThis.__sheetbaseLabWatcherSchedulerStarted) return
  globalThis.__sheetbaseLabWatcherSchedulerStarted = true

  const deps = options.deps ?? { connect: defaultConnect }

  const tick = async () => {
    try {
      const found = await sweepLabWatchers(deps)

      if (found > 0) logger.info('lab watchers found something', { found })
    } catch (error) {
      logger.warn('lab watcher sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  bootTimer = setTimeout(() => void tick(), 20_000)
  bootTimer.unref()
  timer = setInterval(
    () => void tick(),
    options.intervalMs ?? LAB_WATCHER_INTERVAL_MS,
  )
  timer.unref()
}

/** Clear the timers and the per-process guard (tests and shutdown). */
export function stopLabWatcherScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer)

  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
  delete globalThis.__sheetbaseLabWatcherSchedulerStarted
}
