/**
 * MOB-02 — bench reading data module.
 *
 * A bench reading is not a second measurement store: it fills the canonical
 * Dataset planned row (DSET-01.3) through the same governed
 * `commit_dataset_row_batch` path every import and Sheet write-back uses. The
 * value is validated against its Schema field rules by that RPC, and an
 * out-of-range value becomes a rule-generated `system` flag (DSET-01.1)
 * instead of being silently accepted.
 *
 * The dilution factor is recorded canonically as the value of a numeric Schema
 * field whose key or label names a dilution (the same field import uses), so
 * the reported concentration stays derivable from the raw reading without a
 * second engine or an invented table.
 *
 * The photo reuses the existing file/evidence model: the canonical
 * `/api/files/upload-authorize` → `/api/files/{id}/upload` flow creates the
 * `file` record and `file_objects` metadata, then `create_record_link` attaches
 * it to the sample (`link_type = 'file'`).
 *
 * Everything here is workspace-scoped by the same `/api/db` boundary and RLS
 * as the rest of the product; PostgreSQL stays authoritative.
 */
import type { DataClient } from './data-client'
import { commitDatasetRowBatch } from './dataset-product'
import type { DatasetCommitResult, DatasetCommitRow } from './dataset-product'
import { AttachFileError, validateFileForUpload } from './file-attach'

export type ReadingFieldType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'category'
  | 'reference'

/** Wire shape of one active `api.dataset_schema_version_fields` row. */
export interface ReadingFieldWire {
  field_id: string
  key: string
  label: string
  logical_type: ReadingFieldType
  nullable: boolean
  display_order: number
  quantity: Record<string, unknown> | null
  validation: Record<string, unknown> | null
  relationship: Record<string, unknown> | null
}

/** Wire shape of a sample `records` row usable by the bench flow. */
export interface ReadingSampleWire {
  id: string
  identifier: string
  title: string
  /** `records.project_id`; the canonical upload path needs it for the photo. */
  project_id: string | null
}

/** Wire shape of an active `api.datasets` row. */
export interface ReadingDatasetWire {
  id: string
  display_id: string | null
  name: string
  schema_version_id: string
  revision: number | string
}

/** Wire shape of an active `api.dataset_rows` planned row with a key. */
export interface ReadingPlannedRowWire {
  id: string
  dataset_id: string
  planned_key: string | null
  scheduled_at: string | null
}

export const readingQueryKeys = {
  samples: ['readings', 'samples'] as const,
  datasets: ['readings', 'datasets'] as const,
  plannedRows: ['readings', 'planned-rows'] as const,
  fields: (schemaVersionId: string) =>
    ['readings', 'fields', schemaVersionId] as const,
}

export async function listReadingSamples(
  client: DataClient,
): Promise<ReadingSampleWire[]> {
  return client.list<ReadingSampleWire>(
    'records',
    '?kind=eq.sample&deleted_at=is.null&archived_at=is.null&order=identifier.asc&select=id,identifier,title,project_id&limit=200',
  )
}

export async function listReadingDatasets(
  client: DataClient,
): Promise<ReadingDatasetWire[]> {
  return client.list<ReadingDatasetWire>(
    'datasets',
    '?lifecycle=eq.active&order=name.asc&select=id,display_id,name,schema_version_id,revision&limit=200',
  )
}

export async function listReadingFields(
  client: DataClient,
  schemaVersionId: string,
): Promise<ReadingFieldWire[]> {
  return client.list<ReadingFieldWire>(
    'dataset_schema_version_fields',
    `?schema_version_id=eq.${encodeURIComponent(
      schemaVersionId,
    )}&lifecycle=eq.active&order=display_order.asc&select=field_id,key,label,logical_type,nullable,display_order,quantity,validation,relationship`,
  )
}

/**
 * Every planned row in the workspace that can be filled by key. The bench flow
 * only offers rows with a stable `planned_key` (a sample/well key), because
 * that is the identity `commit_dataset_row_batch` matches on.
 */
