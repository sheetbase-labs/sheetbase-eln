/**
 * Upgrade the database to this build: back up first, then migrate.
 *
 *   pnpm db:upgrade
 *
 * What a container runs before it serves. If this build has migrations the
 * database has not applied, every workspace is backed up to the configured
 * backup destination (Settings → Backups and export) before anything changes,
 * and the upgrade stops if a backup cannot be made, so a bad migration never
 * leaves a lab with nothing to go back to. `SHEETBASE_UPGRADE_BACKUP=off`
 * skips the backup, for a database that is backed up some other way.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { getPool } from '#/db/pool.server'
import { env } from '#/env.server'
import { backupBeforeUpgrade } from '#/lib/workspace-export/upgrade-backup.server'
import type { MigrationJournal } from '#/lib/workspace-export/upgrade-backup.server'
import { defaultBackupDeps } from '#/lib/workspace-export/backup.server'

function say(level: 'info' | 'error', message: string, extra = {}) {
  process.stdout.write(JSON.stringify({ level, message, ...extra }) + '\n')
}

if (process.env.SHEETBASE_UPGRADE_BACKUP === 'off') {
  say('info', 'upgrade backup switched off by SHEETBASE_UPGRADE_BACKUP=off')
} else {
  const journal = JSON.parse(
    readFileSync('drizzle/meta/_journal.json', 'utf8'),
  ) as MigrationJournal
  const pool = getPool(env.DATABASE_URL)
  try {
    const outcome = await backupBeforeUpgrade(defaultBackupDeps(), journal)
    if (outcome.status === 'failed') {
      say(
        'error',
        `upgrade stopped: the backup before it failed for workspace ${outcome.workspaceId} (${outcome.error}). Nothing was changed. Fix the backup destination, or set SHEETBASE_UPGRADE_BACKUP=off to upgrade without one.`,
      )
      process.exit(1)
    }
    say('info', `before upgrade: ${outcome.status}`, outcome)
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const migrate = spawnSync(process.execPath, ['scripts/migrate-once.mjs'], {
  stdio: 'inherit',
})
process.exit(migrate.status ?? 1)
