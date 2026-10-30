/**
 * SRCH-01.3 — fill in the searchable text of files uploaded before text
 * extraction covered their format.
 *
 * Every file the app can read text from has `extracted_at` set once it has been
 * looked at, whether or not any text came out of it (a scanned PDF has none).
 * The sweep takes files that were never looked at, reads each from storage and
 * stores what it finds. It is safe to run any number of times: a file is only
 * picked up while `extracted_at` is empty, and a file that fails to parse is
 * marked so it is not retried on every start. `force` reads every searchable
 * file again, for when extraction itself has improved.
 *
 * Runs once in the background shortly after the server starts, in small
 * batches, and as `scripts/backfill-file-text.ts` for a manual pass. It uses
 * the privileged app connection like the other sweeps.
 */
import { PooledClient } from '#/db/pool.server'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'
import { extractDocumentText, isSearchableMediaType } from './file-text'
import { getObjectStorage } from './file-storage'
import type { ObjectStorage } from './file-storage'
import { logger } from './logger'

export const FILE_TEXT_BACKFILL_BATCH = 25

interface FileRow extends QueryResultRow {
  id: string
  storage_key: string
  media_type: string
}

export interface BackfillConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
  end: () => Promise<void>
}

export interface BackfillResult {
  scanned: number
  stored: number
  empty: number
  failed: number
}

/** Media types the extractor reads, as a SQL list. */
const SEARCHABLE_TYPES = [
  'text/csv',
  'text/plain',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
]

/**
 * Process one batch. `after` is the last file id handled, so a forced pass
 * walks every file once instead of re-reading the same batch.
 */
export async function backfillFileTextBatch(
  conn: BackfillConnection,
  storage: ObjectStorage,
  options: { force?: boolean; after?: string; limit?: number } = {},
): Promise<BackfillResult & { last: string | null }> {
  const { rows } = await conn.query<FileRow>(
    `SELECT id, storage_key, media_type
       FROM api.file_objects
      WHERE status = 'active'
        AND media_type = ANY ($1)
        AND ($2::boolean OR extracted_at IS NULL)
        AND ($3::uuid IS NULL OR id > $3::uuid)
      ORDER BY id
      LIMIT $4`,
    [
      SEARCHABLE_TYPES,
      options.force ?? false,
      options.after ?? null,
      options.limit ?? FILE_TEXT_BACKFILL_BATCH,
    ],
  )
  const result: BackfillResult = {
    scanned: rows.length,
    stored: 0,
    empty: 0,
    failed: 0,
  }
  for (const file of rows) {
    if (!isSearchableMediaType(file.media_type)) continue
    let text: string | null = null
    try {
      const { stream } = await storage.getStream(file.storage_key)
      text = await extractDocumentText(stream, file.media_type)
    } catch (error) {
      result.failed += 1
      logger.warn('file text backfill could not read a file', {
        file_id: file.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    const found = text !== null && text.trim().length > 0
    if (text !== null) {
      if (found) result.stored += 1
      else result.empty += 1
    }
    await conn.query(
      `UPDATE api.file_objects
          SET extracted_text = CASE WHEN $2::boolean THEN $3 ELSE extracted_text END,
              extracted_at = now()
        WHERE id = $1`,
      [file.id, found, found ? text : null],
    )
  }
  return { ...result, last: rows.at(-1)?.id ?? null }
}

/** Walk every batch until none is left. */
export async function backfillFileText(
  conn: BackfillConnection,
  storage: ObjectStorage = getObjectStorage(),
  options: { force?: boolean; limit?: number } = {},
): Promise<BackfillResult> {
  const total: BackfillResult = { scanned: 0, stored: 0, empty: 0, failed: 0 }
  let after: string | undefined
  for (;;) {
    const batch = await backfillFileTextBatch(conn, storage, {
      ...options,
      after,
    })
    total.scanned += batch.scanned
    total.stored += batch.stored
    total.empty += batch.empty
    total.failed += batch.failed
    if (
      batch.last === null ||
      batch.scanned < (options.limit ?? FILE_TEXT_BACKFILL_BATCH)
    ) {
      return total
    }
    after = batch.last
  }
}

export async function connectForBackfill(): Promise<BackfillConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()
  return {
    query: async (text, values = []) => client.query(text, values),
    end: () => client.end(),
  }
}

const startedGlobalKey = '__sheetbaseFileTextBackfillStarted'

function disabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true
  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

/**
 * Run the backfill once in the background a little after start. Errors are
 * logged and never reach the server.
 */
export function startFileTextBackfill(): void {
  if (typeof window !== 'undefined') return
  if (disabled()) return
  const g = globalThis as unknown as Record<string, unknown>
  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true
  const timer = setTimeout(() => {
    void (async () => {
      const startedAt = Date.now()
      const conn = await connectForBackfill()
      try {
        const result = await backfillFileText(conn)
        if (result.scanned > 0) {
          logger.info('file text backfill complete', {
            ...result,
            durationMs: Date.now() - startedAt,
          })
        }
      } finally {
        await conn.end()
      }
    })().catch((error: unknown) => {
      logger.warn('file text backfill failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, 20_000)
  timer.unref()
}