export async function listReadingPlannedRows(
  client: DataClient,
): Promise<ReadingPlannedRowWire[]> {
  return client.list<ReadingPlannedRowWire>(
    'dataset_rows',
    '?status=eq.planned&planned_key=not.is.null&order=planned_key.asc&select=id,dataset_id,planned_key,scheduled_at&limit=500',
  )
}

function isNumericType(type: ReadingFieldType): boolean {
  return type === 'integer' || type === 'decimal'
}

function targetModelKey(field: ReadingFieldWire): string | null {
  const relationship = field.relationship
  if (relationship) {
    const target = relationship.target
    if (target && typeof target === 'object') {
      const modelKey = (target as Record<string, unknown>).modelKey
      if (typeof modelKey === 'string' && modelKey.length > 0) return modelKey
    }
  }
  const validation = field.validation
  const fromValidation = validation?.targetModelKey
  return typeof fromValidation === 'string' && fromValidation.length > 0
    ? fromValidation
    : null
}

/** Schema field that carries the sample identity (reference or sample text). */
export function sampleBindingField(
  fields: readonly ReadingFieldWire[],
): ReadingFieldWire | null {
  const reference = fields.find(
    (field) =>
      field.logical_type === 'reference' && targetModelKey(field) === 'sample',
  )
  if (reference) return reference
  return (
    fields.find(
      (field) =>
        field.logical_type === 'text' &&
        (/sample/i.test(field.key) || /sample/i.test(field.label)),
    ) ?? null
  )
}

/**
 * Numeric Schema field that holds a dilution factor. Matched by key or label so
 * it works with the datasets the product already seeds.
 */
export function dilutionReadingField(
  fields: readonly ReadingFieldWire[],
): ReadingFieldWire | null {
  return (
    fields.find(
      (field) =>
        isNumericType(field.logical_type) &&
        (/dilution/i.test(field.key) || /dilution/i.test(field.label)),
    ) ?? null
  )
}

/** Numeric fields a reading value may be recorded against. */
export function numericReadingFields(
  fields: readonly ReadingFieldWire[],
): ReadingFieldWire[] {
  return fields.filter((field) => isNumericType(field.logical_type))
}

function quantityUnit(field: ReadingFieldWire): string | null {
  const quantity = field.quantity
  if (!quantity || typeof quantity !== 'object') return null
  const unit = quantity.symbol ?? quantity.storageUnit
  return typeof unit === 'string' && unit.length > 0 ? unit : null
}

/** Display unit from the field's quantity metadata, if any. */
export function readingFieldUnit(field: ReadingFieldWire): string | null {
  return quantityUnit(field)
}

export interface OutOfRangeRule {
  min?: number
  max?: number
}

/**
 * Soft rule that generates a `system` out-of-range flag without rejecting the
 * value. It lives in `validation.extensions.systemFlags.out_of_range`; hard
 * `validation.min`/`max` stay a validation error and are intentionally not read
 * here.
 */
export function outOfRangeRule(field: ReadingFieldWire): OutOfRangeRule | null {
  const extensions = field.validation?.extensions
  if (!extensions || typeof extensions !== 'object') return null
  const systemFlags = (extensions as Record<string, unknown>).systemFlags
  if (!systemFlags || typeof systemFlags !== 'object') return null
  const rule = (systemFlags as Record<string, unknown>).out_of_range
  if (!rule || typeof rule !== 'object') return null
  const wire = rule as Record<string, unknown>
  const min = typeof wire.min === 'number' ? wire.min : undefined
  const max = typeof wire.max === 'number' ? wire.max : undefined
  if (min === undefined && max === undefined) return null
  return { min, max }
}

/**
 * Client-side mirror of the database rule, used only to tell the scientist the
 * value will be flagged. The commit RPC stays authoritative.
 */
export function isReadingOutOfRange(
  field: ReadingFieldWire,
  value: number,
): boolean {
  const rule = outOfRangeRule(field)
  if (!rule || !Number.isFinite(value)) return false
  if (rule.min !== undefined && value < rule.min) return true
  if (rule.max !== undefined && value > rule.max) return true
  return false
}

