/**
 * Keeps a workspace's open tables up to date.
 *
 * One pass reads what the person who turned open tables on can see (model
 * views and dataset versions), writes Parquet files for whatever changed to
 * the configured file store, and records each change as a DuckLake snapshot in
 * the workspace's catalogue (see ducklake.ts). It runs off the request path,
 * from the scheduler in lake-scheduler.server.ts or when someone asks for a
 * refresh.
 *
 * Row-level security is applied at export time: every read happens as the
 * person the tables are written as, so the lake holds exactly what that person
 * can see. Anyone with a lake login reads all of it. That is why only roles
 * with data access can turn it on or hold a login.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'

import { logger } from '../logger'
import type { ObjectStorage } from '../file-storage/types'
import { commitLakeTable, dropLakeTable, lakeFileKey } from './ducklake'
import type { LakeFileEntry } from './ducklake'
import { LAKE_FILE_ROWS, writeLakeParquet } from './lake-parquet'
import type { LakeColumn, LakeType } from './lake-parquet'

export interface LakeConnection {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
}

export interface LakeRefreshDeps {
  connect: () => Promise<LakeConnection & { end: () => Promise<void> }>
  storage: ObjectStorage
  /** Public address of the app, used for the catalogue's data path. */
  baseUrl: string
}

export interface LakeRefreshResult {
  tables: number
  written: number
  retired: number
  failed: number
}

/** Rows read for one table in one pass; a bigger table is not written. */
export const LAKE_MAX_ROWS = 2_000_000
/** Dataset versions written per table per pass; the rest follow next pass. */
const VERSIONS_PER_PASS = 25
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024

interface LakeSource {
  kind: 'model_view' | 'dataset'
  /** Stable key within the workspace. */
  key: string
  label: string
  tableName: string
  /** Changes whenever the content may have changed. */
  fingerprint: string
  columns: LakeColumn[]
  labels: Array<{ key: string; label: string; unit: string | null }>
  /** Reads every row, as lists aligned with `columns`. */
  rows: () => Promise<unknown[][]>
  /** For a dataset: one entry per version, oldest first. */
  versions?: Array<{
    id: string
    label: string
    columns: LakeColumn[]
    rows: () => Promise<unknown[][]>
  }>
}

interface LakeTableRow extends QueryResultRow {
  id: string
  table_name: string
  source_kind: string
  source_key: string
  status: string
  source_fingerprint: string | null
  snapshots: Array<{ versionId: string; label: string; snapshotId: number }>
  columns: unknown
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

/** A column or table name Parquet readers and SQL both accept. */
export function lakeName(raw: string, fallback: string): string {
  const cleaned = raw
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
  const named = /^[a-z]/.test(cleaned) ? cleaned : `${fallback}_${cleaned}`
  return named.slice(0, 60) || fallback
}

function postgresType(typeName: string): LakeType {
  switch (typeName) {
    case 'bigint':
    case 'integer':
    case 'smallint':
      return 'int64'
    case 'numeric':
    case 'double precision':
    case 'real':
      return 'float64'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'timestamp with time zone':
    case 'timestamp without time zone':
      return 'timestamptz'
    default:
      return 'varchar'
  }
}

function datasetType(logicalType: string): LakeType {
  switch (logicalType) {
    case 'integer':
      return 'int64'
    case 'decimal':
      return 'float64'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'timestamp':
      return 'timestamptz'
    default:
      return 'varchar'
  }
}

/** Arrays and objects (a field that holds several values) become JSON text. */
function cell(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return JSON.stringify(value)
  }
  return value
}

