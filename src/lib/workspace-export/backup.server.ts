/**
 * Workspace backups: the same archive as the export, made by the server on a
 * schedule (or on demand), written to the backup destination, recorded in
 * `internal.workspace_backups` and pruned to the newest few.
 *
 * The destination is host-independent. By default it is wherever files are
 * kept (the database, or any S3-compatible service); `SHEETBASE_BACKUP_S3_*`
 * points it at a separate bucket, which is what protects against losing the
 * database itself.
 */
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

import { getPool } from '#/db/pool.server'
import { env } from '#/env.server'
import { backupPrefix } from '#/lib/backup'
import { getObjectStorage } from '#/lib/file-storage'
import { S3ObjectStorage } from '#/lib/file-storage/s3'
import type { ObjectStorage } from '#/lib/file-storage/types'
import { logger } from '#/lib/logger'

import {
  createWorkspaceArchive,
  defaultArchiveConnection,
} from './archive.server'
import type { ArchiveDeps } from './archive.server'
import { BACKUP_DEFAULTS, backupIsDue } from './schedule'
import type { BackupFrequency, BackupSettings } from './schedule'

/** Ceiling for one archive, so a runaway workspace cannot fill a bucket. */
export const BACKUP_MAX_BYTES = 50 * 1024 * 1024 * 1024
/** A run still marked running after this long is taken to have been interrupted. */
const STALE_RUN_MS = 6 * 60 * 60 * 1000
/** Failed attempts are kept this long so Diagnostics can show them. */
const FAILED_KEEP_DAYS = 30

export type BackupDestinationName = 'database' | 'local' | 's3'

export interface BackupDestination {
  name: BackupDestinationName
  /** True when backups sit on a separate service from the application data. */
  separate: boolean
  storage: ObjectStorage
}

export function resolveBackupDestination(): BackupDestination {
  if (env.SHEETBASE_BACKUP_S3_BUCKET) {
    return {
      name: 's3',
      separate: true,
      storage: new S3ObjectStorage({
        bucket: env.SHEETBASE_BACKUP_S3_BUCKET,
        endpoint: env.SHEETBASE_BACKUP_S3_ENDPOINT,
        region: env.SHEETBASE_BACKUP_S3_REGION,
        accessKeyId: env.SHEETBASE_BACKUP_S3_ACCESS_KEY_ID,
        secretAccessKey: env.SHEETBASE_BACKUP_S3_SECRET_ACCESS_KEY,
        pathStyle: env.SHEETBASE_BACKUP_S3_PATH_STYLE,
        prefix: env.SHEETBASE_BACKUP_S3_PREFIX,
      }),
    }
  }
  const name = env.FILE_STORAGE_BACKEND
  return { name, separate: name !== 'database', storage: getObjectStorage() }
}

export interface BackupRecord {
  id: string
  trigger: 'scheduled' | 'manual'
  status: 'running' | 'succeeded' | 'failed'
  startedAt: string
  finishedAt: string | null
  destination: string | null
  byteSize: number | null
  sha256: string | null
  tableCount: number | null
  rowCount: number | null
  fileCount: number | null
  missingFileCount: number | null
  error: string | null
}

export interface BackupDeps {
  pool: Pick<Pool, 'query'>
  archive: ArchiveDeps
  destination: BackupDestination
  now: () => Date
}

export function defaultBackupDeps(): BackupDeps {
  const destination = resolveBackupDestination()
  return {
    pool: getPool(env.DATABASE_URL),
    archive: {
      connect: defaultArchiveConnection,
      storage: getObjectStorage(),
    },
    destination,
    now: () => new Date(),
  }
}

const RECORD_COLUMNS = `id::text, trigger, status, started_at::text, finished_at::text,
  destination, byte_size::text, sha256, table_count, row_count::text, file_count,
  missing_file_count, error`

function toRecord(row: Record<string, unknown>): BackupRecord {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    id: row.id as string,
    trigger: row.trigger as BackupRecord['trigger'],
    status: row.status as BackupRecord['status'],
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
    destination: (row.destination as string | null) ?? null,
    byteSize: num(row.byte_size),
    sha256: (row.sha256 as string | null) ?? null,
    tableCount: num(row.table_count),
    rowCount: num(row.row_count),
    fileCount: num(row.file_count),
    missingFileCount: num(row.missing_file_count),
    error: (row.error as string | null) ?? null,
  }
}

export async function readBackupSettings(
  pool: Pick<Pool, 'query'>,
  workspaceId: string,
): Promise<BackupSettings> {
  const { rows } = await pool.query(
    `SELECT enabled, frequency, keep_count FROM internal.workspace_backup_settings
      WHERE workspace_id = $1::uuid`,
    [workspaceId],
  )
  const row = rows[0] as
    | { enabled: boolean; frequency: BackupFrequency; keep_count: number }
    | undefined
  return row
    ? {
        enabled: row.enabled,
        frequency: row.frequency,
        keepCount: row.keep_count,
      }
    : { ...BACKUP_DEFAULTS }
}

