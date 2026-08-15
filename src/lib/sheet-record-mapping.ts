/**
 * CORE-04.5 explicit Sheet row → Model Record mapping.
 *
 * Column identity is the Definition column UUID. Labels are never used to
 * infer a target. Calculated columns cannot supply values. Record IDs stay
 * Model-generated; UUID identity is separate.
 */
import { z } from 'zod'

import type { FieldDefinition, FieldLogicalType } from './field-definition'
import type { RecordIdPolicy } from './record-id-policy'
import { CURRENT_RECORD_ID_POLICY } from './record-id-policy'
import { parsePersistedRecordReference } from './record-reference-cell'

export const SHEET_RECORD_MAPPING_FORMAT = 'sb-sheet-record-map-v1' as const

export type SheetRecordMappingSourceKind = 'bound' | 'declared'

export type SheetRecordFieldTarget =
  | { kind: 'title' }
  | { kind: 'model-field'; fieldName: string }
  | { kind: 'constant'; fieldName: string; value: unknown }

export interface SheetRecordColumnMapping {
  columnId: string
  sourceKind: SheetRecordMappingSourceKind
  target: SheetRecordFieldTarget
}

export interface SheetRecordMapping {
  format: typeof SHEET_RECORD_MAPPING_FORMAT
  modelKey: string
  matchKey: 'none' | 'identifier'
  recordIdPolicy: RecordIdPolicy
  columns: SheetRecordColumnMapping[]
}

export interface SheetRecordMappingField {
  fieldName: string
  logicalType: FieldLogicalType
  nullable: boolean
  lifecycle: FieldDefinition['lifecycle']
  categoryKeys?: string[]
  quantity?: { storageUnit: string } | null
}

export type SheetRecordMappingIssue = {
  code:
    | 'inferred-label'
    | 'unknown-field'
    | 'retired-field'
    | 'calculated-source'
    | 'incompatible-type'
    | 'quantity-unconverted'
    | 'required-value'
    | 'duplicate-input-row'
    | 'invalid-reference'
    | 'inactive-category'
    | 'record-id-policy'
  columnId?: string
  fieldName?: string
  rowKey?: string
  message: string
}

export type SheetRecordPreviewClassification = 'create' | 'match' | 'invalid'

export interface SheetRecordPreviewRow {
  rowKey: string
  classification: SheetRecordPreviewClassification
  title: string | null
  matchIdentifier: string | null
  values: Record<string, unknown>
  errors: SheetRecordMappingIssue[]
}

const columnId = z.string().uuid()

const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('title') }).strict(),
  z
    .object({ kind: z.literal('model-field'), fieldName: z.string().min(1) })
    .strict(),
  z
    .object({
      kind: z.literal('constant'),
      fieldName: z.string().min(1),
      value: z.unknown(),
    })
    .strict(),
])

