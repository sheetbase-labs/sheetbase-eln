/**
 * Out of office: the sweep that keeps cover in step with the calendar.
 *
 * Cover is applied the moment an absence is set and when a review is
 * submitted, but an absence that starts tomorrow or ends tonight changes
 * nothing by itself, so this runs `internal.sync_absence_cover` regularly.
 * It is safe to run at any time and as often as wanted.
 *
 * Same start pattern as the other schedulers: an unref'd interval, never
 * started under test runners unless explicitly enabled.
 */
import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from './logger'

/** A day boundary should reach people within minutes, not hours. */
export const ABSENCE_COVER_INTERVAL_MS = 10 * 60 * 1000

export interface AbsenceCoverConnection {
  query: (text: string) => Promise<{ rows: { changed: number }[] }>
  end: () => Promise<void>
}

export interface AbsenceCoverDeps {
  connect: () => Promise<AbsenceCoverConnection>
}

/** Run one sweep and return how many reviews gained or lost cover. */
export async function sweepAbsenceCover(
  deps: AbsenceCoverDeps,
): Promise<number> {
  const conn = await deps.connect()

  try {
    const { rows } = await conn.query(
      'SELECT internal.sync_absence_cover(NULL) AS changed',
    )

    return rows[0]?.changed ?? 0
  } finally {
    await conn.end()
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let bootTimer: ReturnType<typeof setTimeout> | null = null
const startedGlobalKey = '__sheetbaseAbsenceCoverSchedulerStarted'

function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true

  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

async function defaultConnect(): Promise<AbsenceCoverConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()

  return client
}

export function startAbsenceCoverScheduler(
  options: { deps?: AbsenceCoverDeps; intervalMs?: number } = {},
): void {
  if (typeof window !== 'undefined') return

  if (schedulerDisabled()) return
  const g = globalThis as unknown as Record<string, unknown>

  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true

  const deps = options.deps ?? { connect: defaultConnect }

  const tick = async () => {
    try {
      const changed = await sweepAbsenceCover(deps)

      if (changed > 0) logger.info('absence cover swept', { changed })
    } catch (error) {
      logger.warn('absence cover sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  bootTimer = setTimeout(() => void tick(), 7_000)
  bootTimer.unref()
  timer = setInterval(
    () => void tick(),
    options.intervalMs ?? ABSENCE_COVER_INTERVAL_MS,
  )
  timer.unref()
}

/** Clear the timers and the per-process guard (tests and shutdown). */
export function stopAbsenceCoverScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer)

  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
  const g = globalThis as unknown as Record<string, unknown>
  delete g[startedGlobalKey]
}
