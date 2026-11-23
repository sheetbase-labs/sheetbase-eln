/**
 * DSET-04.2 — scheduled Dataset snapshot retention sweep (server-side).
 *
 * Periodically calls `api.prune_dataset_versions(p_limit)` to remove the row
 * data of eligible archived snapshots: uncited, past the workspace's retention
 * period, with no manual keep and not cited by signed evidence. The snapshot's
 * identity, hash and history are kept; the RPC records the removal and emits a
 * change event.
 *
 * The RPC is `SECURITY DEFINER` and its `EXECUTE` grant is revoked from
 * PUBLIC/anon/authenticated/api_client (former migration 0191),
 * so the job connects with `env.DATABASE_URL` — the same privileged bootstrap
 * connection the pipeline scheduler uses. No migration or extra credential is
 * needed.
 *
 * It runs on `background-sweep.server.ts`, and every sweep failure is
 * swallowed and logged so a bad retention run can never take the server down.
 */
import { PooledClient } from '#/db/pool.server'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'
import { logger } from './logger'
import { createBackgroundSweep } from './background-sweep.server'

/** Retention changes are year-scale; a few hours of latency is irrelevant. */
export const DATASET_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Bounded batch per sweep, within the RPC's 1..1000 validated range. */
export const DATASET_PRUNE_BATCH_LIMIT = 100

interface QueryResult<T extends QueryResultRow> {
  rows: T[]
}

export interface RetentionConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<T>>
  end: () => Promise<void>
}

export interface DatasetRetentionDeps {
  connect: () => Promise<RetentionConnection>
}

interface PruneRow extends QueryResultRow {
  result: {
    prunedCount: number
    pruned: Array<{ datasetVersionId: string; rowsRemoved: number }>
  }
}

/** The structured fields a retention log line carries. */
type RetentionLogFields = Record<string, string | number>

/** Structured log sink, injectable for unit tests. */
export interface RetentionLog {
  info: (message: string, fields: RetentionLogFields) => void
  warn: (message: string, fields: RetentionLogFields) => void
}

const defaultLog: RetentionLog = {
  info: (message, fields) => logger.info(message, fields),
  warn: (message, fields) => logger.warn(message, fields),
}

/**
 * Run one retention sweep: call the prune RPC with the bounded batch limit and
 * return the number of snapshots whose rows were removed. This does not catch;
 * the driver below owns failure handling so a sweep error is logged and the
 * interval keeps running.
 */
export async function sweepDatasetRetention(
  deps: DatasetRetentionDeps,
  limit: number = DATASET_PRUNE_BATCH_LIMIT,
): Promise<number> {
  const conn = await deps.connect()

  try {
    const { rows } = await conn.query<PruneRow>(
      `SELECT api.prune_dataset_versions($1) AS result`,
      [limit],
    )

    return rows.at(0)?.result.prunedCount ?? 0
  } finally {
    await conn.end()
  }
}

/**
 * Build the per-interval tick. Success logs a bounded metric line; failure is
 * swallowed and logged so the caller's interval is never broken by a throw.
 */
export function createDatasetRetentionTick(
  deps: DatasetRetentionDeps,
  limit: number = DATASET_PRUNE_BATCH_LIMIT,
  log: RetentionLog = defaultLog,
): () => Promise<void> {
  return async () => {
    const startedAt = Date.now()

    try {
      const prunedCount = await sweepDatasetRetention(deps, limit)
      log.info('dataset retention sweep complete', {
        prunedCount,
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      log.warn('dataset retention sweep failed', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      })
    }
  }
}

const retentionSweep = createBackgroundSweep('dataset-retention')

export interface StartDatasetRetentionOptions {
  deps?: DatasetRetentionDeps
  intervalMs?: number
  log?: RetentionLog
}

export function startDatasetRetentionScheduler(
  options: StartDatasetRetentionOptions = {},
): void {
  const deps = options.deps ?? { connect: defaultConnect }
  const intervalMs = options.intervalMs ?? DATASET_RETENTION_INTERVAL_MS

  retentionSweep.start(
    createDatasetRetentionTick(deps, DATASET_PRUNE_BATCH_LIMIT, options.log),
    intervalMs,
  )
}

/** Clear both timers and the per-process guard (used by tests/shutdown). */
export function stopDatasetRetentionScheduler(): void {
  retentionSweep.stop()
}

async function defaultConnect(): Promise<RetentionConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()

  return {
    query: async (text, values = []) => client.query(text, values),
    end: () => client.end(),
  }
}
