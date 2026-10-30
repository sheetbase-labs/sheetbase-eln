/**
 * A backup before an upgrade changes the database. `scripts/upgrade.mjs` runs
 * this ahead of the migrations: if the build carries migrations the database
 * has not seen, every workspace gets a backup first, and the upgrade stops if
 * one cannot be made. A first install (nothing to protect) and an upgrade with
 * nothing to apply go straight through.
 */
import type { Pool } from 'pg'

import { logger } from '#/lib/logger'

import { runBackup } from './backup.server'
import type { BackupDeps } from './backup.server'

export interface MigrationJournal {
  entries: Array<{ when: number; tag: string }>
}

export type UpgradeBackupOutcome =
  | { status: 'not_needed'; reason: 'first_install' | 'up_to_date' | 'no_data' }
  | { status: 'skipped'; reason: 'no_backup_tables' }
  | { status: 'backed_up'; workspaces: number }
  | { status: 'failed'; workspaceId: string; error: string }

/**
 * How many of the journal's migrations the database has not applied yet, or
 * null when it has never been migrated (a first install).
 */
export async function pendingMigrationCount(
  pool: Pick<Pool, 'query'>,
  journal: MigrationJournal,
): Promise<number | null> {
  const table = await pool.query(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`,
  )
  if (!table.rows[0]?.present) return null
  const applied = await pool.query(
    `SELECT max(created_at)::text AS latest FROM drizzle.__drizzle_migrations`,
  )
  const latest = applied.rows[0]?.latest
  if (latest === null || latest === undefined) return null
  return journal.entries.filter((entry) => entry.when > Number(latest)).length
}

export async function backupBeforeUpgrade(
  deps: BackupDeps,
  journal: MigrationJournal,
): Promise<UpgradeBackupOutcome> {
  const pending = await pendingMigrationCount(deps.pool, journal)
  if (pending === null) return { status: 'not_needed', reason: 'first_install' }
  if (pending === 0) return { status: 'not_needed', reason: 'up_to_date' }

  // A build from before in-app backups has nothing to back up with; the
  // migrations that add them run in this same upgrade.
  const tables = await deps.pool.query(
    `SELECT to_regclass('internal.workspace_backups') IS NOT NULL AS present`,
  )
  if (!tables.rows[0]?.present) {
    return { status: 'skipped', reason: 'no_backup_tables' }
  }

  const { rows } = await deps.pool.query<{ id: string }>(
    `SELECT id::text FROM api.workspaces ORDER BY created_at`,
  )
  if (rows.length === 0) return { status: 'not_needed', reason: 'no_data' }

  logger.info('backing up before upgrade', {
    pendingMigrations: pending,
    workspaces: rows.length,
  })
  for (const { id } of rows) {
    const outcome = await runBackup(deps, {
      workspaceId: id,
      trigger: 'manual',
    })
    if (!outcome.ok) {
      const error =
        outcome.reason === 'already_running'
          ? 'another backup of this workspace is still running'
          : (outcome.backup.error ?? 'the backup failed')
      return { status: 'failed', workspaceId: id, error }
    }
  }
  return { status: 'backed_up', workspaces: rows.length }
}