/** Reported (undiluted) concentration from a raw reading and a dilution factor. */
export function reportedConcentration(
  rawValue: number,
  dilutionFactor: number | null | undefined,
): number | null {
  if (!Number.isFinite(rawValue)) return null
  if (dilutionFactor == null || !Number.isFinite(dilutionFactor))
    return rawValue
  return rawValue * dilutionFactor
}

export interface BuildReadingValuesInput {
  fields: readonly ReadingFieldWire[]
  measurementFieldId: string
  measurementValue: number
  sample: Pick<ReadingSampleWire, 'id' | 'identifier'>
  dilutionFieldId?: string | null
  dilutionFactor?: number | null
  noteFieldId?: string | null
  note?: string | null
}

/**
 * Fold the bench inputs into the canonical `values` object keyed by field id.
 * The sample identity value is chosen from the binding field type (record id
 * for a reference field, stable identifier for a sample text field).
 */
export function buildReadingValues(
  input: BuildReadingValuesInput,
): Record<string, unknown> {
  const measurement = input.fields.find(
    (field) => field.field_id === input.measurementFieldId,
  )
  if (!measurement || !isNumericType(measurement.logical_type)) {
    throw new Error('Choose a numeric measurement field for this dataset.')
  }
  if (!Number.isFinite(input.measurementValue)) {
    throw new Error('Enter a numeric value.')
  }
  const values: Record<string, unknown> = {
    [measurement.field_id]: input.measurementValue,
  }

  const binding = sampleBindingField(input.fields)
  if (binding) {
    values[binding.field_id] =
      binding.logical_type === 'reference'
        ? input.sample.id
        : input.sample.identifier
  }

  if (input.dilutionFieldId && input.dilutionFactor != null) {
    if (input.dilutionFieldId === measurement.field_id) {
      throw new Error('The measurement and dilution must be different fields.')
    }
    const dilution = input.fields.find(
      (field) => field.field_id === input.dilutionFieldId,
    )
    if (!dilution || !isNumericType(dilution.logical_type)) {
      throw new Error('Choose a numeric dilution field for this dataset.')
    }
    if (!Number.isFinite(input.dilutionFactor) || input.dilutionFactor <= 0) {
      throw new Error('Dilution factor must be greater than zero.')
    }
    if (
      dilution.logical_type === 'integer' &&
      !Number.isInteger(input.dilutionFactor)
    ) {
      throw new Error('This dataset stores dilution as a whole number.')
    }
    values[dilution.field_id] = input.dilutionFactor
  }

  const note = input.note?.trim()
  if (input.noteFieldId && note) {
    values[input.noteFieldId] = note
  }

  return values
}

export interface BuildReadingRowInput extends BuildReadingValuesInput {
  /** Stable planned-row key this reading fills. */
  plannedKey: string
  /** Override the generated row id (tests / retries). */
  rowId?: string
}

/**
 * Build the canonical planned-row fill: a `create` carrying the planned key so
 * the RPC turns the matching planned row into a recorded row with these values.
 */
export function buildReadingRow(input: BuildReadingRowInput): DatasetCommitRow {
  const plannedKey = input.plannedKey.trim()
  if (plannedKey.length < 1 || plannedKey.length > 200) {
    throw new Error('This planned row has no usable key.')
  }
  return {
    operation: 'create',
    rowId: input.rowId ?? crypto.randomUUID(),
    plannedKey,
    values: buildReadingValues(input),
  }
}

export interface SubmitBenchReadingInput extends BuildReadingRowInput {
  datasetId: string
  /** Live `datasets.revision` read before submit. */
  expectedRevision: number
  /** Stable per-submission key so a retry cannot write a second reading. */
  idempotencyKey: string
}

export async function submitBenchReading(
  client: DataClient,
  input: SubmitBenchReadingInput,
): Promise<DatasetCommitResult> {
  return commitDatasetRowBatch(client, {
    datasetId: input.datasetId,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    rows: [buildReadingRow(input)],
  })
}