export async function saveBackupSettings(
  pool: Pick<Pool, 'query'>,
  workspaceId: string,
  settings: BackupSettings,
  userId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO internal.workspace_backup_settings
       (workspace_id, enabled, frequency, keep_count, updated_by_user_id)
     VALUES ($1::uuid, $2, $3, $4, $5)
     ON CONFLICT (workspace_id) DO UPDATE
       SET enabled = EXCLUDED.enabled, frequency = EXCLUDED.frequency,
           keep_count = EXCLUDED.keep_count, updated_at = now(),
           updated_by_user_id = EXCLUDED.updated_by_user_id`,
    [
      workspaceId,
      settings.enabled,
      settings.frequency,
      settings.keepCount,
      userId,
    ],
  )
}

export async function listBackups(
  pool: Pick<Pool, 'query'>,
  workspaceId: string,
  limit = 30,
): Promise<BackupRecord[]> {
  const { rows } = await pool.query(
    `SELECT ${RECORD_COLUMNS} FROM internal.workspace_backups
      WHERE workspace_id = $1::uuid ORDER BY started_at DESC LIMIT $2`,
    [workspaceId, limit],
  )
  return rows.map(toRecord)
}

export async function findBackup(
  pool: Pick<Pool, 'query'>,
  workspaceId: string,
  backupId: string,
): Promise<(BackupRecord & { storageKey: string | null }) | null> {
  const { rows } = await pool.query(
    `SELECT ${RECORD_COLUMNS}, storage_key FROM internal.workspace_backups
      WHERE workspace_id = $1::uuid AND id = $2::uuid`,
    [workspaceId, backupId],
  )
  const row = rows[0] as Record<string, unknown> | undefined
  return row
    ? {
        ...toRecord(row),
        storageKey: (row.storage_key as string | null) ?? null,
      }
    : null
}

/** The newest backup that finished, for Diagnostics. */
export async function latestBackupStatus(
  pool: Pick<Pool, 'query'>,
  workspaceId: string,
): Promise<{
  lastSucceeded: BackupRecord | null
  lastFailed: BackupRecord | null
  running: boolean
}> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (status) ${RECORD_COLUMNS}
       FROM internal.workspace_backups
      WHERE workspace_id = $1::uuid
      ORDER BY status, started_at DESC`,
    [workspaceId],
  )
  const by = new Map(
    rows.map((r) => [
      r.status as string,
      toRecord(r as Record<string, unknown>),
    ]),
  )
  const failed = by.get('failed') ?? null
  const succeeded = by.get('succeeded') ?? null
  return {
    lastSucceeded: succeeded,
    // A failure only matters while nothing newer has succeeded.
    lastFailed:
      failed && (!succeeded || failed.startedAt > succeeded.startedAt)
        ? failed
        : null,
    running: by.has('running'),
  }
}

export type BackupOutcome =
  | { ok: true; backup: BackupRecord }
  | { ok: false; reason: 'already_running' }
  | { ok: false; reason: 'failed'; backup: BackupRecord }

/**
 * Makes one backup of a workspace. Only one run per workspace at a time (a
 * unique index decides, so two replicas cannot both start one). A failure is
 * recorded with its reason and never thrown: a bad backup must not take the
 * caller down.
 */
export async function runBackup(
  deps: BackupDeps,
  input: {
    workspaceId: string
    trigger: 'scheduled' | 'manual'
    userId?: string | null
  },
): Promise<BackupOutcome> {
  const { pool, destination } = deps
  await pool.query(
    `UPDATE internal.workspace_backups
        SET status = 'failed', finished_at = now(),
            error = 'The run was interrupted before it finished.'
      WHERE workspace_id = $1::uuid AND status = 'running'
        AND started_at < now() - ($2::text || ' milliseconds')::interval`,
    [input.workspaceId, String(STALE_RUN_MS)],
  )

  const id = randomUUID()
  const startedAt = deps.now()
  const storageKey = `backups/${input.workspaceId}/${backupPrefix(startedAt)}-${id.slice(0, 8)}.zip`
  try {
    await pool.query(
      `INSERT INTO internal.workspace_backups
         (id, workspace_id, trigger, status, started_at, requested_by_user_id, destination, storage_key)
       VALUES ($1::uuid, $2::uuid, $3, 'running', $4, $5, $6, $7)`,
      [
        id,
        input.workspaceId,
        input.trigger,
        startedAt.toISOString(),
        input.userId ?? null,
        destination.name,
        storageKey,
      ],
    )
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, reason: 'already_running' }
    }
    throw error
  }

  try {
    const { stream, summary } = createWorkspaceArchive(input.workspaceId, {
      ...deps.archive,
      now: deps.now,
    })
    const [put, counts] = await Promise.all([
      destination.storage.putStream(storageKey, stream, BACKUP_MAX_BYTES),
      summary,
    ])
    await pool.query(
      `UPDATE internal.workspace_backups
          SET status = 'succeeded', finished_at = now(), byte_size = $2,
              sha256 = $3, table_count = $4, row_count = $5, file_count = $6,
              missing_file_count = $7
        WHERE id = $1::uuid`,
      [
        id,
        put.byteSize.toString(),
        put.checksum,
        counts.tableCount,
        counts.rowCount,
        counts.fileCount,
        counts.missingFileCount,
      ],
    )
    await pool.query(
      `INSERT INTO api.data_exports
         (workspace_id, object_type, object_id, format, row_count, byte_size, actor_user_id)
       VALUES ($1::uuid, 'workspace', $2::uuid, 'backup', $3, $4, $5)`,
      [
        input.workspaceId,
        id,
        Math.min(counts.rowCount, 2_147_483_647),
        put.byteSize.toString(),
        input.userId ?? null,
      ],
    )
    await pruneBackups(deps, input.workspaceId)
    const backup = (await findBackup(
      pool,
      input.workspaceId,
      id,
    )) as BackupRecord
    return { ok: true, backup }
  } catch (error) {
    await destination.storage.delete(storageKey).catch(() => undefined)
    const message = failureMessage(error)
    logger.warn('workspace backup failed', {
      workspaceId: input.workspaceId,
      error: message,
    })
    await pool.query(
      `UPDATE internal.workspace_backups
          SET status = 'failed', finished_at = now(), error = $2
        WHERE id = $1::uuid`,
      [id, message],
    )
    const backup = (await findBackup(
      pool,
      input.workspaceId,
      id,
    )) as BackupRecord
    return { ok: false, reason: 'failed', backup }
  }
}

