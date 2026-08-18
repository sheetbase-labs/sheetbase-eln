/**
 * DATA-01 validate-before-commit. Writes only through canonical RPCs:
 * `validate_dataset_row_batch` / `commit_dataset_row_batch` and
 * `validate_sheet_record_batch` / `create_model_record`.
 */
import type { DataClient } from './data-client'
import {
  commitDatasetRowBatch,
  validateDatasetRowBatch,
} from './dataset-product'
import type { DatasetCommitResult } from './dataset-product'
import { assertPinnedSchemaVersion } from './import-mapping'
import type { MappedImport } from './import-mapping'
import { validateSheetRecordBatch } from './sheet-record-mapping'

export interface DatasetImportTarget {
  kind: 'dataset'
  datasetId: string
  expectedRevision: number
  schemaVersionId: string
}

export interface RecordImportTarget {
  kind: 'record'
  projectId: string
  modelKey: string
  recordKind: string
}

export type ImportCommitTarget = DatasetImportTarget | RecordImportTarget

export interface ImportCommitReport {
  ok: boolean
  committed: number
  errors: Array<{ row?: number; code: string; message: string }>
  datasetRevision?: number
  schemaVersionId?: string
}

export async function validateAndCommitImport(
  client: DataClient,
  target: ImportCommitTarget,
  mapped: MappedImport,
  idempotencyKey: string,
): Promise<ImportCommitReport> {
  if (mapped.errors.length > 0) {
    return {
      ok: false,
      committed: 0,
      errors: mapped.errors.map((error) => ({
        row: error.row,
        code: error.code,
        message: error.message,
      })),
    }
  }
  if (mapped.rows.length === 0) {
    return {
      ok: false,
      committed: 0,
      errors: [{ code: 'empty', message: 'No rows to import.' }],
    }
  }
  if (target.kind === 'dataset') {
    assertPinnedSchemaVersion(mapped.schemaVersionId, target.schemaVersionId)
    return commitDatasetImport(client, target, mapped, idempotencyKey)
  }
  return commitRecordImport(client, target, mapped)
}

async function commitDatasetImport(
  client: DataClient,
  target: DatasetImportTarget,
  mapped: MappedImport,
  idempotencyKey: string,
): Promise<ImportCommitReport> {
  const rows = mapped.rows.map((row) => ({
    operation: 'create' as const,
    rowId: row.rowId,
    values: row.values,
  }))
  const validated = await validateDatasetRowBatch(client, {
    datasetId: target.datasetId,
    expectedRevision: target.expectedRevision,
    rows,
  })
  if (!validated.ok) {
    return datasetReport(validated, target.schemaVersionId, 0)
  }
  const committed = await commitDatasetRowBatch(client, {
    datasetId: target.datasetId,
    expectedRevision: target.expectedRevision,
    rows,
    idempotencyKey,
  })
  return datasetReport(
    committed,
    target.schemaVersionId,
    committed.ok ? (committed.rows?.length ?? rows.length) : 0,
  )
}

function datasetReport(
  result: DatasetCommitResult,
  schemaVersionId: string,
  committed: number,
): ImportCommitReport {
  if (result.ok) {
    return {
      ok: true,
      committed,
      errors: [],
      datasetRevision: result.datasetRevision,
      schemaVersionId,
    }
  }
  return {
    ok: false,
    committed: 0,
    schemaVersionId,
    errors: (result.errors ?? []).map((error) => ({
      row: error.rowIndex,
      code: error.code,
      message: describeImportRpcCode(error.code),
    })),
  }
}

async function commitRecordImport(
  client: DataClient,
  target: RecordImportTarget,
  mapped: MappedImport,
): Promise<ImportCommitReport> {
  const batchRows = mapped.rows.map((row, index) => ({
    rowKey: row.rowId || `import-${index + 1}`,
    operation: 'create' as const,
    title: row.title?.trim() || '',
    values: row.values,
  }))
  const missingTitle = batchRows
    .map((row, index) => ({ row, index }))
    .filter((item) => !item.row.title)
  if (missingTitle.length > 0) {
    return {
      ok: false,
      committed: 0,
      errors: missingTitle.map((item) => ({
        row: item.index + 1,
        code: 'required_value',
        message: 'Record name is required.',
      })),
    }
  }
  const validation = await validateSheetRecordBatch(
    {
      projectId: target.projectId,
      modelKey: target.modelKey,
      rows: batchRows,
    },
    client,
  )
  const validationRecord = asRecord(validation)
  if (validationRecord && validationRecord.ok === false) {
    const rows = Array.isArray(validationRecord.rows)
      ? validationRecord.rows
      : []
    return {
      ok: false,
      committed: 0,
      errors: rows.flatMap((item) => {
        const row = asRecord(item)
        if (!row) return []
        const errors = Array.isArray(row.errors) ? row.errors : []
        return errors.map((error) => {
          const detail = asRecord(error)
          return {
            row: typeof row.rowIndex === 'number' ? row.rowIndex : undefined,
            code: String(detail?.code ?? 'invalid'),
            message: String(detail?.message ?? 'Record validation failed.'),
          }
        })
      }),
    }
  }
  let committed = 0
  for (const row of mapped.rows) {
    await client.rpc('create_model_record', {
      p_project_id: target.projectId,
      p_kind: target.recordKind,
      p_title: row.title?.trim() || '',
      p_status: row.status?.trim() || defaultRecordStatus(target.recordKind),
      p_tags: [],
      p_properties: {},
      p_custom_fields: row.values,
    })
    committed += 1
  }
  return { ok: true, committed, errors: [] }
}

function defaultRecordStatus(kind: string): string {
  if (kind === 'sample' || kind === 'reagent') return 'available'
  return 'draft'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

export function describeImportRpcCode(code: string): string {
  switch (code) {
    case 'required_value':
      return 'A required field is missing.'
    case 'invalid_value':
    case 'invalid_value_type':
    case 'coercion_failed':
      return 'A value does not match the Schema field type.'
    case 'unknown_field':
      return 'A field is not on the current Schema Version.'
    case 'stale':
    case 'stale_dataset_revision':
      return 'This Dataset changed elsewhere. Refresh and try again.'
    default:
      return code
  }
}
