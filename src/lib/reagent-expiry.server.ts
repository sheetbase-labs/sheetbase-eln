/**
 * WORK-03.2 — the reagent expiry sweep, the producer for material_expiring.
 *
 * The other seven design event types are derived from events the application already
 * emits. Nothing emitted anything for a lot approaching expiry, so this sweep calls
 * internal.emit_reagent_expiry_events on an interval; the function writes one system
 * event per lot inside the warning window (idempotent per lot) and the notification
 * trigger turns it into the design's "Material lot expiring in 7 days".
 *
 * It runs on `background-sweep.server.ts`, and every sweep failure is swallowed
 * and logged so a bad sweep can never take the server down.
 */
import { PooledClient } from '#/db/pool.server'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'
import { logger } from './logger'
import { createBackgroundSweep } from './background-sweep.server'

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

/** The primitive fields one sweep reports to the log. */
export type ExpiryLogFields = Record<string, string | number | boolean | null>

/** Structured log sink, injectable for unit tests. */
export interface ExpiryLog {
  info: (message: string, fields: ExpiryLogFields) => void
  warn: (message: string, fields: ExpiryLogFields) => void
}

const defaultLog: ExpiryLog = {
  info: (message, fields) => logger.info(message, fields),
  warn: (message, fields) => logger.warn(message, fields),
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

const expirySweep = createBackgroundSweep('reagent-expiry')

export interface StartReagentExpiryOptions {
  deps?: ReagentExpiryDeps
  intervalMs?: number
  log?: ExpiryLog
}

export function startReagentExpiryScheduler(
  options: StartReagentExpiryOptions = {},
): void {
  const deps = options.deps ?? { connect: defaultConnect }
  const intervalMs = options.intervalMs ?? REAGENT_EXPIRY_INTERVAL_MS

  expirySweep.start(
    createReagentExpiryTick(deps, REAGENT_EXPIRY_WINDOW_DAYS, options.log),
    intervalMs,
  )
}

/** Clear both timers and the per-process guard (used by tests/shutdown). */
export function stopReagentExpiryScheduler(): void {
  expirySweep.stop()
}

async function defaultConnect(): Promise<ExpiryConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()

  return client
}
