/** Full database ownership/ACLs and object bytes. See docs/operations/recovery.md. */
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import type { BackupManifest } from '../src/lib/backup'
import {
  backupPrefix,
  backupManifestSchema,
  parseBackupPrefix,
  selectExpiredBackupPrefixes,
} from '../src/lib/backup'
import { atomicWrite, run, sha256File, verifyBackupSet } from './backup-io'

process.umask(0o077)
const composeProject =
  process.env.SHEETBASE_COMPOSE_PROJECT ??
  process.env.COMPOSE_PROJECT_NAME ??
  'sheetbase-deploy'
const backupDir = resolve(
  process.env.SHEETBASE_BACKUP_DIR ?? '/opt/sheetbase/backups',
)
const local = process.env.SHEETBASE_BACKUP_LOCAL === 'true'
const includeObjects = process.env.SHEETBASE_BACKUP_INCLUDE_OBJECTS !== 'false'
const retentionDays = Number(
  process.env.SHEETBASE_BACKUP_RETENTION_DAYS ?? '14',
)
const postgresImage = process.env.SHEETBASE_DRILL_IMAGE ?? 'postgres:18-alpine'
const postgresContainer = `${composeProject}-postgres-1`

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for backup`)
  return value
}

async function main(): Promise<void> {
  const postgresUser = required('POSTGRES_USER')
  const postgresDb = required('POSTGRES_DB')
  if (!Number.isInteger(retentionDays) || retentionDays < 0)
    throw new Error('invalid backup retention')
  const startedAt = new Date()
  const prefix = backupPrefix(startedAt)
  await mkdir(backupDir, { recursive: true, mode: 0o700 })
  await chmod(backupDir, 0o700)
  // Serialise the store so an older, slower run cannot replace a newer pointer.
  const lock = join(backupDir, '.backup.lock')
  await mkdir(lock, { mode: 0o700 })
  try {
    const dumpPath = join(backupDir, `${prefix}-db.sql.gz`)
    const gzip = createGzip()
    await Promise.all([
      run(
        local ? 'pg_dump' : 'docker',
        local
          ? ['-U', postgresUser, '-d', postgresDb]
          : [
              'exec',
              postgresContainer,
              'pg_dump',
              '-U',
              postgresUser,
              '-d',
              postgresDb,
            ],
        { output: gzip },
      ),
      pipeline(gzip, createWriteStream(dumpPath, { flags: 'wx', mode: 0o600 })),
    ])
    let objects: BackupManifest['objects'] = null
    if (includeObjects) {
      const objectsPath = join(backupDir, `${prefix}-objects.tar.gz`)
      if (local) {
        await run('tar', [
          '-czf',
          objectsPath,
          '-C',
          required('SHEETBASE_BACKUP_OBJECT_DIR'),
          '.',
        ])
      } else {
        // Refuse an absent volume instead of letting `docker run -v` create an empty one.
        await run('docker', [
          'volume',
          'inspect',
          `${composeProject}_object-storage`,
        ])
        await run('docker', [
          'run',
          '--rm',
          '-v',
          `${composeProject}_object-storage:/data:ro`,
          '-v',
          `${backupDir}:/backup`,
          postgresImage,
          'tar',
          'czf',
          `/backup/${prefix}-objects.tar.gz`,
          '-C',
          '/data',
          '.',
        ])
      }
      await chmod(objectsPath, 0o600)
      objects = {
        archiveBytes: (await stat(objectsPath)).size,
        archiveSha256: await sha256File(objectsPath),
      }
    }
    const finishedAt = new Date()
    const manifest = backupManifestSchema.parse({
      formatVersion: 2,
      permissions: 'preserved',
      prefix,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      database: {
        container: local ? 'local' : postgresContainer,
        database: postgresDb,
        bootstrapRole: postgresUser,
        dumpBytes: (await stat(dumpPath)).size,
        dumpSha256: await sha256File(dumpPath),
      },
      objects,
      retentionDays,
    })
    const manifestPath = join(backupDir, `${prefix}-manifest.json`)
    await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    await verifyBackupSet(manifestPath, includeObjects)
    await atomicWrite(
      join(backupDir, 'latest.json'),
      JSON.stringify({ prefix, finishedAt: manifest.finishedAt }) + '\n',
    )
    const files = await readdir(backupDir)
    for (const expired of selectExpiredBackupPrefixes(
      files,
      finishedAt,
      retentionDays,
    )) {
      for (const file of files) {
        if (
          parseBackupPrefix(file)?.prefix === expired &&
          !file.endsWith('.lock')
        )
          await rm(join(backupDir, file), { force: true })
      }
    }
    const metrics = process.env.SHEETBASE_METRICS_TEXTFILE_DIR
    if (metrics)
      await atomicWrite(
        join(metrics, 'sheetbase_backup.prom'),
        `sheetbase_backup_success_time_seconds ${Math.floor(finishedAt.getTime() / 1000)}\nsheetbase_backup_dump_bytes ${manifest.database.dumpBytes}\n`,
        0o644,
      )
    process.stdout.write(
      JSON.stringify({
        message: 'backup complete',
        manifestPath,
        prefix,
        durationMs: manifest.durationMs,
      }) + '\n',
    )
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}

main().catch(() => {
  // pg_dump/tar emit their diagnostics. Never stringify a credential-bearing environment.
  process.stderr.write(
    JSON.stringify({
      level: 'error',
      message:
        'backup failed; latest.json was not advanced unless the complete set was verified',
    }) + '\n',
  )
  process.exitCode = 1
})
