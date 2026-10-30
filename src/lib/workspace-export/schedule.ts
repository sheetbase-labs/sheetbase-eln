/**
 * When a workspace's backup is due. Pure, so the client page and the server
 * share the same wording of the rule.
 */
export type BackupFrequency = 'daily' | 'weekly'

export interface BackupSettings {
  enabled: boolean
  frequency: BackupFrequency
  /** How many good backups to keep. */
  keepCount: number
}

/** A workspace that never chose gets a daily backup, keeping the last week. */
export const BACKUP_DEFAULTS: BackupSettings = {
  enabled: true,
  frequency: 'daily',
  keepCount: 7,
}

export const KEEP_COUNT_RANGE = { min: 1, max: 90 } as const

const HOUR_MS = 60 * 60 * 1000
/** Slightly under the period, so a run is not pushed back a day by drift. */
const PERIOD_MS: Record<BackupFrequency, number> = {
  daily: 23 * HOUR_MS,
  weekly: 6 * 24 * HOUR_MS + 23 * HOUR_MS,
}
/** After a failed run, wait before trying again. */
export const RETRY_AFTER_FAILURE_MS = 6 * HOUR_MS

export function backupIsDue(
  settings: BackupSettings,
  last: { lastSucceededAt: Date | null; lastFailedAt: Date | null },
  now: Date,
): boolean {
  if (!settings.enabled) return false
  const { lastSucceededAt, lastFailedAt } = last
  if (
    lastFailedAt &&
    (!lastSucceededAt || lastFailedAt > lastSucceededAt) &&
    now.getTime() - lastFailedAt.getTime() < RETRY_AFTER_FAILURE_MS
  ) {
    return false
  }
  if (!lastSucceededAt) return true
  return (
    now.getTime() - lastSucceededAt.getTime() >= PERIOD_MS[settings.frequency]
  )
}

/** How old the newest good backup may be before Diagnostics calls it late. */
export function staleAfterMs(settings: BackupSettings): number {
  return PERIOD_MS[settings.frequency] + RETRY_AFTER_FAILURE_MS + HOUR_MS
}