async function asExporter<T>(
  conn: LakeConnection,
  workspaceId: string,
  userId: string,
  work: () => Promise<T>,
): Promise<T> {
  await conn.query('BEGIN READ ONLY')
  try {
    await conn.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({
        role: 'authenticated',
        sub: userId,
        workspace_id: workspaceId,
      }),
    ])
    const result = await work()
    await conn.query('COMMIT')
    return result
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function modelViewSources(
  conn: LakeConnection,
  workspaceId: string,
): Promise<LakeSource[]> {
  const suffix = `_${workspaceId.replaceAll('-', '').slice(-6)}`
  const views = (
    await conn.query<{ view_name: string; model_name: string }>(
      `SELECT view_name, model_name FROM internal.reporting_views
        WHERE workspace_id = $1 ORDER BY view_name`,
      [workspaceId],
    )
  ).rows
  const sources: LakeSource[] = []
  for (const view of views) {
    const columns = (
      await conn.query<{ name: string; type: string }>(
        `SELECT a.attname AS name, format_type(a.atttypid, NULL) AS type
           FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = to_regclass(format('data.%I', $1::text))
            AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum`,
        [view.view_name],
      )
    ).rows
    if (columns.length === 0) continue
    const lakeColumns: LakeColumn[] = columns.map((c) => ({
      name: c.name,
      type: postgresType(c.type),
    }))
    const base = view.view_name.endsWith(suffix)
      ? view.view_name.slice(0, -suffix.length)
      : view.view_name
    const select = columns.map((c) => `"${c.name.replaceAll('"', '""')}"`).join(', ')
    const hasUpdated = columns.some((c) => c.name === 'updated_at')
    const fingerprintSql = hasUpdated
      ? `SELECT count(*)::text AS n, coalesce(max(updated_at)::text, '') AS m FROM data."${view.view_name}"`
      : `SELECT count(*)::text AS n, '' AS m FROM data."${view.view_name}"`
    const stamp = (await conn.query<{ n: string; m: string }>(fingerprintSql))
      .rows[0]
    sources.push({
      kind: 'model_view',
      key: base,
      label: view.model_name,
      tableName: lakeName(base, 'model'),
      fingerprint: sha(
        `${stamp.n}|${stamp.m}|${columns.map((c) => `${c.name}:${c.type}`).join(',')}`,
      ),
      columns: lakeColumns,
      labels: columns.map((c) => ({ key: c.name, label: c.name, unit: null })),
      rows: async () => {
        const result = await conn.query<QueryResultRow>(
          `SELECT ${select} FROM data."${view.view_name}" LIMIT ${LAKE_MAX_ROWS + 1}`,
        )
        if (result.rows.length > LAKE_MAX_ROWS) {
          throw new Error(
            `${view.model_name} has more than ${LAKE_MAX_ROWS} rows, which is more than one pass writes`,
          )
        }
        return result.rows.map((row) =>
          columns.map((c) => cell(row[c.name])),
        )
      },
    })
  }
  return sources
}

interface DatasetVersionWire {
  id: string
  dataset_id: string
  label: string
  schema_version_id: string
  name: string
  display_id: string | null
}

