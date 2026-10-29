/**
 * Move files between storage backends.
 *
 * Switching FILE_STORAGE_BACKEND only changes where new files go; files
 * uploaded earlier stay readable where they are. Run this once after a switch
 * to copy them across, then check the summary:
 *
 *   pnpm storage:copy --from database --to s3
 *   pnpm storage:copy --from database --to s3 --dry-run
 *   pnpm storage:copy --from database --to s3 --delete-source
 *
 * Backends are `database`, `local` and `s3` (set the FILE_STORAGE_S3_* values
 * first). Every copy is checked against the checksum recorded at upload. The
 * source is only emptied with --delete-source, after its copy is verified.
 * Exits non-zero if any file could not be copied.
 */
import { getPool } from '#/db/pool.server'
import { env } from '#/env.server'
import { createObjectStorage } from '#/lib/file-storage'
import type { StorageBackendName } from '#/lib/file-storage'
import { copyStoredFiles } from '#/lib/file-storage/copy'
import { FILE_MAX_BYTES } from '#/lib/file-policy'

const BACKENDS = ['database', 'local', 's3']

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const from = flag('from')
const to = flag('to')
if (!from || !to || !BACKENDS.includes(from) || !BACKENDS.includes(to)) {
  console.error(
    `Usage: storage:copy --from <${BACKENDS.join('|')}> --to <${BACKENDS.join('|')}> [--dry-run] [--delete-source]`,
  )
  process.exit(2)
}
if (from === to) {
  console.error('--from and --to are the same backend; nothing to do')
  process.exit(2)
}

const dryRun = process.argv.includes('--dry-run')
const deleteSource = process.argv.includes('--delete-source')

const pool = getPool(env.DATABASE_URL)
try {
  const { rows } = await pool.query<{
    storage_key: string
    checksum: string | null
    byte_size: string
  }>(
    `SELECT storage_key, checksum, byte_size::text
       FROM api.file_objects
      WHERE status <> 'deleted'
      ORDER BY created_at`,
  )
  console.log(
    `${dryRun ? 'Checking' : 'Copying'} ${rows.length} files from ${from} to ${to}`,
  )
  const report = await copyStoredFiles(
    rows.map((row) => ({
      storageKey: row.storage_key,
      checksum: row.checksum,
      byteSize: Number(row.byte_size),
    })),
    createObjectStorage(from as StorageBackendName),
    createObjectStorage(to as StorageBackendName),
    {
      dryRun,
      deleteSource,
      maxBytes: FILE_MAX_BYTES,
      onProgress: (line) => console.log(line),
    },
  )
  console.log(
    `${dryRun ? 'Would copy' : 'Copied'} ${report.copied}, already there ${report.alreadyThere}, ` +
      `missing from the source ${report.missingFromSource.length}, failed ${report.failed.length}`,
  )
  if (report.failed.length > 0) process.exitCode = 1
  if (report.missingFromSource.length > 0) process.exitCode = 1
} finally {
  await pool.end()
}
