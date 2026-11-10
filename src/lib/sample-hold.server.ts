/**
 * LAB-02 step 1 — sample hold limits (server-side).
 *
 * Periodically calls `api.sweep_sample_hold_limits(p_limit)` to move samples
 * past their hold limit to the `hold_exceeded` lifecycle state as System,
 * appending one canonical `api.sample_events` row (operation
 * `hold_exceeded`, null actor) per transition. The RPC's records UPDATE and
 * sample_events INSERT both fire the existing change-event triggers, so the
 * transition reaches the audit history and the live change stream without a
 * second status or event engine.
 *
 * The RPC is `SECURITY DEFINER` and its `EXECUTE` grant is revoked from
 * PUBLIC/anon/authenticated/api_client (former migration 0281),
 * so the job connects with `env.DATABASE_URL` — the same privileged bootstrap
 * connection the pipeline and dataset retention schedulers use. No extra
 * credential is needed.
 *
 * This mirrors `src/lib/dataset-retention-scheduler.server.ts` exactly: an
 * unref'd interval, guarded by the `SHEETBASE_SCHEDULER_ENABLED` semantics,
 * never started under test runners unless explicitly enabled, and every sweep
 * failure is swallowed and logged so a bad sweep can never take the server
 * down.
 */

import { z } from 'zod'

import { PooledClient } from '#/db/pool.server'
import type { QueryResultRow } from 'pg'

import { now as clockNow } from './clock'
import { env } from '#/env.server'
import { logger } from './logger'
import type { LogFields } from './logger'

/** Hold limits are day-scale; a few hours of latency is irrelevant. */
export const SAMPLE_HOLD_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Bounded batch per sweep, within the RPC's 1..1000 validated range. */
export const SAMPLE_HOLD_BATCH_LIMIT = 100

const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------
// Pure decision logic (no database). The SQL RPC is the authoritative
// implementation; this mirrors `internal.sample_hold_deadline` so the UI and
// tests can reason about the same rule. Keep the two in step.
// ---------------------------------------------------------------------------

/** A record's `properties` JSONB: JSON values keyed by property name. */
type RecordProperties = { [key: string]: z.core.util.JSONType }

export interface HoldLimitSample {
  createdAt: string
  properties?: RecordProperties | null
}

export interface ParsedHoldLimit {
  condition: string | null
  /** Harvest/registration start; null falls back to the record createdAt. */
  startedAt: string | null
  durationDays: number | null
  /** Explicit deadline override; wins over startedAt + durationDays. */
  until: string | null
  allowedUseExperimentIds: string[]
}

/** A property that must be text to count; surrounding space is dropped. */
const nonEmptyText = z.string().trim().min(1)

/** A hold-limit text property, or null when it is absent or not text. */
const textOrNull = nonEmptyText.nullable().catch(null)

/** `holdDurationDays` as a number: a number, a numeric string or a boolean. */
const durationDays = z
  .union([z.number(), z.string().trim().min(1), z.boolean()])
  .transform(Number)
  .pipe(z.number().finite())
  .nullable()
  .catch(null)

/** The experiment ids allowed to use the sample; anything else is dropped. */
const experimentIds = z
  .array(nonEmptyText.catch(''))
  .catch([])
  .transform((ids) => ids.filter((id) => id !== ''))

/** Parse the hold-limit properties from a sample's `records.properties`. */
export function parseHoldLimit(
  properties: RecordProperties | null | undefined,
): ParsedHoldLimit {
  const props = properties ?? {}

  return {
    condition: textOrNull.parse(props.holdCondition),
    startedAt: textOrNull.parse(props.holdStartedAt),
    durationDays: durationDays.parse(props.holdDurationDays),
    until: textOrNull.parse(props.holdUntil),
    allowedUseExperimentIds: experimentIds.parse(props.allowedUseExperimentIds),
  }
}

function toDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The effective hold deadline, or null when the sample carries no hold limit
 * (neither `holdUntil` nor `holdDurationDays`). `holdUntil` wins; otherwise
 * the start (holdStartedAt, falling back to createdAt) plus the duration.
 */
export function effectiveHoldDeadline(sample: HoldLimitSample): Date | null {
  const hold = parseHoldLimit(sample.properties)

  if (hold.until) return toDate(hold.until)

  if (hold.durationDays == null) return null

  const start =
    toDate(hold.startedAt) ?? toDate(sample.createdAt) ?? new Date(NaN)

  if (Number.isNaN(start.getTime())) return null

  return new Date(start.getTime() + hold.durationDays * DAY_MS)
}

/** True when the sample has a hold limit and it has passed at `now`. */
export function isHoldExceeded(
  sample: HoldLimitSample,
  now: Date = clockNow(),
): boolean {
  const deadline = effectiveHoldDeadline(sample)

  return deadline != null && deadline.getTime() <= now.getTime()
}

// ---------------------------------------------------------------------------
// Scheduled sweep.
// ---------------------------------------------------------------------------

