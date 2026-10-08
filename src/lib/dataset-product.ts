/**
 * PC-02 — Dataset product helpers over CORE-02 RPCs and catalogue DML.
 *
 * Row writes go through `commit_dataset_row_batch` / `validate_dataset_row_batch`.
 * Catalogue create uses the existing `api.datasets` insert path (there is no
 * `create_dataset` RPC). Snapshots, archive/restore, historical query and
 * dependency inspection reuse the Core RPCs.
 */
import type { DataClient } from './data-client'
import { discoverObjectDependencies } from './object-dependencies'
import type { ObjectDependency } from './object-dependencies'
import type { CanonicalDatasetWire } from './dataset-explorer-data'
import type { CanonicalDatasetSchemaField } from './dataset-schema-definition-rpc'
import type { ScientificColumnWire } from './scientific-sheet-data'

export interface PublishedSchemaOption {
  schemaDefinitionId: string
  schemaVersionId: string
  key: string
  name: string
  description: string | null
  version: number
}

interface SchemaDefinitionWire {
  id: string
  key: string
  name: string
  description: string | null
  lifecycle: string
}

interface SchemaVersionWire {
  id: string
  schema_id: string
  version: number
  lifecycle: string
  published_at: string | null
}

export interface DatasetVersionWire {
  id: string
  dataset_id: string
  workspace_id: string
  schema_version_id: string
  source_dataset_revision: number | string
  label: string
  created_at: string
  created_by_user_id: string | null
}

export interface DatasetCommitRow {
  operation: 'create' | 'update'
  rowId: string
  expectedRevision?: number
  values: Record<string, unknown>
  /** Captured with the successful canonical cell write, not supplied to History later. */
  reason?: string
  /**
   * DSET-01.3 — optional sample/well key for creates. A matching active
   * planned row in the same Dataset is filled (planned→recorded) instead of a
   * new row being inserted. Rejected on updates.
   */
  plannedKey?: string
}

export interface DatasetCommitResult {
  ok: boolean
  datasetId?: string
  datasetRevision?: number
  idempotent?: boolean
  rows?: Array<{ rowId: string; revision: number; operation: string }>
  sourceEvents?: Array<{ recordId: string | null; sourceEventId: string }>
  errors?: Array<{
    rowIndex?: number
    rowId?: string
    fieldId?: string
    code: string
  }>
}

export interface DatasetVersionRowPage {
  datasetVersionId: string
  datasetId: string
  schemaVersionId: string
  sourceDatasetRevision: number
  totalCount: number
  rows: Array<{
    rowId: string
    revision: number
    values: Record<string, unknown>
  }>
}