/** A reason a person can read; never a connection string or a stack. */
function failureMessage(error: unknown): string {
  const name = (error as { name?: string }).name
  if (name === 'OversizeError') {
    return 'The workspace is larger than the backup limit.'
  }
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').slice(0, 300)
}

/** Keeps the newest `keepCount` good backups and a month of failures. */
export async function pruneBackups(
  deps: Pick<BackupDeps, 'pool' | 'destination'>,
  workspaceId: string,
): Promise<number> {
  const settings = await readBackupSettings(deps.pool, workspaceId)
  const { rows } = await deps.pool.query(
    `SELECT id::text, storage_key FROM internal.workspace_backups
      WHERE workspace_id = $1::uuid AND status = 'succeeded'
      ORDER BY started_at DESC OFFSET $2`,
    [workspaceId, settings.keepCount],
  )
  for (const row of rows as { id: string; storage_key: string | null }[]) {
    if (row.storage_key) {
      await deps.destination.storage.delete(row.storage_key)
    }
    await deps.pool.query(
      'DELETE FROM internal.workspace_backups WHERE id = $1::uuid',
      [row.id],
    )
  }
  await deps.pool.query(
    `DELETE FROM internal.workspace_backups
      WHERE workspace_id = $1::uuid AND status = 'failed'
        AND started_at < now() - ($2::text || ' days')::interval`,
    [workspaceId, String(FAILED_KEEP_DAYS)],
  )
  return rows.length
}

/**
 * One pass of the scheduler: every workspace whose backup is due gets one.
 * Runs one workspace at a time.
 */
export async function sweepBackups(
  deps: BackupDeps,
): Promise<{ checked: number; ran: number; failed: number }> {
  const { rows } = await deps.pool.query(
    `SELECT w.id::text AS id,
            coalesce(s.enabled, $1) AS enabled,
            coalesce(s.frequency, $2) AS frequency,
            coalesce(s.keep_count, $3) AS keep_count,
            (SELECT max(b.started_at) FROM internal.workspace_backups b
              WHERE b.workspace_id = w.id AND b.status = 'succeeded') AS last_succeeded,
            (SELECT max(b.started_at) FROM internal.workspace_backups b
              WHERE b.workspace_id = w.id AND b.status = 'failed') AS last_failed
       FROM api.workspaces w
       LEFT JOIN internal.workspace_backup_settings s ON s.workspace_id = w.id`,
    [
      BACKUP_DEFAULTS.enabled,
      BACKUP_DEFAULTS.frequency,
      BACKUP_DEFAULTS.keepCount,
    ],
  )
  let ran = 0
  let failed = 0
  for (const row of rows as Record<string, unknown>[]) {
    const due = backupIsDue(
      {
        enabled: row.enabled as boolean,
        frequency: row.frequency as BackupFrequency,
        keepCount: row.keep_count as number,
      },
      {
        lastSucceededAt: row.last_succeeded
          ? new Date(row.last_succeeded as string)
          : null,
        lastFailedAt: row.last_failed
          ? new Date(row.last_failed as string)
          : null,
      },
      deps.now(),
    )
    if (!due) continue
    const outcome = await runBackup(deps, {
      workspaceId: row.id as string,
      trigger: 'scheduled',
    })
    if (outcome.ok) ran += 1
    else if (outcome.reason === 'failed') failed += 1
  }
  return { checked: rows.length, ran, failed }
}
