/**
 * Put a workspace archive (a download from Settings → Backups and export, or a
 * stored backup) back into a database.
 *
 *   pnpm workspace:restore --file sheetbase-lab-20261030.zip --dry-run
 *   pnpm workspace:restore --file sheetbase-lab-20261030.zip
 *
 * Use an empty database that has been migrated to the same version, and the
 * database login that created it (restoring switches triggers off for the
 * transaction, which needs a superuser). Files go to the storage this
 * deployment is configured with. API keys, webhook secrets and sign-in
 * credentials are not in an archive: create them again. Exits non-zero on any
 * failure, and a failed restore leaves the database unchanged.
 */
import { getObjectStorage } from '#/lib/file-storage'
import { defaultArchiveConnection } from '#/lib/workspace-export/archive.server'
import { restoreWorkspaceArchive } from '#/lib/workspace-export/restore.server'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const file = flag('file')
if (!file) {
  console.error('Usage: workspace:restore --file <archive.zip> [--dry-run]')
  process.exit(2)
}

try {
  const report = await restoreWorkspaceArchive({
    zipPath: file,
    connect: defaultArchiveConnection,
    storage: getObjectStorage(),
    dryRun: process.argv.includes('--dry-run'),
  })
  const rows = report.tables.reduce((n, t) => n + t.rows, 0)
  console.log(
    `${report.dryRun ? 'Checked' : 'Restored'} workspace ${report.workspaceId}: ${rows} rows in ${report.tables.length} tables, ${report.files} files.`,
  )
  if (report.missingFiles > 0) {
    console.log(
      `${report.missingFiles} files were already missing when the archive was made.`,
    )
  }
  for (const skipped of report.skippedTables) {
    console.log(`Skipped ${skipped.name}: ${skipped.reason}`)
  }
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
