/**
 * PLAT-01 — Sheetbase backup runner.
 *
 * Backs up the two durable state surfaces:
 *
 *   1. PostgreSQL  — a plain-SQL `pg_dump` streamed through gzip.
 *   2. Object bytes — the object-storage volume tarred into one archive.
 *
 * One run produces a single backup *set* (`sheetbase-<UTC timestamp>-*`):
 * dump, storage archive and a manifest with sizes and sha256 checksums. A
 * `latest.json` pointer is rewritten on success so a missed or failing cron
 * backup is detectable by comparing the manifest age against the schedule.
 * Retention prunes whole sets past the window so a dump is never kept
 * without its matching object archive.
 *
 * Secrets are never written into the manifest or the dump filename.
 *
 * Usage (on the VPS, from /opt/sheetbase):
 *
 *   SHEETBASE_ENV=production pnpm backup:run
 *
 * Environment:
 *   SHEETBASE_COMPOSE_PROJECT      compose project name (default sheetbase-deploy)
 *   SHEETBASE_BACKUP_DIR           output directory (default /opt/sheetbase/backups)
 *   SHEETBASE_BACKUP_RETENTION_DAYS  prune window (default 14)
 *   SHEETBASE_BACKUP_INCLUDE_OBJECTS  set to 'false' to skip the storage archive
 *   POSTGRES_USER / POSTGRES_DB    database identity (from the secret manager)
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createGzip } from 'node:zlib'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'

import type { BackupManifest } from '../src/lib/backup'
import {
  backupPrefix,
  manifestIsComplete,
  parseBackupPrefix,
  selectExpiredBackupPrefixes,
} from '../src/lib/backup'

const composeProject =
  process.env.SHEETBASE_COMPOSE_PROJECT ?? 'sheetbase-deploy'
const backupDir = process.env.SHEETBASE_BACKUP_DIR ?? '/opt/sheetbase/backups'
const retentionDays = Number(
  process.env.SHEETBASE_BACKUP_RETENTION_DAYS ?? '14',
)
const includeObjects =
  (process.env.SHEETBASE_BACKUP_INCLUDE_OBJECTS ?? 'true') !== 'false'
const postgresImage = process.env.SHEETBASE_DRILL_IMAGE ?? 'postgres:18-alpine'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for backup`)
  return value
}

const postgresUser = requireEnv('POSTGRES_USER')
const postgresDb = requireEnv('POSTGRES_DB')
const postgresContainer = `${composeProject}-postgres-1`

function event(fields: Record<string, unknown>): void {
  process.stdout.write(
    JSON.stringify({ timestamp: new Date().toISOString(), ...fields }) + '\n',
  )
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/** Streams `pg_dump` from the postgres container into a gzipped file. */
async function dumpDatabase(target: string): Promise<void> {
  const dump = spawn(
    'docker',
    [
      'exec',
      postgresContainer,
      'pg_dump',
      '--no-owner',
      '--no-privileges',
      '-U',
      postgresUser,
      '-d',
      postgresDb,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  await new Promise<void>((resolve, reject) => {
    dump.on('error', reject)
    dump.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`pg_dump exited with status ${code}`)),
    )
    pipeline(dump.stdout, createGzip(), createWriteStream(target)).catch(reject)
  })
}

/** Tars the object-storage volume into one gzipped archive. */
async function archiveObjects(target: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tar = spawn(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${composeProject}_object-storage:/data:ro`,
        '-v',
        `${backupDir}:/backup`,
        postgresImage,
        'tar',
        'czf',
        `/backup/${target.split('/').at(-1)}`,
        '-C',
        '/data',
        '.',
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    )
    tar.on('error', reject)
    tar.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`storage archive exited with status ${code}`)),
    )
  })
}

async function main(): Promise<void> {
  const startedAt = new Date()
  const prefix = backupPrefix(startedAt)
  await mkdir(backupDir, { recursive: true })

  const dumpPath = join(backupDir, `${prefix}-db.sql.gz`)
  event({ level: 'info', message: 'backup started', prefix })

  await dumpDatabase(dumpPath)
  const dumpStat = await stat(dumpPath)

  let objects: BackupManifest['objects'] = null
  if (includeObjects) {
    const objectsPath = join(backupDir, `${prefix}-objects.tar.gz`)
    await archiveObjects(objectsPath)
    const objectsStat = await stat(objectsPath)
    objects = {
      archiveBytes: objectsStat.size,
      archiveSha256: await sha256File(objectsPath),
    }
  }

  const finishedAt = new Date()
  const manifest: BackupManifest = {
    prefix,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    database: {
      container: postgresContainer,
      database: postgresDb,
      dumpBytes: dumpStat.size,
      dumpSha256: await sha256File(dumpPath),
    },
    objects,
    retentionDays,
  }
  if (!manifestIsComplete(manifest)) {
    throw new Error('produced backup manifest is incomplete')
  }
  await writeFile(
    join(backupDir, `${prefix}-manifest.json`),
    JSON.stringify(manifest, null, 2) + '\n',
  )
  // Success pointer: its age against the schedule is the missed-backup signal.
  await writeFile(
    join(backupDir, 'latest.json'),
    JSON.stringify({ prefix, finishedAt: manifest.finishedAt }) + '\n',
  )

  // Retention: prune whole sets older than the window (newest always kept).
  const files = await readdir(backupDir)
  const expired = selectExpiredBackupPrefixes(files, finishedAt, retentionDays)
  for (const expiredPrefix of expired) {
    for (const file of files) {
      if (parseBackupPrefix(file)?.prefix === expiredPrefix) {
        await rm(join(backupDir, file), { force: true })
      }
    }
    event({
      level: 'info',
      message: 'pruned expired backup set',
      prefix: expiredPrefix,
    })
  }

  event({
    level: 'info',
    message: 'backup complete',
    prefix,
    dumpBytes: manifest.database.dumpBytes,
    objects: objects !== null,
    durationMs: manifest.durationMs,
    prunedSets: expired.length,
  })

  // Optional Prometheus textfile collector output so the documented
  // SheetbaseBackupMissing alert has a real signal when a node_exporter
  // textfile directory is configured.
  const textfileDir = process.env.SHEETBASE_METRICS_TEXTFILE_DIR
  if (textfileDir) {
    await writeFile(
      join(textfileDir, 'sheetbase_backup.prom'),
      `sheetbase_backup_success_time_seconds ${Math.floor(finishedAt.getTime() / 1000)}\n` +
        `sheetbase_backup_dump_bytes ${manifest.database.dumpBytes}\n`,
    )
  }
}

main().catch(async (error) => {
  event({
    level: 'error',
    message: 'backup failed',
    error: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
