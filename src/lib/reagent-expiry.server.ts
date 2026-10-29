/**
 * WORK-03.2 — the reagent expiry sweep, the producer for material_expiring.
 *
 * The other seven design event types are derived from events the application already
 * emits. Nothing emitted anything for a lot approaching expiry, so this sweep calls
 * internal.emit_reagent_expiry_events on an interval; the function writes one system
 * event per lot inside the warning window (idempotent per lot) and the notification
 * trigger turns it into the design's "Material lot expiring in 7 days".
 *
 * This mirrors src/lib/sample-hold.server.ts exactly: an unref'd interval, guarded by
 * the `SHEETBASE_SCHEDULER_ENABLED` semantics, never started under test runners unless
 * explicitly enabled, and every sweep failure is swallowed and logged so a bad sweep
 * can never take the server down.
 */
import { PooledClient } from '#/db/pool.server'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'

/** Lots are checked day-scale; a few hours of latency is irrelevant. */
export const REAGENT_EXPIRY_INTERVAL_MS = 6 * 60 * 60 * 1000
/** The design's window: "Material lot expiring in 7 days". */
export const REAGENT_EXPIRY_WINDOW_DAYS = 7

interface QueryResult<T extends QueryResultRow> {
  rows: T[]
}

export interface ExpiryConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<T>>
  end: () => Promise<void>
}

export interface ReagentExpiryDeps {
  connect: () => Promise<ExpiryConnection>
}

/** Structured log sink, injectable for unit tests. */
export interface ExpiryLog {
  info: (message: string, fields: Record<string, unknown>) => void
  warn: (message: string, fields: Record<string, unknown>) => void
}

const defaultLog: ExpiryLog = {
  info: (message, fields) =>
    console.info(JSON.stringify({ level: 'info', message, ...fields })),
  warn: (message, fields) =>
    console.warn(JSON.stringify({ level: 'warn', message, ...fields })),
}

/**
 * Run one expiry sweep and return how many lots were warned about. Does not catch;
 * the driver owns failure handling so the interval keeps running.
 */
export async function sweepReagentExpiry(
  deps: ReagentExpiryDeps,
  windowDays: number = REAGENT_EXPIRY_WINDOW_DAYS,
): Promise<number> {
  const conn = await deps.connect()
  try {
    const { rows } = await conn.query<{ result: number }>(
      'SELECT internal.emit_reagent_expiry_events($1) AS result',
      [windowDays],
    )
    return rows.at(0)?.result ?? 0
  } finally {
    await conn.end()
  }
}

/** Build the per-interval tick: bounded metric on success, logged failure otherwise. */
export function createReagentExpiryTick(
  deps: ReagentExpiryDeps,
  windowDays: number = REAGENT_EXPIRY_WINDOW_DAYS,
  log: ExpiryLog = defaultLog,
): () => Promise<void> {
  return async () => {
    const startedAt = Date.now()
    try {
      const emitted = await sweepReagentExpiry(deps, windowDays)
      log.info('reagent expiry sweep complete', {
        emitted,
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      log.warn('reagent expiry sweep failed', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      })
    }
  }
}

let expiryTimer: ReturnType<typeof setInterval> | null = null
let expiryBootTimer: ReturnType<typeof setTimeout> | null = null
const startedGlobalKey = '__sheetbaseReagentExpirySchedulerStarted'

/**
 * Disabled under test runners unless explicitly enabled with
 * `SHEETBASE_SCHEDULER_ENABLED=true`; always disabled when that flag is `false`.
 */
function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true
  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

export interface StartReagentExpiryOptions {
  deps?: ReagentExpiryDeps
  intervalMs?: number
  log?: ExpiryLog
}

export function startReagentExpiryScheduler(
  options: StartReagentExpiryOptions = {},
): void {
  if (typeof window !== 'undefined') return
  if (schedulerDisabled()) return
  const g = globalThis as unknown as Record<string, unknown>
  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true

  const deps = options.deps ?? { connect: defaultConnect }
  const intervalMs = options.intervalMs ?? REAGENT_EXPIRY_INTERVAL_MS
  const tick = createReagentExpiryTick(
    deps,
    REAGENT_EXPIRY_WINDOW_DAYS,
    options.log,
  )

  // First sweep shortly after boot, then on the interval.
  expiryBootTimer = setTimeout(() => void tick(), 5_000)
  expiryBootTimer.unref()
  expiryTimer = setInterval(() => void tick(), intervalMs)
  expiryTimer.unref()
}

/** Clear both timers and the per-process guard (used by tests/shutdown). */
export function stopReagentExpiryScheduler(): void {
  if (expiryBootTimer) {
    clearTimeout(expiryBootTimer)
    expiryBootTimer = null
  }
  if (expiryTimer) {
    clearInterval(expiryTimer)
    expiryTimer = null
  }
  const g = globalThis as unknown as Record<string, unknown>
  delete g[startedGlobalKey]
}

async function defaultConnect(): Promise<ExpiryConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()
  return client
}
