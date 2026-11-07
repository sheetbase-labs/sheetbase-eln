/**
 * Writes a DuckLake catalogue (format 1.1) for the open tables.
 *
 * DuckLake keeps the description of a lakehouse in ordinary SQL tables: which
 * tables exist, their columns, which Parquet files hold their rows, and which
 * snapshot each change belongs to. Sheetbase keeps that catalogue in Postgres
 * (one schema per workspace, made by internal.ensure_lake_catalogue) and the
 * Parquet files on the configured file store, so DuckDB's `ducklake` extension
 * attaches to it directly. A refresh of a table is one snapshot: the previous
 * files stop being current (they stay for time travel) and the new files begin.
 *
 * Only the parts of the format the app needs are written: one schema, tables
 * with flat columns, whole-file replacement, no deletes, partitions or inlined
 * data. The tests read what this writes back with DuckDB itself.
 */
import type { QueryResultRow } from 'pg'

import type { LakeColumn, LakeColumnStats } from './lake-parquet'

export interface LakeQueryable {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
}

export interface LakeFileEntry {
  /** Relative to the table folder, e.g. `ducklake-<uuid>.parquet`. */
  path: string
  recordCount: number
  fileSizeBytes: number
  footerSize: number
  stats: LakeColumnStats[]
}

export interface LakeCommit {
  schema: string
  tableName: string
  columns: LakeColumn[]
  files: LakeFileEntry[]
  author: string
  message: string
}

export interface LakeCommitResult {
  snapshotId: number
  tableId: number
  /** True when the table was made (or remade after a column change). */
  created: boolean
  rowCount: number
  byteSize: number
}

const ident = (name: string): string => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`unsafe lake identifier: ${name}`)
  }
  return `"${name}"`
}

/** Where the file of a table lives under the catalogue's data path. */
export function lakeFileKey(
  workspaceId: string,
  tableName: string,
  file: string,
): string {
  return `lake/${workspaceId}/main/${tableName}/${file}`
}

