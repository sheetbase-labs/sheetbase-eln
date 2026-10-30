/**
 * The whole-workspace archive: one ZIP holding every row the workspace owns
 * (one JSON document per line, one file per table), every uploaded file's
 * bytes, and a manifest with a SHA-256 for each part.
 *
 * It is the same archive whether an administrator downloads it or the server
 * makes it on a schedule, and it needs nothing from the host: plain JSON, plain
 * files, a plain ZIP. All table rows are read in one repeatable-read
 * transaction, so they agree with each other; files are immutable once stored,
 * so reading them afterwards is consistent with that snapshot.
 *
 * Nothing is held in memory beyond one chunk: rows are read through a cursor,
 * files are piped through, and the output waits for its reader.
 */
import { createHash } from 'node:crypto'
import { Zip, ZipDeflate } from 'fflate'

import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { MissingStorageObjectError } from '#/lib/file-storage/types'
import type { ObjectStorage } from '#/lib/file-storage/types'

import { ByteChannel } from './byte-channel'
import { buildExportPlan, selectForTable } from './plan'
import type { CatalogForeignKey, CatalogTable, ExportPlan } from './plan'

export const ARCHIVE_FORMAT_VERSION = 1
const FETCH_ROWS = 500

export interface ArchiveConnection {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>
  end: () => Promise<void>
}

export interface ArchiveDeps {
  connect: () => Promise<ArchiveConnection>
  storage: ObjectStorage
  now?: () => Date
}

export interface ArchiveSummary {
  tableCount: number
  rowCount: number
  fileCount: number
  missingFileCount: number
}

interface ManifestTable {
  name: string
  rows: number
  /** Path inside the archive; null when the table had no rows. */
  path: string | null
  sha256: string | null
  droppedColumns: string[]
}

interface ManifestFile {
  id: string
  recordId: string | null
  name: string
  mediaType: string
  bytes: number
  sha256: string | null
  /** Where the bytes are in the archive; null when they were not found. */
  path: string | null
  status: 'ok' | 'missing' | 'checksum_mismatch'
}

export async function defaultArchiveConnection(): Promise<ArchiveConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()
  return {
    query: async (text, values = []) => client.query(text, values),
    end: () => client.end(),
  }
}

async function loadCatalog(
  conn: ArchiveConnection,
): Promise<{ tables: CatalogTable[]; foreignKeys: CatalogForeignKey[] }> {
  const tables = await conn.query(`
    SELECT n.nspname AS schema, c.relname AS name,
           array_agg(a.attname::text ORDER BY a.attnum) AS columns
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
       AND n.nspname IN ('api', 'internal')
     GROUP BY n.nspname, c.relname`)
  const foreignKeys = await conn.query(`
    SELECT ns.nspname AS schema, cl.relname AS "table",
           (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS columns,
           rns.nspname AS "refSchema", rcl.relname AS "refTable",
           (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS "refColumns"
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN pg_class rcl ON rcl.oid = con.confrelid
      JOIN pg_namespace rns ON rns.oid = rcl.relnamespace
     WHERE con.contype = 'f' AND ns.nspname IN ('api', 'internal')`)
  return {
    tables: tables.rows as unknown as CatalogTable[],
    foreignKeys: foreignKeys.rows as unknown as CatalogForeignKey[],
  }
}

const README = `Sheetbase workspace export

data/<schema>.<table>.ndjson   every row the workspace owns, one JSON document per line
files/<workspace>/<file>/<key> the bytes of every uploaded file
manifest.json                  what is in this archive, with a SHA-256 for each part

Secrets (password hashes, API keys, webhook secrets, sign-in sessions and
two-factor secrets) are never written; manifest.json lists what was left out.
`

/**
 * Writes the archive into `channel` and resolves with what it holds. The
 * caller reads `channel.stream` at the same time; failures are passed to the
 * stream and rethrown here.
 */