export async function listPublishedDatasetSchemas(
  client: DataClient,
): Promise<PublishedSchemaOption[]> {
  const [definitions, versions] = await Promise.all([
    client.list<SchemaDefinitionWire>(
      'dataset_schema_definitions',
      '?lifecycle=eq.active&select=id,key,name,description,lifecycle&order=name.asc',
    ),
    client.list<SchemaVersionWire>(
      'dataset_schema_versions',
      '?lifecycle=eq.active&select=id,schema_id,version,lifecycle,published_at&order=version.desc',
    ),
  ])
  const definitionById = new Map(definitions.map((item) => [item.id, item]))
  const latestBySchema = new Map<string, SchemaVersionWire>()
  for (const version of versions) {
    if (!latestBySchema.has(version.schema_id)) {
      latestBySchema.set(version.schema_id, version)
    }
  }
  return [...latestBySchema.values()].flatMap((version) => {
    const definition = definitionById.get(version.schema_id)
    if (!definition) return []
    return [
      {
        schemaDefinitionId: definition.id,
        schemaVersionId: version.id,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        version: version.version,
      },
    ]
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function firstRow<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value
}

export async function createDataset(
  client: DataClient,
  input: {
    workspaceId: string
    schemaVersionId: string
    name: string
    description?: string | null
    primaryProjectId?: string | null
  },
): Promise<{ id: string; revision: number; name: string }> {
  const created = firstRow(
    await client.insert<Record<string, unknown> | Record<string, unknown>[]>(
      'datasets',
      {
        workspace_id: input.workspaceId,
        schema_version_id: input.schemaVersionId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        primary_project_id: input.primaryProjectId ?? null,
      },
    ),
  )
  const row = asRecord(created)
  if (!row || typeof row.id !== 'string') {
    throw new Error('Dataset create did not return an id')
  }
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : input.name,
    revision: Number(row.revision ?? 1),
  }
}

export async function snapshotDataset(
  client: DataClient,
  input: { datasetId: string; expectedRevision: number; label: string },
): Promise<DatasetVersionWire> {
  return client.rpc('snapshot_dataset', {
    p_dataset_id: input.datasetId,
    p_expected_dataset_revision: input.expectedRevision,
    p_label: input.label.trim(),
  })
}

export async function archiveDataset(
  client: DataClient,
  input: { datasetId: string; expectedRevision: number },
): Promise<{ id: string; lifecycle: string; revision: number }> {
  return client.rpc('archive_dataset', {
    p_dataset_id: input.datasetId,
    p_expected_revision: input.expectedRevision,
  })
}

export async function restoreDataset(
  client: DataClient,
  input: { datasetId: string; expectedRevision: number },
): Promise<{ id: string; lifecycle: string; revision: number }> {
  return client.rpc('restore_dataset', {
    p_dataset_id: input.datasetId,
    p_expected_revision: input.expectedRevision,
  })
}

export async function validateDatasetRowBatch(
  client: DataClient,
  input: {
    datasetId: string
    expectedRevision: number
    rows: DatasetCommitRow[]
  },
): Promise<DatasetCommitResult> {
  return client.rpc('validate_dataset_row_batch', {
    p_dataset_id: input.datasetId,
    p_expected_dataset_revision: input.expectedRevision,
    p_rows: input.rows,
  })
}

export async function commitDatasetRowBatch(
  client: DataClient,
  input: {
    datasetId: string
    expectedRevision: number
    rows: DatasetCommitRow[]
    idempotencyKey: string
  },
): Promise<DatasetCommitResult> {
  return client.rpc('commit_dataset_row_batch', {
    p_dataset_id: input.datasetId,
    p_expected_dataset_revision: input.expectedRevision,
    p_rows: input.rows,
    p_idempotency_key: input.idempotencyKey,
  })
}

/**
 * PLAT-05 — atomic all-or-nothing Dataset commit. Runs every canonical
 * ≤1000-row chunk inside one database transaction, so a failure in any chunk
 * rolls back every earlier chunk (no partial scientific imports). Accepts up
 * to 100,000 rows. Canonical validation/revision/idempotency semantics are
 * unchanged (the chunks execute the existing governed RPC).
 */
export async function commitDatasetRowBatchAtomic(
  client: DataClient,
  input: {
    datasetId: string
    expectedRevision: number
    rows: DatasetCommitRow[]
    idempotencyKey: string
  },
): Promise<DatasetCommitResult> {
  return client.rpc('commit_dataset_row_batch_atomic', {
    p_dataset_id: input.datasetId,
    p_expected_dataset_revision: input.expectedRevision,
    p_rows: input.rows,
    p_idempotency_key: input.idempotencyKey,
  })
}

export async function listDatasetVersions(
  client: DataClient,
  datasetId: string,
): Promise<DatasetVersionWire[]> {
  return client.list(
    'dataset_versions',
    `?dataset_id=eq.${encodeURIComponent(datasetId)}&order=created_at.desc`,
  )
}

export async function queryDatasetVersionRows(
  client: DataClient,
  datasetVersionId: string,
  limit = 200,
  offset = 0,
): Promise<DatasetVersionRowPage> {
  return client.rpc('query_dataset_version_rows', {
    p_dataset_version_id: datasetVersionId,
    p_limit: limit,
    p_offset: offset,
  })
}

export async function fetchDatasetDependencies(
  client: DataClient,
  datasetId: string,
): Promise<ObjectDependency[]> {
  const discovery = await discoverObjectDependencies(
    client,
    'dataset',
    datasetId,
  )
  return discovery.dependencies
}

export function sheetLinksFromDependencies(
  dependencies: ObjectDependency[],
): Array<{ instanceId: string; name: string; historical: boolean }> {
  return dependencies
    .filter((item) => item.kind === 'sheet_instance')
    .map((item) => ({
      instanceId: item.id,
      name: item.label,
      historical: item.liveness !== 'active',
    }))
}

export function coerceDatasetCellValue(
  column: ScientificColumnWire,
  raw: string,
): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  switch (column.logical_type) {
    case 'integer': {
      if (!/^-?\d+$/.test(trimmed))
        throw new Error(`Invalid integer: ${column.label}`)
      const value = Number(trimmed)
      if (!Number.isSafeInteger(value))
        throw new Error(`Invalid integer: ${column.label}`)
      return value
    }
    case 'decimal': {
      if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed))
        throw new Error(`Invalid number: ${column.label}`)
      const value = Number(trimmed)
      if (!Number.isFinite(value))
        throw new Error(`Invalid number: ${column.label}`)
      return value
    }
    case 'boolean':
      if (['true', '1', 'yes'].includes(trimmed.toLowerCase())) return true
      if (['false', '0', 'no'].includes(trimmed.toLowerCase())) return false
      throw new Error(`Invalid boolean: ${column.label}`)
    default:
      return trimmed
  }
}

export function columnsForPinnedSchemaVersion(
  fields: CanonicalDatasetSchemaField[],
): Array<{ id: string; label: string; logicalType: string }> {
  return [...fields]
    .filter((field) => field.lifecycle === 'active')
    .sort((a, b) => a.display_order - b.display_order)
    .map((field) => ({
      id: field.field_id,
      label: field.label,
      logicalType: field.logical_type,
    }))
}

export function parseTsvRows(
  text: string,
  columns: ScientificColumnWire[],
): DatasetCommitRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  return lines.map((line) => {
    const cells = line.split('\t')
    const values: Record<string, unknown> = {}
    columns.forEach((column, index) => {
      values[column.id] = coerceDatasetCellValue(column, cells[index] ?? '')
    })
    return {
      operation: 'create',
      rowId: crypto.randomUUID(),
      values,
    }
  })
}

export function datasetRowsToCsv(
  columns: ScientificColumnWire[],
  rows: Array<Record<string, unknown>>,
): string {
  const header = columns.map((column) => csvCell(column.label)).join(',')
  const body = rows.map((row) =>
    columns
      .map((column) => csvCell(row[column.field_name] ?? row[column.id] ?? ''))
      .join(','),
  )
  return [header, ...body].join('\n')
}

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : String(value)
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export function describeDatasetCommitError(
  result: DatasetCommitResult,
): string {
  if (result.ok) return ''
  const first = result.errors?.[0]
  if (!first) return 'The Dataset batch was rejected.'
  switch (first.code) {
    case 'required_value':
      return 'A required field is missing.'
    case 'invalid_value':
    case 'invalid_value_type':
      return 'A value does not match the Schema field type.'
    case 'unknown_field':
      return 'A field is not on the current Schema Version.'
    case 'stale':
      return 'This Dataset changed elsewhere. Refresh and try again.'
    default:
      return first.code
  }
}

export function datasetRevision(table: CanonicalDatasetWire): number {
  return Number(table.revision ?? 1)
}