/** Writes one snapshot that makes `files` the current content of the table. */
export async function commitLakeTable(
  conn: LakeQueryable,
  commit: LakeCommit,
): Promise<LakeCommitResult> {
  const s = ident(commit.schema)
  const q = <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => conn.query<T>(text, values)

  await q('BEGIN')
  try {
    // One writer at a time per catalogue.
    await q(`SELECT pg_advisory_xact_lock(hashtextextended($1, 1))`, [
      commit.schema,
    ])
    const last = (
      await q<{
        snapshot_id: string
        schema_version: string
        next_catalog_id: string
        next_file_id: string
      }>(
        `SELECT snapshot_id, schema_version, next_catalog_id, next_file_id
           FROM ${s}.ducklake_snapshot ORDER BY snapshot_id DESC LIMIT 1`,
      )
    ).rows.at(0)
    if (!last) throw new Error('the lake catalogue has no first snapshot')
    const snapshot = Number(last.snapshot_id) + 1
    let schemaVersion = Number(last.schema_version)
    let nextCatalog = Number(last.next_catalog_id)
    let nextFile = Number(last.next_file_id)

    const existing = (
      await q<{ table_id: string }>(
        `SELECT table_id FROM ${s}.ducklake_table
          WHERE schema_id = 0 AND table_name = $1 AND end_snapshot IS NULL`,
        [commit.tableName],
      )
    ).rows.at(0)

    let tableId: number
    let created = false
    let sameShape = false
    if (existing) {
      tableId = Number(existing.table_id)
      const current = (
        await q<{ column_name: string; column_type: string }>(
          `SELECT column_name, column_type FROM ${s}.ducklake_column
            WHERE table_id = $1 AND end_snapshot IS NULL ORDER BY column_order`,
          [tableId],
        )
      ).rows
      sameShape =
        current.length === commit.columns.length &&
        current.every(
          (c, i) =>
            c.column_name === commit.columns[i].name &&
            c.column_type === commit.columns[i].type,
        )
    } else {
      tableId = 0
    }

    const changes: string[] = []
    let rowIdStart = 0
    if (existing && sameShape) {
      // The old files stop being current but stay for time travel.
      await q(
        `UPDATE ${s}.ducklake_data_file SET end_snapshot = $1
          WHERE table_id = $2 AND end_snapshot IS NULL`,
        [snapshot, tableId],
      )
      const stats = (
        await q<{ next_row_id: string }>(
          `SELECT next_row_id FROM ${s}.ducklake_table_stats WHERE table_id = $1`,
          [tableId],
        )
      ).rows.at(0)
      rowIdStart = stats ? Number(stats.next_row_id) : 0
      await q(`DELETE FROM ${s}.ducklake_table_stats WHERE table_id = $1`, [
        tableId,
      ])
      await q(
        `DELETE FROM ${s}.ducklake_table_column_stats WHERE table_id = $1`,
        [tableId],
      )
      changes.push(`deleted_from_table:${tableId}`)
    } else {
      if (existing) {
        // The columns changed: the old table ends and a new one begins.
        await q(
          `UPDATE ${s}.ducklake_table SET end_snapshot = $1 WHERE table_id = $2`,
          [snapshot, tableId],
        )
        await q(
          `UPDATE ${s}.ducklake_column SET end_snapshot = $1
            WHERE table_id = $2 AND end_snapshot IS NULL`,
          [snapshot, tableId],
        )
        await q(
          `UPDATE ${s}.ducklake_data_file SET end_snapshot = $1
            WHERE table_id = $2 AND end_snapshot IS NULL`,
          [snapshot, tableId],
        )
        await q(`DELETE FROM ${s}.ducklake_table_stats WHERE table_id = $1`, [
          tableId,
        ])
        await q(
          `DELETE FROM ${s}.ducklake_table_column_stats WHERE table_id = $1`,
          [tableId],
        )
        changes.push(`dropped_table:${tableId}`)
      }
      tableId = nextCatalog++
      created = true
      schemaVersion += 1
      await q(
        `INSERT INTO ${s}.ducklake_table
           (table_id, table_uuid, begin_snapshot, end_snapshot, schema_id, table_name, path, path_is_relative)
         VALUES ($1, gen_random_uuid(), $2, NULL, 0, $3, $4, true)`,
        [tableId, snapshot, commit.tableName, `${commit.tableName}/`],
      )
      for (const [i, column] of commit.columns.entries()) {
        await q(
          `INSERT INTO ${s}.ducklake_column
             (column_id, begin_snapshot, end_snapshot, table_id, column_order, column_name, column_type,
              initial_default, default_value, nulls_allowed, parent_column, default_value_type, default_value_dialect)
           VALUES ($1, $2, NULL, $3, $4, $5, $6, NULL, 'NULL', true, NULL, 'literal', 'duckdb')`,
          [i + 1, snapshot, tableId, i + 1, column.name, column.type],
        )
      }
      await q(
        `INSERT INTO ${s}.ducklake_schema_versions (begin_snapshot, schema_version, table_id)
         VALUES ($1, $2, $3)`,
        [snapshot, schemaVersion, tableId],
      )
      changes.push(`created_table:"main"."${commit.tableName}"`)
    }

    let rowCount = 0
    let byteSize = 0
    const bounds = commit.columns.map(() => ({
      min: null as string | null,
      max: null as string | null,
      nulls: false,
      nan: null as boolean | null,
      unbounded: false,
    }))
    for (const [order, file] of commit.files.entries()) {
      const fileId = nextFile++
      await q(
        `INSERT INTO ${s}.ducklake_data_file
           (data_file_id, table_id, begin_snapshot, end_snapshot, file_order, path, path_is_relative,
            file_format, record_count, file_size_bytes, footer_size, row_id_start, partition_id,
            encryption_key, mapping_id, partial_max, row_group_count)
         VALUES ($1, $2, $3, NULL, $4, $5, true, 'parquet', $6, $7, $8, $9, NULL, NULL, NULL, NULL, 1)`,
        [
          fileId,
          tableId,
          snapshot,
          order,
          file.path,
          file.recordCount,
          file.fileSizeBytes,
          file.footerSize,
          rowIdStart + rowCount,
        ],
      )
      for (const [i, st] of file.stats.entries()) {
        await q(
          `INSERT INTO ${s}.ducklake_file_column_stats
             (data_file_id, table_id, column_id, column_size_bytes, value_count, null_count,
              min_value, max_value, contains_nan, extra_stats, min_is_exact, max_is_exact)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $10)`,
          [
            fileId,
            tableId,
            i + 1,
            Math.round(file.fileSizeBytes / Math.max(commit.columns.length, 1)),
            st.valueCount,
            st.nullCount,
            st.min,
            st.max,
            st.containsNaN,
            st.min !== null,
          ],
        )
        const b = bounds[i]
        if (st.nullCount > 0) b.nulls = true
        if (st.containsNaN) b.nan = true
        else if (b.nan === null && st.containsNaN === false) b.nan = false
        if (st.valueCount > 0 && (st.min === null || st.max === null)) {
          b.unbounded = true
        } else if (st.min !== null && st.max !== null) {
          const type = commit.columns[i].type
          const lt = (a: string, c: string) =>
            type === 'int64' || type === 'float64' || type === 'boolean'
              ? Number(a) < Number(c)
              : a < c
          if (b.min === null || lt(st.min, b.min)) b.min = st.min
          if (b.max === null || lt(b.max, st.max)) b.max = st.max
        }
      }
      rowCount += file.recordCount
      byteSize += file.fileSizeBytes
    }
    changes.push(`inserted_into_table:${tableId}`)

    await q(
      `INSERT INTO ${s}.ducklake_table_stats (table_id, record_count, next_row_id, file_size_bytes)
       VALUES ($1, $2, $3, $4)`,
      [tableId, rowCount, rowIdStart + rowCount, byteSize],
    )
    for (const [i, b] of bounds.entries()) {
      await q(
        `INSERT INTO ${s}.ducklake_table_column_stats
           (table_id, column_id, contains_null, contains_nan, min_value, max_value, extra_stats, min_is_exact, max_is_exact)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $7)`,
        [
          tableId,
          i + 1,
          b.nulls,
          b.nan,
          b.unbounded ? null : b.min,
          b.unbounded ? null : b.max,
          !b.unbounded && b.min !== null,
        ],
      )
    }

    await q(
      `INSERT INTO ${s}.ducklake_snapshot
         (snapshot_id, snapshot_time, schema_version, next_catalog_id, next_file_id)
       VALUES ($1, now(), $2, $3, $4)`,
      [snapshot, schemaVersion, nextCatalog, nextFile],
    )
    await q(
      `INSERT INTO ${s}.ducklake_snapshot_changes
         (snapshot_id, changes_made, author, commit_message, commit_extra_info)
       VALUES ($1, $2, $3, $4, NULL)`,
      [snapshot, changes.join(','), commit.author, commit.message],
    )
    await q('COMMIT')
    return { snapshotId: snapshot, tableId, created, rowCount, byteSize }
  } catch (error) {
    await q('ROLLBACK').catch(() => undefined)
    throw error
  }
}