export async function writeWorkspaceArchive(
  workspaceId: string,
  deps: ArchiveDeps,
  channel: ByteChannel,
): Promise<ArchiveSummary> {
  const now = deps.now ?? (() => new Date())
  const pending: Uint8Array[] = []
  const zipState: { error: unknown } = { error: null }
  const zip = new Zip((err, chunk) => {
    if (err) zipState.error = err
    else pending.push(chunk)
  })
  const flush = async () => {
    if (zipState.error) throw zipState.error
    while (pending.length) await channel.push(pending.shift() as Uint8Array)
  }
  const writeEntry = async (name: string, content: Uint8Array) => {
    const entry = new ZipDeflate(name, { level: 6 })
    zip.add(entry)
    entry.push(content, true)
    await flush()
  }

  const conn = await deps.connect()
  try {
    await conn.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const catalog = await loadCatalog(conn)
    const plan: ExportPlan = buildExportPlan(
      workspaceId,
      catalog.tables,
      catalog.foreignKeys,
    )
    const workspace = (
      await conn.query(
        'SELECT id::text, name, slug FROM api.workspaces WHERE id = $1::uuid',
        [workspaceId],
      )
    ).rows.at(0)
    if (!workspace) throw new Error('workspace not found')

    const encoder = new TextEncoder()
    await writeEntry('README.txt', encoder.encode(README))

    const tables: ManifestTable[] = []
    let rowCount = 0
    for (const table of plan.tables) {
      const cursor = 'workspace_export_cursor'
      await conn.query(
        `DECLARE ${cursor} NO SCROLL CURSOR FOR ${selectForTable(table)}`,
      )
      const path = `data/${table.name}.ndjson`
      let entry: ZipDeflate | null = null
      const hash = createHash('sha256')
      let rows = 0
      try {
        for (;;) {
          if (channel.isCancelled) throw new Error('archive reader went away')
          const page = await conn.query(
            `FETCH FORWARD ${FETCH_ROWS} FROM ${cursor}`,
          )
          if (page.rows.length === 0) break
          const bytes = encoder.encode(
            page.rows.map((r) => `${r.row as string}\n`).join(''),
          )
          if (!entry) {
            entry = new ZipDeflate(path, { level: 6 })
            zip.add(entry)
          }
          hash.update(bytes)
          entry.push(bytes, false)
          rows += page.rows.length
          await flush()
        }
      } finally {
        await conn.query(`CLOSE ${cursor}`)
      }
      if (entry) {
        entry.push(new Uint8Array(0), true)
        await flush()
      }
      rowCount += rows
      tables.push({
        name: table.name,
        rows,
        path: entry ? path : null,
        sha256: entry ? hash.digest('hex') : null,
        droppedColumns: table.droppedColumns,
      })
    }

    const fileRows = (
      await conn.query(
        `SELECT id::text, record_id::text, storage_key, display_name, media_type,
                byte_size::text, checksum, checksum_algorithm
           FROM api.file_objects
          WHERE workspace_id = $1::uuid AND deleted_at IS NULL
          ORDER BY created_at, id`,
        [workspaceId],
      )
    ).rows
    const files: ManifestFile[] = []
    for (const row of fileRows) {
      const base = {
        id: row.id as string,
        recordId: (row.record_id as string | null) ?? null,
        name: row.display_name as string,
        mediaType: row.media_type as string,
        bytes: Number(row.byte_size),
      }
      let opened: Awaited<ReturnType<ObjectStorage['getStream']>>
      try {
        opened = await deps.storage.getStream(row.storage_key as string)
      } catch (error) {
        if (!(error instanceof MissingStorageObjectError)) throw error
        files.push({ ...base, sha256: null, path: null, status: 'missing' })
        continue
      }
      const path = `files/${row.storage_key as string}`
      const entry = new ZipDeflate(path, { level: 1 })
      zip.add(entry)
      const hash = createHash('sha256')
      const reader = opened.stream.getReader()
      for (;;) {
        if (channel.isCancelled) {
          await reader.cancel()
          throw new Error('archive reader went away')
        }
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        entry.push(value, false)
        await flush()
      }
      entry.push(new Uint8Array(0), true)
      await flush()
      const sha256 = hash.digest('hex')
      const recorded = row.checksum as string | null
      files.push({
        ...base,
        sha256,
        path,
        status:
          recorded && row.checksum_algorithm === 'sha256' && recorded !== sha256
            ? 'checksum_mismatch'
            : 'ok',
      })
    }

    await conn.query('COMMIT')

    const missingFileCount = files.filter((f) => f.status !== 'ok').length
    const manifest = {
      formatVersion: ARCHIVE_FORMAT_VERSION,
      kind: 'sheetbase-workspace-export',
      generatedAt: now().toISOString(),
      generator: { app: 'sheetbase', version: env.SHEETBASE_ARTIFACT_VERSION },
      workspace,
      consistency:
        'All table rows were read in one database snapshot. Files are immutable once stored and were read straight after.',
      totals: {
        tables: tables.filter((t) => t.rows > 0).length,
        rows: rowCount,
        files: files.length,
        missingFiles: missingFileCount,
      },
      tables,
      skippedTables: plan.skipped,
      files,
    }
    await writeEntry(
      'manifest.json',
      encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`),
    )
    zip.end()
    await flush()
    channel.close()
    return {
      tableCount: manifest.totals.tables,
      rowCount,
      fileCount: files.length,
      missingFileCount,
    }
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => undefined)
    channel.fail(error)
    throw error
  } finally {
    await conn.end().catch(() => undefined)
  }
}

/**
 * Starts the archive and returns its byte stream together with the promise of
 * its summary. Await the summary after the stream has been fully read.
 */
export function createWorkspaceArchive(
  workspaceId: string,
  deps: ArchiveDeps,
): { stream: ReadableStream<Uint8Array>; summary: Promise<ArchiveSummary> } {
  const channel = new ByteChannel()
  const summary = writeWorkspaceArchive(workspaceId, deps, channel)
  // The stream reports the failure to its reader; an unread summary must not
  // become an unhandled rejection.
  summary.catch(() => undefined)
  return { stream: channel.stream, summary }
}
