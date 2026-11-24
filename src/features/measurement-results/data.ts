/**
 * Reading one kind of result across datasets: the types and the two calls the
 * Results tab, the assistant and the analysis input share.
 */
import type { DataClient } from '#/lib/data-client'

export const RESULT_MODES = ['live', 'latest_snapshot'] as const

export type ResultMode = (typeof RESULT_MODES)[number]

export const RESULT_OPERATORS = ['eq', 'gt', 'gte', 'lt', 'lte'] as const

export type ResultOperator = (typeof RESULT_OPERATORS)[number]

export interface ResultFilter {
  /** A column key or field id. */
  field: string
  operator: ResultOperator
  value: string | number | boolean
}

/** What to read: all keys are optional, see `query_measurement_table_rows`. */
export interface ResultQuery {
  mode?: ResultMode
  datasets?: string[]
  /** Dataset id to the snapshot (dataset version) id to read it at. */
  pins?: Record<string, string>
  includeSubtypes?: boolean
  recordId?: string
  filters?: ResultFilter[]
  sort?: { field: string; direction: 'asc' | 'desc' }
}

export interface ResultColumn {
  fieldId: string
  key: string
  label: string
  logicalType: string
  cardinality: 'one' | 'many'
  quantity: { kind?: string; dimension?: string; storageUnit?: string } | null
  relationship: {
    target?: { kind?: string; modelKey?: string }
  } | null
}

/** One dataset (and snapshot of it, or live) a result set was read from. */
export interface ResultSource {
  datasetId: string
  displayId: string | null
  name: string
  datasetVersionId: string | null
  snapshotLabel: string | null
  live: boolean
  schemaVersion: number
  revision: number
}

export type ResultValue =
  string | number | boolean | null | readonly (string | number | boolean)[]

export interface ResultRow {
  rowId: string
  datasetId: string
  datasetDisplayId: string | null
  datasetName: string
  /** The snapshot the row was read from; null when read live. */
  datasetVersionId: string | null
  snapshotLabel: string | null
  live: boolean
  datasetRevision: number
  schemaVersion: number
  revision: number
  /** Values keyed by column key. */
  values: Record<string, ResultValue>
}

export interface ResultSet {
  tableId: string
  tableKey: string
  tableName: string
  schemaVersionId: string
  schemaVersion: number
  mode: ResultMode
  columns: ResultColumn[]
  sources: ResultSource[]
  /** Datasets left out, and why (`no_snapshot` in `latest_snapshot` mode). */
  skipped: Array<{
    datasetId: string
    displayId: string | null
    name: string
    reason: string
  }>
  offset: number
  limit: number
  totalCount: number
  hasMore: boolean
  rows: ResultRow[]
}

/** A dataset that holds the table, with the snapshots it has. */
export interface ResultDataset {
  datasetId: string
  displayId: string | null
  name: string
  tableId: string
  tableKey: string
  schemaVersion: number
  revision: number
  rowCount: number
  snapshots: Array<{
    datasetVersionId: string
    label: string
    createdAt: string
    sourceRevision: number
    rowCount: number
  }>
}

export const resultKeys = {
  all: ['measurement-results'] as const,
  sources: (tableId: string) =>
    ['measurement-results', 'sources', tableId] as const,
  rows: (tableId: string, query: ResultQuery, page: number) =>
    ['measurement-results', 'rows', tableId, query, page] as const,
}

export function queryMeasurementTableRows(
  client: DataClient,
  tableId: string,
  query: ResultQuery = {},
  limit = 200,
  offset = 0,
): Promise<ResultSet> {
  return client.rpc<ResultSet>('query_measurement_table_rows', {
    p_schema_definition_id: tableId,
    p_query: query,
    p_limit: limit,
    p_offset: offset,
  })
}

export function measurementTableSources(
  client: DataClient,
  tableId: string,
): Promise<ResultDataset[]> {
  return client.rpc<ResultDataset[]>('measurement_table_sources', {
    p_schema_definition_id: tableId,
  })
}

/** Every row of a result set, up to `max`, read a page at a time. */
export async function readAllResultRows(
  client: DataClient,
  tableId: string,
  query: ResultQuery,
  max = 50_000,
): Promise<ResultSet & { truncated: boolean }> {
  const first = await queryMeasurementTableRows(client, tableId, query, 1000, 0)
  const rows = [...first.rows]

  while (first.hasMore && rows.length < max) {
    const next = await queryMeasurementTableRows(
      client,
      tableId,
      query,
      1000,
      rows.length,
    )

    if (next.rows.length === 0 || next.totalCount !== first.totalCount) break
    rows.push(...next.rows)

    if (!next.hasMore) break
  }

  return {
    ...first,
    rows,
    hasMore: false,
    truncated: rows.length < first.totalCount,
  }
}