/** Takes a table out of the lake: it ends in a new snapshot, files stay. */
export async function dropLakeTable(
  conn: LakeQueryable,
  schema: string,
  tableName: string,
): Promise<void> {
  const s = ident(schema)
  await conn.query('BEGIN')
  try {
    await conn.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 1))`, [
      schema,
    ])
    const found = (
      await conn.query<{ table_id: string }>(
        `SELECT table_id FROM ${s}.ducklake_table
          WHERE schema_id = 0 AND table_name = $1 AND end_snapshot IS NULL`,
        [tableName],
      )
    ).rows.at(0)
    if (!found) {
      await conn.query('COMMIT')
      return
    }
    const last = (
      await conn.query<{
        snapshot_id: string
        schema_version: string
        next_catalog_id: string
        next_file_id: string
      }>(
        `SELECT snapshot_id, schema_version, next_catalog_id, next_file_id
           FROM ${s}.ducklake_snapshot ORDER BY snapshot_id DESC LIMIT 1`,
      )
    ).rows.at(0)
    if (!last) throw new Error('the lake catalogue has no first snapshot')
    const snapshot = Number(last.snapshot_id) + 1
    const tableId = Number(found.table_id)
    await conn.query(
      `UPDATE ${s}.ducklake_table SET end_snapshot = $1 WHERE table_id = $2`,
      [snapshot, tableId],
    )
    await conn.query(
      `UPDATE ${s}.ducklake_column SET end_snapshot = $1 WHERE table_id = $2 AND end_snapshot IS NULL`,
      [snapshot, tableId],
    )
    await conn.query(
      `UPDATE ${s}.ducklake_data_file SET end_snapshot = $1 WHERE table_id = $2 AND end_snapshot IS NULL`,
      [snapshot, tableId],
    )
    await conn.query(
      `DELETE FROM ${s}.ducklake_table_stats WHERE table_id = $1`,
      [tableId],
    )
    await conn.query(
      `DELETE FROM ${s}.ducklake_table_column_stats WHERE table_id = $1`,
      [tableId],
    )
    const schemaVersion = Number(last.schema_version) + 1
    await conn.query(
      `INSERT INTO ${s}.ducklake_schema_versions (begin_snapshot, schema_version, table_id)
       VALUES ($1, $2, $3)`,
      [snapshot, schemaVersion, tableId],
    )
    await conn.query(
      `INSERT INTO ${s}.ducklake_snapshot VALUES ($1, now(), $2, $3, $4)`,
      [snapshot, schemaVersion, last.next_catalog_id, last.next_file_id],
    )
    await conn.query(
      `INSERT INTO ${s}.ducklake_snapshot_changes VALUES ($1, $2, 'Sheetbase', 'Table left the lake', NULL)`,
      [snapshot, `dropped_table:${tableId}`],
    )
    await conn.query('COMMIT')
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}
