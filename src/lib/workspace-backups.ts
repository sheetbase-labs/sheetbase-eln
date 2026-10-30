/**
 * Server functions behind Settings → Backups and export: read the schedule and
 * the recent runs, change the schedule, and make a backup now. The archive
 * itself is downloaded through the byte routes in
 * `src/routes/api/export/workspace*`.
 *
 * Server-only modules are imported inside the handlers: the settings route
 * imports this file in the client bundle.
 */
import { createServerFn } from '@tanstack/react-start'

import { KEEP_COUNT_RANGE } from '#/lib/workspace-export/schedule'
import type {
  BackupFrequency,
  BackupSettings,
} from '#/lib/workspace-export/schedule'
import type { BackupRecord } from '#/lib/workspace-export/backup.server'

export interface BackupsOverview {
  settings: BackupSettings
  backups: BackupRecord[]
  /** Where backups are written, and whether that is apart from the database. */
  destination: { name: 'database' | 'local' | 's3'; separate: boolean }
}

export const fetchBackupsFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<BackupsOverview> => {
    const { requireSettingsArea } = await import('#/lib/admin-platform')
    await requireSettingsArea(data.workspaceId, 'backups')
    const { getPool } = await import('#/db/pool.server')
    const { env } = await import('#/env.server')
    const { listBackups, readBackupSettings, resolveBackupDestination } =
      await import('#/lib/workspace-export/backup.server')
    const pool = getPool(env.DATABASE_URL)
    const destination = resolveBackupDestination()
    return {
      settings: await readBackupSettings(pool, data.workspaceId),
      backups: await listBackups(pool, data.workspaceId),
      destination: { name: destination.name, separate: destination.separate },
    }
  })

export const saveBackupSettingsFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      workspaceId: string
      enabled: boolean
      frequency: string
      keepCount: number
    }) => {
      if (input.frequency !== 'daily' && input.frequency !== 'weekly') {
        throw new Error('invalid frequency')
      }
      if (
        !Number.isInteger(input.keepCount) ||
        input.keepCount < KEEP_COUNT_RANGE.min ||
        input.keepCount > KEEP_COUNT_RANGE.max
      ) {
        throw new Error('invalid number of backups to keep')
      }
      return input
    },
  )
  .handler(async ({ data }): Promise<void> => {
    const { requireSettingsArea } = await import('#/lib/admin-platform')
    const { userId } = await requireSettingsArea(
      data.workspaceId,
      'backups',
      'manage',
    )
    const { getPool } = await import('#/db/pool.server')
    const { env } = await import('#/env.server')
    const { saveBackupSettings } =
      await import('#/lib/workspace-export/backup.server')
    await saveBackupSettings(
      getPool(env.DATABASE_URL),
      data.workspaceId,
      {
        enabled: data.enabled,
        frequency: data.frequency as BackupFrequency,
        keepCount: data.keepCount,
      },
      userId,
    )
  })

export type RunBackupNowResult =
  | { ok: true; backup: BackupRecord }
  | { ok: false; reason: 'already_running' }
  | { ok: false; reason: 'failed'; message: string }

export const runBackupNowFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<RunBackupNowResult> => {
    const { requireSettingsArea } = await import('#/lib/admin-platform')
    const { userId } = await requireSettingsArea(
      data.workspaceId,
      'backups',
      'manage',
    )
    const { defaultBackupDeps, runBackup } =
      await import('#/lib/workspace-export/backup.server')
    const outcome = await runBackup(defaultBackupDeps(), {
      workspaceId: data.workspaceId,
      trigger: 'manual',
      userId,
    })
    if (outcome.ok) return { ok: true, backup: outcome.backup }
    if (outcome.reason === 'already_running') return outcome
    return {
      ok: false,
      reason: 'failed',
      message: outcome.backup.error ?? '',
    }
  })
