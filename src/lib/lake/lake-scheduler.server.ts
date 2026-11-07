/**
 * Open tables: the pass that keeps each enabled workspace's lake up to date.
 * Does nothing until an admin turns open tables on. Guarded like the other
 * schedulers (never started under test runners unless explicitly enabled).
 */
import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { getObjectStorage } from '../file-storage'
import { logger } from '../logger'
import { refreshWorkspaceLake } from './lake-export.server'
import type { LakeRefreshDeps } from './lake-export.server'

export const LAKE_SWEEP_INTERVAL_MS = 60_000

const running = new Set<string>()

export async function sweepLakes(
  deps: LakeRefreshDeps,
): Promise<{ workspaces: number; written: number; failed: number }> {
  const conn = await deps.connect()
  let due: Array<{ workspace_id: string; exporter_user_id: string }> = []
  try {
    due = (
      await conn.query<{ workspace_id: string; exporter_user_id: string }>(
        `SELECT workspace_id, exporter_user_id FROM internal.lake_due_workspaces()`,
      )
    ).rows
  } finally {
    await conn.end()
  }
  const total = { workspaces: 0, written: 0, failed: 0 }
  for (const row of due) {
    if (running.has(row.workspace_id)) continue
    running.add(row.workspace_id)
    try {
      const result = await refreshWorkspaceLake(deps, {
        workspaceId: row.workspace_id,
        exporterUserId: row.exporter_user_id,
      })
      total.workspaces++
      total.written += result.written
      total.failed += result.failed
    } catch (error) {
      total.failed++
      logger.warn('open tables pass failed', {
        workspaceId: row.workspace_id,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running.delete(row.workspace_id)
    }
  }
  return total
}

let timer: ReturnType<typeof setInterval> | null = null
let bootTimer: ReturnType<typeof setTimeout> | null = null
const startedGlobalKey = '__sheetbaseLakeSchedulerStarted'

function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true
  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

export function realLakeDeps(): LakeRefreshDeps {
  return {
    connect: async () => {
      const client = new PooledClient({ connectionString: env.DATABASE_URL })
      await client.connect()
      return client
    },
    storage: getObjectStorage(),
    baseUrl: env.BETTER_AUTH_URL,
  }
}

export function startLakeScheduler(
  options: { deps?: LakeRefreshDeps; intervalMs?: number } = {},
): void {
  if (typeof window !== 'undefined') return
  if (schedulerDisabled()) return
  const g = globalThis as unknown as Record<string, unknown>
  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true
  const tick = async () => {
    try {
      const result = await sweepLakes(options.deps ?? realLakeDeps())
      if (result.written || result.failed) {
        logger.info('open tables swept', result)
      }
    } catch (error) {
      logger.warn('open tables sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  bootTimer = setTimeout(() => void tick(), 20_000)
  bootTimer.unref()
  timer = setInterval(() => void tick(), options.intervalMs ?? LAKE_SWEEP_INTERVAL_MS)
  timer.unref()
}

export function stopLakeScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer)
  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
  delete (globalThis as unknown as Record<string, unknown>)[startedGlobalKey]
}