async function datasetSources(
  conn: LakeConnection,
): Promise<LakeSource[]> {
  const versions = (
    await conn.query<DatasetVersionWire>(
      `SELECT v.id, v.dataset_id, v.label, v.schema_version_id, d.name, d.display_id
         FROM api.dataset_versions v
         JOIN api.datasets d ON d.id = v.dataset_id
        ORDER BY d.created_at, v.created_at, v.id`,
    )
  ).rows
  const byDataset = new Map<string, DatasetVersionWire[]>()
  for (const v of versions) {
    const list = byDataset.get(v.dataset_id) ?? []
    list.push(v)
    byDataset.set(v.dataset_id, list)
  }
  const sources: LakeSource[] = []
  for (const [datasetId, list] of byDataset) {
    const head = list[0]
    const latest = list[list.length - 1]
    const fieldsFor = async (schemaVersionId: string) => {
      const fields = (
        await conn.query<{
          field_id: string
          key: string
          label: string
          logical_type: string
          quantity: { storageUnit?: string } | null
        }>(
          `SELECT field_id, key, label, logical_type, quantity
             FROM api.dataset_schema_version_fields
            WHERE schema_version_id = $1 AND lifecycle = 'active'
            ORDER BY display_order`,
          [schemaVersionId],
        )
      ).rows
      const used = new Set(['row_id', 'row_revision'])
      return fields.map((f) => {
        let name = lakeName(f.key, 'field')
        while (used.has(name)) name = `${name}_`
        used.add(name)
        return { ...f, name }
      })
    }
    const columnsOf = (fields: Awaited<ReturnType<typeof fieldsFor>>) => [
      { name: 'row_id', type: 'varchar' as const },
      { name: 'row_revision', type: 'int64' as const },
      ...fields.map((f) => ({
        name: f.name,
        type: datasetType(f.logical_type),
      })),
    ]
    const rowsOf =
      (version: DatasetVersionWire) => async (): Promise<unknown[][]> => {
        const fields = await fieldsFor(version.schema_version_id)
        const out: unknown[][] = []
        let offset = 0
        for (;;) {
          const page = (
            await conn.query<{ page: { rows: Array<{ rowId: string; revision: number | string; values: Record<string, unknown> }>; totalCount: number } }>(
              `SELECT api.query_dataset_version_rows($1, 1000, $2) AS page`,
              [version.id, offset],
            )
          ).rows[0].page
          for (const row of page.rows) {
            out.push([
              row.rowId,
              row.revision,
              ...fields.map((f) => cell(row.values[f.field_id] ?? null)),
            ])
          }
          offset += page.rows.length
          if (offset >= page.totalCount || page.rows.length === 0) break
          if (out.length > LAKE_MAX_ROWS) {
            throw new Error(`${head.name} has more rows than one pass writes`)
          }
        }
        return out
      }
    const fields = await fieldsFor(latest.schema_version_id)
    const code = (head.display_id ?? datasetId.slice(0, 8)).toLowerCase()
    const versionList = async () => {
      const out: NonNullable<LakeSource['versions']> = []
      for (const v of list) {
        out.push({
          id: v.id,
          label: v.label,
          rows: rowsOf(v),
          columns: columnsOf(await fieldsFor(v.schema_version_id)),
        })
      }
      return out
    }
    sources.push({
      kind: 'dataset',
      key: datasetId,
      label: head.name,
      tableName: lakeName(code, 'ds'),
      fingerprint: sha(list.map((v) => v.id).join(',')),
      columns: columnsOf(fields),
      labels: [
        { key: 'row_id', label: 'Row', unit: null },
        { key: 'row_revision', label: 'Row revision', unit: null },
        ...fields.map((f) => ({
          key: f.name,
          label: f.label,
          unit: f.quantity?.storageUnit ?? null,
        })),
      ],
      rows: rowsOf(latest),
      versions: await versionList(),
    })
  }
  return sources
}

async function writeFiles(
  deps: LakeRefreshDeps,
  workspaceId: string,
  tableName: string,
  columns: LakeColumn[],
  rows: unknown[][],
): Promise<LakeFileEntry[]> {
  const files: LakeFileEntry[] = []
  const chunks: unknown[][][] = rows.length === 0 ? [[]] : []
  for (let i = 0; i < rows.length; i += LAKE_FILE_ROWS) {
    chunks.push(rows.slice(i, i + LAKE_FILE_ROWS))
  }
  for (const chunk of chunks) {
    const parquet = await writeLakeParquet(columns, chunk)
    const name = `ducklake-${randomUUID()}.parquet`
    await deps.storage.putStream(
      lakeFileKey(workspaceId, tableName, name),
      new Blob([parquet.bytes as unknown as BlobPart]).stream(),
      MAX_FILE_BYTES,
    )
    files.push({
      path: name,
      recordCount: parquet.recordCount,
      fileSizeBytes: parquet.bytes.byteLength,
      footerSize: parquet.footerSize,
      stats: parquet.stats,
    })
  }
  return files
}

