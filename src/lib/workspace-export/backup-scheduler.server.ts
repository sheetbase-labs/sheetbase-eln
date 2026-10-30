/**
 * The server's own backup schedule. Every hour it looks for workspaces whose
 * backup is due (by their frequency) and makes one. Several replicas are
 * harmless: a unique index lets only one run per workspace at a time, and the
 * second finds a fresh result and skips. Guarded like the other schedulers and
 * never started under test runners unless explicitly enabled.
 */
import { logger } from '#/lib/logger'

import { defaultBackupDeps, sweepBackups } from './backup.server'
import type { BackupDeps } from './backup.server'

export const BACKUP_SWEEP_INTERVAL_MS = 60 * 60 * 1000

export function createBackupTick(
  makeDeps: () => BackupDeps = defaultBackupDeps,
): () => Promise<void> {
  return async () => {
    const startedAt = Date.now()
    try {
      const { checked, ran, failed } = await sweepBackups(makeDeps())
      if (ran > 0 || failed > 0) {
        logger.info('workspace backups complete', {
          checked,
          ran,
          failed,
          durationMs: Date.now() - startedAt,
        })
      }
    } catch (error) {
      logger.warn('workspace backup sweep failed', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      })
    }
  }
}

let backupTimer: ReturnType<typeof setInterval> | null = null
let backupBootTimer: ReturnType<typeof setTimeout> | null = null
const startedGlobalKey = '__sheetbaseBackupSchedulerStarted'

function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true
  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

export interface StartBackupSchedulerOptions {
  makeDeps?: () => BackupDeps
  intervalMs?: number
  bootDelayMs?: number
}

export function startBackupScheduler(
  options: StartBackupSchedulerOptions = {},
): void {
  if (typeof window !== 'undefined') return
  if (schedulerDisabled()) return
  const g = globalThis as unknown as Record<string, unknown>
  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true

  const tick = createBackupTick(options.makeDeps)
  // The first pass waits a minute so a deploy's own start-up is not slowed,
  // then every hour.
  backupBootTimer = setTimeout(() => void tick(), options.bootDelayMs ?? 60_000)
  backupBootTimer.unref()
  backupTimer = setInterval(
    () => void tick(),
    options.intervalMs ?? BACKUP_SWEEP_INTERVAL_MS,
  )
  backupTimer.unref()
}

export function stopBackupScheduler(): void {
  if (backupBootTimer) {
    clearTimeout(backupBootTimer)
    backupBootTimer = null
  }
  if (backupTimer) {
    clearInterval(backupTimer)
    backupTimer = null
  }
  const g = globalThis as unknown as Record<string, unknown>
  delete g[startedGlobalKey]
}
