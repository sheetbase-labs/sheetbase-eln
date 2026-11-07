/**
 * Scheduled data-contract checks.
 *
 * Every few minutes this calls `internal.sweep_contract_checks`, which runs the
 * stored-data check of each active contract whose time has come and records the
 * run (and any breach or restore event) exactly like a manual "Check now".
 * Connects with the privileged app connection, like the other schedulers; never
 * started under test runners unless `SHEETBASE_SCHEDULER_ENABLED=true`, and a
 * failed sweep is logged and never takes the server down.
 */

import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from '#/lib/logger'

export const CONTRACT_SWEEP_INTERVAL_MS = 5 * 60 * 1000
export const CONTRACT_SWEEP_BATCH_LIMIT = 20

export interface ContractSweepConnection {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Array<{ result: { checked?: number } }> }>
  end: () => Promise<void>
}

export interface ContractSweepDeps {
  connect: () => Promise<ContractSweepConnection>
}

export async function sweepContractChecks(
  deps: ContractSweepDeps,
  limit: number = CONTRACT_SWEEP_BATCH_LIMIT,
): Promise<number> {
  const conn = await deps.connect()
  try {
    const { rows } = await conn.query(
      `SELECT internal.sweep_contract_checks($1) AS result`,
      [limit],
    )
    return rows.at(0)?.result.checked ?? 0
  } finally {
    await conn.end()
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let bootTimer: ReturnType<typeof setTimeout> | null = null
const startedGlobalKey = '__sheetbaseContractSweepStarted'

function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true
  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

export function startContractScheduler(
  options: { deps?: ContractSweepDeps; intervalMs?: number } = {},
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
      const checked = await sweepContractChecks(deps)
      if (checked > 0) {
        logger.info('contract sweep complete', {
          checked,
          durationMs: Date.now() - startedAt,
        })
      }
    } catch (error) {
      logger.warn('contract sweep failed', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      })
    }
  }
  bootTimer = setTimeout(() => void tick(), 10_000)
  bootTimer.unref()
  timer = setInterval(
    () => void tick(),
    options.intervalMs ?? CONTRACT_SWEEP_INTERVAL_MS,
  )
  timer.unref()
}

export function stopContractScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer)
  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
  delete (globalThis as unknown as Record<string, unknown>)[startedGlobalKey]
}

async function defaultConnect(): Promise<ContractSweepConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()
  return {
    query: async (text, values = []) => client.query(text, values),
    end: () => client.end(),
  }
}