const mappingSchema = z
  .object({
    format: z.literal(SHEET_RECORD_MAPPING_FORMAT),
    modelKey: z.string().min(1),
    matchKey: z.enum(['none', 'identifier']),
    recordIdPolicy: z
      .object({
        mode: z.literal('generated'),
        format: z.literal('PREFIX-YYYY-NNNN'),
        uniqueness: z.literal('project'),
        owner: z.literal('api.create_model_record'),
      })
      .strict(),
    columns: z
      .array(
        z
          .object({
            columnId,
            sourceKind: z.enum(['bound', 'declared']),
            target: targetSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

export function parseSheetRecordMapping(value: unknown): SheetRecordMapping {
  const parsed = mappingSchema.parse(value)
  const fieldNames = parsed.columns.flatMap((column) =>
    column.target.kind === 'title' ? [] : [column.target.fieldName],
  )
  if (new Set(fieldNames).size !== fieldNames.length) {
    throw new Error('each Model field may be mapped at most once')
  }
  if (
    parsed.columns.filter((column) => column.target.kind === 'title').length > 1
  ) {
    throw new Error('title may be mapped at most once')
  }
  if (
    (parsed.recordIdPolicy as { owner: string }).owner !==
    CURRENT_RECORD_ID_POLICY.owner
  ) {
    throw new Error('Sheet Record mapping must use the Model Record ID policy')
  }
  return parsed
}

export function rejectInferredSheetRecordMapping(input: {
  label: string
  fieldName: string
}): SheetRecordMappingIssue {
  return {
    code: 'inferred-label',
    fieldName: input.fieldName,
    message: `Do not infer Model field ${input.fieldName} from column label ${input.label}.`,
  }
}

function typeOk(logicalType: FieldLogicalType, value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  switch (logicalType) {
    case 'text':
    case 'date':
    case 'timestamp':
    case 'category':
    case 'reference':
      return typeof value === 'string'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'decimal':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
  }
}

export function previewSheetRecordMapping(input: {
  mapping: SheetRecordMapping
  fields: SheetRecordMappingField[]
  rows: Array<{
    rowKey: string
    values: Record<string, unknown>
    matchIdentifier?: string | null
  }>
}): SheetRecordPreviewRow[] {
  const mapping = parseSheetRecordMapping(input.mapping)
  const byName = new Map(input.fields.map((field) => [field.fieldName, field]))
  const identifierCounts = new Map<string, number>()
  for (const row of input.rows) {
    if (mapping.matchKey === 'identifier' && row.matchIdentifier) {
      identifierCounts.set(
        row.matchIdentifier,
        (identifierCounts.get(row.matchIdentifier) ?? 0) + 1,
      )
    }
  }

  return input.rows.map((row) => {
    const errors: SheetRecordMappingIssue[] = []
    const values: Record<string, unknown> = {}
    let title: string | null = null

    for (const column of mapping.columns) {
      const raw =
        column.target.kind === 'constant'
          ? column.target.value
          : row.values[column.columnId]
      if (column.target.kind === 'title') {
        title =
          typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
        if (!title) {
          errors.push({
            code: 'required-value',
            columnId: column.columnId,
            fieldName: 'title',
            rowKey: row.rowKey,
            message: 'Record Name is required.',
          })
        }
        continue
      }
      const fieldName = column.target.fieldName
      const field = byName.get(fieldName)
      if (!field || field.lifecycle === 'retired') {
        errors.push({
          code:
            field?.lifecycle === 'retired' ? 'retired-field' : 'unknown-field',
          columnId: column.columnId,
          fieldName,
          rowKey: row.rowKey,
          message: `Model field ${fieldName} is not an active mapping target.`,
        })
        continue
      }
      if (raw === null || raw === undefined || raw === '') {
        if (!field.nullable) {
          errors.push({
            code: 'required-value',
            columnId: column.columnId,
            fieldName,
            rowKey: row.rowKey,
            message: `Field ${fieldName} is required.`,
          })
        }
        continue
      }
      if (field.quantity && typeof raw === 'object') {
        errors.push({
          code: 'quantity-unconverted',
          columnId: column.columnId,
          fieldName,
          rowKey: row.rowKey,
          message: `Quantity field ${fieldName} must use the stored unit ${field.quantity.storageUnit}.`,
        })
        continue
      }
      if (!typeOk(field.logicalType, raw)) {
        errors.push({
          code: 'incompatible-type',
          columnId: column.columnId,
          fieldName,
          rowKey: row.rowKey,
          message: `Value is not a ${field.logicalType}.`,
        })
        continue
      }
      if (field.logicalType === 'category' && field.categoryKeys) {
        if (!field.categoryKeys.includes(String(raw))) {
          errors.push({
            code: 'inactive-category',
            columnId: column.columnId,
            fieldName,
            rowKey: row.rowKey,
            message: `Category key ${String(raw)} is not active.`,
          })
          continue
        }
      }
      if (field.logicalType === 'reference') {
        try {
          parsePersistedRecordReference(raw, { nullable: field.nullable })
        } catch {
          errors.push({
            code: 'invalid-reference',
            columnId: column.columnId,
            fieldName,
            rowKey: row.rowKey,
            message: 'Record reference identity is the Record UUID.',
          })
          continue
        }
      }
      values[fieldName] = raw
    }

    if (mapping.matchKey === 'identifier' && row.matchIdentifier) {
      if ((identifierCounts.get(row.matchIdentifier) ?? 0) > 1) {
        errors.push({
          code: 'duplicate-input-row',
          fieldName: 'matchIdentifier',
          rowKey: row.rowKey,
          message: 'Duplicate match identifier in this batch.',
        })
      }
    }

    const classification: SheetRecordPreviewClassification =
      errors.length > 0
        ? 'invalid'
        : mapping.matchKey === 'identifier' && row.matchIdentifier
          ? 'match'
          : 'create'

    return {
      rowKey: row.rowKey,
      classification,
      title,
      matchIdentifier: row.matchIdentifier ?? null,
      values,
      errors,
    }
  })
}

export function validateSheetRecordBatch(
  input: {
    projectId: string
    modelKey: string
    rows: Array<{
      rowKey: string
      operation: 'create' | 'link'
      title?: string
      values?: Record<string, unknown>
      recordId?: string
      matchIdentifier?: string
    }>
  },
  client: {
    rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>
  },
) {
  return client.rpc('validate_sheet_record_batch', {
    p_project_id: input.projectId,
    p_model_key: input.modelKey,
    p_rows: input.rows,
  })
}