/** One pass for one workspace. */
export async function refreshWorkspaceLake(
  deps: LakeRefreshDeps,
  input: { workspaceId: string; exporterUserId: string },
): Promise<LakeRefreshResult> {
  const { workspaceId, exporterUserId } = input
  const conn = await deps.connect()
  const result: LakeRefreshResult = {
    tables: 0,
    written: 0,
    retired: 0,
    failed: 0,
  }
  try {
    const dataPath = `${deps.baseUrl.replace(/\/$/, '')}/api/lake/files/${workspaceId}/`
    const schema = (
      await conn.query<{ s: string }>(
        `SELECT internal.ensure_lake_catalogue($1, $2) AS s`,
        [workspaceId, dataPath],
      )
    ).rows[0].s

    // What the exporter may see right now.
    const sources = await asExporter(conn, workspaceId, exporterUserId, async () => {
      const allowed = (
        await conn.query<{ ok: boolean }>(`SELECT api.has_data_access($1) AS ok`, [
          workspaceId,
        ])
      ).rows[0]?.ok
      if (!allowed) {
        throw new Error(
          'The person who turned on open tables no longer has data access. Turn them on again as someone who does.',
        )
      }
      return [
        ...(await modelViewSources(conn, workspaceId)),
        ...(await datasetSources(conn)),
      ]
    })

    const known = (
      await conn.query<LakeTableRow>(
        `SELECT id, table_name, source_kind, source_key, status, source_fingerprint, snapshots, columns
           FROM api.lake_tables WHERE workspace_id = $1`,
        [workspaceId],
      )
    ).rows
    const bySource = new Map(known.map((k) => [`${k.source_kind}:${k.source_key}`, k]))
    const takenNames = new Set<string>()

    for (const source of sources) {
      let tableName = source.tableName
      const knownRow = bySource.get(`${source.kind}:${source.key}`)
      if (knownRow) tableName = knownRow.table_name
      else {
        let n = 2
        while (
          takenNames.has(tableName) ||
          known.some((k) => k.table_name === tableName)
        ) {
          tableName = `${source.tableName}_${n++}`
        }
      }
      takenNames.add(tableName)
      result.tables++
      if (
        knownRow &&
        knownRow.status === 'ready' &&
        knownRow.source_fingerprint === source.fingerprint
      ) {
        continue
      }
      try {
        const written = await writeSource(deps, conn, {
          workspaceId,
          exporterUserId,
          schema,
          tableName,
          source,
          knownRow,
        })
        if (written) result.written++
      } catch (error) {
        result.failed++
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('open table failed', { workspaceId, tableName, error: message })
        await conn.query(
          `INSERT INTO api.lake_tables (workspace_id, source_kind, source_key, source_label, table_name, status, last_error)
           VALUES ($1, $2, $3, $4, $5, 'failed', $6)
           ON CONFLICT (workspace_id, table_name)
           DO UPDATE SET status = 'failed', last_error = $6, updated_at = now()`,
          [workspaceId, source.kind, source.key, source.label, tableName, message.slice(0, 500)],
        )
      }
    }

    // Tables whose source is gone, or no longer visible to the exporter.
    const live = new Set(sources.map((s) => `${s.kind}:${s.key}`))
    for (const row of known) {
      if (row.status === 'retired') continue
      if (live.has(`${row.source_kind}:${row.source_key}`)) continue
      await dropLakeTable(conn, schema, row.table_name)
      await conn.query(
        `UPDATE api.lake_tables SET status = 'retired', updated_at = now() WHERE id = $1`,
        [row.id],
      )
      result.retired++
    }
    await conn.query(`SELECT internal.record_lake_run($1, $2, $3)`, [
      workspaceId,
      result.failed > 0 ? 'partial' : 'ok',
      result.failed > 0 ? `${result.failed} table(s) could not be written` : null,
    ])
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await conn
      .query(`SELECT internal.record_lake_run($1, 'failed', $2)`, [workspaceId, message])
      .catch(() => undefined)
    throw error
  } finally {
    await conn.end()
  }
}

