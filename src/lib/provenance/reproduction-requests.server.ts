/**
 * Reproductions asked for by a pipeline step ("Reproduce a run"). A step can
 * only queue the request, so this picks each one up, runs it as the person
 * whose pipeline asked, and closes it with the verdict or the reason it failed.
 */
import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from '../logger'
import { reproducePipelineRun } from '../pipeline-execute.server'
import type { PipelineExecuteDeps } from '../pipeline-execute.server'

declare global {
  var __sheetbaseReproductionSchedulerStarted: unknown
}

export const REPRODUCTION_SWEEP_INTERVAL_MS = 10_000

interface RequestRow {
  id: string
  run_id: string
  requested_by_user_id: string
}

export interface ReproductionSweepDeps {
  exec: PipelineExecuteDeps
  connect: () => Promise<{
    query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>
    end: () => Promise<void>
  }>
  reproduce?: typeof reproducePipelineRun
}

/** Claim and run what is waiting. Returns how many were handled. */
export async function sweepReproductionRequests(
  deps: ReproductionSweepDeps,
): Promise<number> {
  const conn = await deps.connect()
  const run = deps.reproduce ?? reproducePipelineRun
  let handled = 0

  try {
    for (let i = 0; i < 5; i++) {
      // Claim one at a time so two servers never run the same request.
      const { rows } = await conn.query<RequestRow>(
        `UPDATE api.pipeline_reproduction_requests r
            SET status = 'running'
          WHERE r.id = (
            SELECT id FROM api.pipeline_reproduction_requests
             WHERE status = 'pending' ORDER BY created_at
             FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING r.id, r.run_id, r.requested_by_user_id`,
      )

      const request = rows.at(0)

      if (!request) break
      let reproductionId: string | null = null
      let error: string | null = null

      try {
        const report = await run(
          request.requested_by_user_id,
          { runId: request.run_id },
          deps.exec,
        )

        reproductionId = report.reproduction?.id ?? null

        if (!report.ok)
          error = report.errorMessage ?? 'The run could not be reproduced.'
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }

      await conn.query(
        `SELECT internal.pipeline_reproduction_request_handled($1::uuid, $2::uuid, $3)`,
        [request.id, reproductionId, error],
      )
      handled++
    }
  } finally {
    await conn.end()
  }

  return handled
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false
const startedKey = '__sheetbaseReproductionSchedulerStarted'

function disabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true

  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

export function startReproductionScheduler(): void {
  if (typeof window !== 'undefined' || disabled()) return

  if (globalThis[startedKey]) return
  globalThis[startedKey] = true

  const open = async () => {
    const client = new PooledClient({ connectionString: env.DATABASE_URL })
    await client.connect()

    return client
  }

  const exec: PipelineExecuteDeps = {
    getSession: async () => null,
    async connect() {
      const client = new PooledClient({
        connectionString: env.DATABASE_URL,
        query_timeout: 30_000,
      })

      await client.connect()

      return {
        query: async (text, values = []) => client.query(text, values),
        begin: () => client.query('BEGIN').then(() => undefined),
        commit: () => client.query('COMMIT').then(() => undefined),
        rollback: () => client.query('ROLLBACK').then(() => undefined),
        end: () => client.end(),
      }
    },
  }

  const tick = async () => {
    if (running) return
    running = true

    try {
      await sweepReproductionRequests({ exec, connect: open })
    } catch (error) {
      logger.warn('reproduction sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }

  timer = setInterval(() => void tick(), REPRODUCTION_SWEEP_INTERVAL_MS)
  timer.unref()
}

export function stopReproductionScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
  delete globalThis[startedKey]
}