interface QueryResult<T extends QueryResultRow> {
  rows: T[]
}

export interface HoldConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<T>>
  end: () => Promise<void>
}

export interface SampleHoldDeps {
  connect: () => Promise<HoldConnection>
}

interface SweepRow extends QueryResultRow {
  result: {
    exceededCount: number
    exceeded: Array<{ recordId: string; workspaceId: string; deadline: string }>
  }
}

/** Structured log sink, injectable for unit tests. */
export interface HoldLog {
  info: (message: string, fields: LogFields) => void
  warn: (message: string, fields: LogFields) => void
}

const defaultLog: HoldLog = {
  info: (message, fields) => logger.info(message, fields),
  warn: (message, fields) => logger.warn(message, fields),
}

/**
 * Run one hold sweep: call the sweep RPC with the bounded batch limit and
 * return the number of samples moved to hold_exceeded. Does not catch; the
 * driver owns failure handling so an error is logged and the interval keeps
 * running.
 */
export async function sweepSampleHoldLimits(
  deps: SampleHoldDeps,
  limit: number = SAMPLE_HOLD_BATCH_LIMIT,
): Promise<number> {
  const conn = await deps.connect()

  try {
    const { rows } = await conn.query<SweepRow>(
      `SELECT api.sweep_sample_hold_limits($1) AS result`,
      [limit],
    )

    return rows.at(0)?.result.exceededCount ?? 0
  } finally {
    await conn.end()
  }
}

/**
 * Build the per-interval tick. Success logs a bounded metric line; failure is
 * swallowed and logged so the caller's interval is never broken by a throw.
 */
export function createSampleHoldTick(
  deps: SampleHoldDeps,
  limit: number = SAMPLE_HOLD_BATCH_LIMIT,
  log: HoldLog = defaultLog,
): () => Promise<void> {
  return async () => {
    const startedAt = Date.now()

    try {
      const exceededCount = await sweepSampleHoldLimits(deps, limit)
      log.info('sample hold sweep complete', {
        exceededCount,
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      log.warn('sample hold sweep failed', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      })
    }
  }
}

let holdTimer: ReturnType<typeof setInterval> | null = null
let holdBootTimer: ReturnType<typeof setTimeout> | null = null
const startedGlobalKey = '__sheetbaseSampleHoldSchedulerStarted'

/**
 * The process-wide marker that keeps one scheduler per process, including
 * across a dev-server module reload. The global type declares no such key.
 */
type SchedulerGlobal = typeof globalThis & { [startedGlobalKey]?: boolean }

/** Read the marker this module alone writes. */
function schedulerStarted(): boolean {
  // SAFETY: `SchedulerGlobal` only adds the marker key this module sets on `globalThis`; no other module declares or writes it.
  const g = globalThis as SchedulerGlobal

  return g[startedGlobalKey] === true
}

/** Set or clear the marker this module alone writes. */
function markSchedulerStarted(started: boolean): void {
  // SAFETY: `SchedulerGlobal` only adds the marker key this module sets on `globalThis`; no other module declares or writes it.
  const g = globalThis as SchedulerGlobal

  if (started) g[startedGlobalKey] = true
  else delete g[startedGlobalKey]
}

/**
 * Disabled under test runners unless explicitly enabled with
 * `SHEETBASE_SCHEDULER_ENABLED=true`; always disabled when that flag is
 * `false`. Same semantics as the pipeline and dataset retention schedulers.
 */
function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true

  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

export interface StartSampleHoldOptions {
  deps?: SampleHoldDeps
  intervalMs?: number
  log?: HoldLog
}

export function startSampleHoldScheduler(
  options: StartSampleHoldOptions = {},
): void {
  if (typeof window !== 'undefined') return

  if (schedulerDisabled()) return

  if (schedulerStarted()) return
  markSchedulerStarted(true)

  const deps = options.deps ?? { connect: defaultConnect }
  const intervalMs = options.intervalMs ?? SAMPLE_HOLD_INTERVAL_MS
  const tick = createSampleHoldTick(deps, SAMPLE_HOLD_BATCH_LIMIT, options.log)

  // First sweep shortly after boot, then on the interval.
  holdBootTimer = setTimeout(() => void tick(), 5_000)
  holdBootTimer.unref()
  holdTimer = setInterval(() => void tick(), intervalMs)
  holdTimer.unref()
}

/** Clear both timers and the per-process guard (used by tests/shutdown). */
export function stopSampleHoldScheduler(): void {
  if (holdBootTimer) {
    clearTimeout(holdBootTimer)
    holdBootTimer = null
  }

  if (holdTimer) {
    clearInterval(holdTimer)
    holdTimer = null
  }

  markSchedulerStarted(false)
}

async function defaultConnect(): Promise<HoldConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()

  return {
    query: async (text, values = []) => client.query(text, values),
    end: () => client.end(),
  }
}
