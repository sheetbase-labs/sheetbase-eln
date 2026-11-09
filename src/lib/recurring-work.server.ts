/**
 * Repeating work: the sweep that makes what has come due.
 *
 * A repeat (an instrument booked every week, an experiment started from a
 * protocol each month, a stability study's time points) is a schedule row.
 * Bookings are made ahead of time and experiments on their day, so something
 * has to wake up regularly and make them. This sweep runs
 * `api.materialise_recurring_schedule` for each active schedule, as the person
 * who set it up, so the booking and experiment rules apply exactly as if they
 * had made each one by hand. Each schedule runs in its own transaction: one
 * that fails does not hold up the others.
 *
 * Same start pattern as the reagent expiry sweep: an unref'd interval, never
 * started under test runners unless explicitly enabled.
 */
import type { QueryResultRow } from 'pg'

import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from './logger'

/** Bookings are made 60 days ahead and experiments by the day, so ten minutes is plenty. */
export const RECURRING_WORK_INTERVAL_MS = 10 * 60 * 1000

export interface RecurringConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
  end: () => Promise<void>
}

export interface RecurringWorkDeps {
  connect: () => Promise<RecurringConnection>
}

export interface RecurringSweepResult {
  schedules: number
  created: number
  skipped: number
  failed: number
  errors: number
}

interface DueSchedule extends QueryResultRow {
  id: string
  workspace_id: string
  created_by_user_id: string
}

/** Run one sweep. Never throws for one schedule's failure; counts it instead. */
export async function sweepRecurringWork(
  deps: RecurringWorkDeps,
  log: Pick<typeof logger, 'warn'> = logger,
): Promise<RecurringSweepResult> {
  const conn = await deps.connect()

  const result: RecurringSweepResult = {
    schedules: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    errors: 0,
  }

  try {
    const { rows } = await conn.query<DueSchedule>(
      `SELECT id, workspace_id, created_by_user_id
         FROM api.recurring_schedules WHERE status = 'active'
        ORDER BY created_at`,
    )

    for (const schedule of rows) {
      result.schedules += 1

      try {
        await conn.query('BEGIN')
        await conn.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({
            role: 'authenticated',
            sub: schedule.created_by_user_id,
            workspace_id: schedule.workspace_id,
          }),
        ])

        const made = await conn.query<{
          r: { created: number; skipped: number; failed: number }
        }>(`SELECT api.materialise_recurring_schedule($1) AS r`, [schedule.id])

        await conn.query('COMMIT')
        const counts = made.rows[0].r
        result.created += counts.created
        result.skipped += counts.skipped
        result.failed += counts.failed
      } catch (error) {
        await conn.query('ROLLBACK').catch(() => {})
        result.errors += 1
        log.warn('repeating work could not be made', {
          scheduleId: schedule.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } finally {
    await conn.end()
  }

  return result
}

let timer: ReturnType<typeof setInterval> | null = null
let bootTimer: ReturnType<typeof setTimeout> | null = null
const startedGlobalKey = '__sheetbaseRecurringWorkSchedulerStarted'

function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true

  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

async function defaultConnect(): Promise<RecurringConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()

  return client
}

export function startRecurringWorkScheduler(
  options: { deps?: RecurringWorkDeps; intervalMs?: number } = {},
): void {
  if (typeof window !== 'undefined') return

  if (schedulerDisabled()) return
  const g = globalThis as unknown as Record<string, unknown>

  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true

  const deps = options.deps ?? { connect: defaultConnect }

  const tick = async () => {
    const startedAt = Date.now()

    try {
      const result = await sweepRecurringWork(deps)

      if (result.created || result.skipped || result.failed || result.errors) {
        logger.info('repeating work swept', {
          ...result,
          durationMs: Date.now() - startedAt,
        })
      }
    } catch (error) {
      logger.warn('repeating work sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  bootTimer = setTimeout(() => void tick(), 5_000)
  bootTimer.unref()
  timer = setInterval(
    () => void tick(),
    options.intervalMs ?? RECURRING_WORK_INTERVAL_MS,
  )
  timer.unref()
}

/** Clear the timers and the per-process guard (tests and shutdown). */
export function stopRecurringWorkScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer)

  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
  const g = globalThis as unknown as Record<string, unknown>
  delete g[startedGlobalKey]
}