const READING_ERROR_MESSAGES: Record<string, string> = {
  stale_dataset_revision: 'The dataset changed. Reload and try again.',
  dataset_archived: 'This dataset is archived and cannot receive readings.',
  row_id_exists: 'That reading already exists.',
  unknown_field: 'A field is no longer part of the dataset schema.',
  invalid_field_id: 'The dataset field is invalid.',
  required_value: 'A required value is missing.',
  numeric_validation: 'The value is outside the field’s allowed range.',
  text_validation: 'The text does not match the field’s rules.',
  invalid_value_type: 'The value type does not match the field.',
  invalid_reference: 'The linked record was not found in this workspace.',
  invalid_category_option: 'The category option is invalid.',
  invalid_cardinality: 'The number of values is wrong for this field.',
}

/**
 * Human message for a failed commit. Unknown codes fall back to the raw code so
 * a new database rule is still surfaced rather than swallowed.
 */
export function readingCommitErrorMessage(
  result: DatasetCommitResult,
  fields: readonly ReadingFieldWire[] = [],
): string | null {
  if (result.ok) return null
  const byId = new Map(fields.map((field) => [field.field_id, field]))
  const messages = (result.errors ?? []).map((error) => {
    const base =
      READING_ERROR_MESSAGES[error.code] ?? `Couldn’t save (${error.code}).`
    const field = error.fieldId ? byId.get(error.fieldId) : undefined
    return field ? `${field.label}: ${base}` : base
  })
  return messages.length > 0
    ? Array.from(new Set(messages)).join(' ')
    : 'The reading did not pass validation.'
}

// ---------------------------------------------------------------------------
// Photo evidence — reuse the canonical file/evidence model.
// ---------------------------------------------------------------------------

export interface AttachPhotoInput {
  sampleRecordId: string
  /** The sample's project; the canonical upload path requires one. */
  projectId: string
  file: File
}

export interface AttachedPhoto {
  fileRecordId: string
  fileIdentifier: string
  displayName: string
  mediaType: string
  byteSize: number
}

/**
 * Upload a photo through the canonical file routes and link it to the sample
 * with `link_type = 'file'`. The bytes never pass through `/api/db`; the
 * metadata, audit and link do.
 */
export async function attachPhotoToSample(
  client: DataClient,
  input: AttachPhotoInput,
): Promise<AttachedPhoto> {
  const checked = validateFileForUpload(input.file)
  if (!checked.ok) throw new AttachFileError(checked.message, checked.code)
  const mediaType = checked.mediaType

  const authorizeRes = await fetch('/api/files/upload-authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: input.projectId,
      displayName: input.file.name,
      mediaType,
      byteSize: input.file.size,
    }),
  })
  if (authorizeRes.status >= 400) {
    throw new AttachFileError(
      `Upload was refused (${authorizeRes.status}).`,
      authorizeRes.status === 401 || authorizeRes.status === 403
        ? 'permission_denied'
        : 'server_error',
    )
  }
  const meta = (await authorizeRes.json()) as {
    fileRecordId: string
    fileIdentifier: string
  }

  const uploadRes = await fetch(`/api/files/${meta.fileRecordId}/upload`, {
    method: 'PUT',
    headers: { 'content-type': mediaType },
    body: input.file,
  })
  if (uploadRes.status >= 400) {
    throw new AttachFileError(
      `Upload failed (${uploadRes.status}).`,
      'server_error',
    )
  }

  await client.rpc('create_record_link', {
    p_source_record_id: input.sampleRecordId,
    p_target_kind: 'file',
    p_target_identifier: meta.fileIdentifier,
    p_link_type: 'file',
    p_target_record_id: meta.fileRecordId,
    p_label: null,
  })

  return {
    fileRecordId: meta.fileRecordId,
    fileIdentifier: meta.fileIdentifier,
    displayName: input.file.name,
    mediaType,
    byteSize: input.file.size,
  }
}