async function writeSource(
  deps: LakeRefreshDeps,
  conn: LakeConnection,
  input: {
    workspaceId: string
    exporterUserId: string
    schema: string
    tableName: string
    source: LakeSource
    knownRow: LakeTableRow | undefined
  },
): Promise<boolean> {
  const { workspaceId, exporterUserId, schema, tableName, source, knownRow } = input
  const author = 'Sheetbase'
  let snapshotId = 0
  let tableId = 0
  let rowCount = 0
  let byteSize = 0
  let fileCount = 0
  let columns = source.columns
  let snapshots = knownRow?.snapshots ?? []

  if (source.kind === 'dataset' && source.versions) {
    // Every dataset version is a snapshot of the table, oldest first.
    const done = new Set(snapshots.map((s) => s.versionId))
    const pending = source.versions.filter((v) => !done.has(v.id)).slice(0, VERSIONS_PER_PASS)
    for (const version of pending) {
      const rows = await asExporter(conn, workspaceId, exporterUserId, version.rows)
      const versionColumns = version.columns
      columns = versionColumns
      const files = await writeFiles(deps, workspaceId, tableName, versionColumns, rows)
      const committed = await commitLakeTable(conn, {
        schema,
        tableName,
        columns: versionColumns,
        files,
        author,
        message: `Dataset version ${version.label}`,
      })
      snapshots = [
        ...snapshots,
        { versionId: version.id, label: version.label, snapshotId: committed.snapshotId },
      ]
      snapshotId = committed.snapshotId
      tableId = committed.tableId
      rowCount = committed.rowCount
      byteSize = committed.byteSize
      fileCount = files.length
    }
    if (pending.length === 0) {
      // Nothing new; keep the fingerprint current.
      await conn.query(
        `UPDATE api.lake_tables SET source_fingerprint = $2, updated_at = now() WHERE id = $1`,
        [knownRow?.id, source.fingerprint],
      )
      return false
    }
  } else {
    const rows = await asExporter(conn, workspaceId, exporterUserId, source.rows)
    const files = await writeFiles(deps, workspaceId, tableName, source.columns, rows)
    const committed = await commitLakeTable(conn, {
      schema,
      tableName,
      columns: source.columns,
      files,
      author,
      message: `Refresh ${source.label}`,
    })
    snapshotId = committed.snapshotId
    tableId = committed.tableId
    rowCount = committed.rowCount
    byteSize = committed.byteSize
    fileCount = files.length
  }

  const upsert = await conn.query<{ id: string }>(
    `INSERT INTO api.lake_tables
       (workspace_id, source_kind, source_key, source_label, table_name, status, row_count, byte_size,
        file_count, columns, snapshots, ducklake_table_id, snapshot_id, source_fingerprint,
        last_snapshot_at, last_error)
     VALUES ($1, $2, $3, $4, $5, 'ready', $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, now(), NULL)
     ON CONFLICT (workspace_id, table_name) DO UPDATE SET
       source_label = EXCLUDED.source_label, status = 'ready', row_count = EXCLUDED.row_count,
       byte_size = EXCLUDED.byte_size, file_count = EXCLUDED.file_count, columns = EXCLUDED.columns,
       snapshots = EXCLUDED.snapshots, ducklake_table_id = EXCLUDED.ducklake_table_id,
       snapshot_id = EXCLUDED.snapshot_id, source_fingerprint = EXCLUDED.source_fingerprint,
       last_snapshot_at = now(), last_error = NULL, updated_at = now()
     RETURNING id`,
    [
      workspaceId,
      source.kind,
      source.key,
      source.label,
      tableName,
      rowCount,
      byteSize,
      fileCount,
      JSON.stringify(
        columns.map((c) => {
          const meta = source.labels.find((l) => l.key === c.name)
          return {
            name: c.name,
            type: c.type,
            label: meta?.label ?? c.name,
            unit: meta?.unit ?? null,
          }
        }),
      ),
      JSON.stringify(snapshots),
      tableId,
      snapshotId,
      // A dataset with versions still to write is looked at again next pass.
      source.kind === 'dataset' &&
      source.versions &&
      snapshots.length < source.versions.length
        ? null
        : source.fingerprint,
    ],
  )
  await conn.query(
    `SELECT internal.emit_change_event_as_actor($1, $2, 'lake_table', $3, 'update', NULL, NULL, $4::jsonb)`,
    [
      exporterUserId,
      workspaceId,
      upsert.rows[0].id,
      JSON.stringify({
        action: 'lake-table-updated',
        tableName,
        label: source.label,
        rowCount,
        snapshotId,
      }),
    ],
  )
  return true
}
