/**
 * CORE-04.5 explicit Sheet row → Model Record mapping.
 *
 * Column identity is the Definition column UUID. Labels are never used to
 * infer a target. Calculated columns cannot supply values. Record IDs stay
 * Model-generated; UUID identity is separate.
 */
import { z } from 'zod'

import type { DataClient } from './data-client'
import type { FieldDefinition, FieldLogicalType } from './field-definition'
import {
  pipelineJsonObjectSchema,
  pipelineJsonValueSchema,
} from './pipelines/types'
import { CURRENT_RECORD_ID_POLICY } from './record-id-policy'
import { parsePersistedRecordReference } from './record-reference-cell'

export const SHEET_RECORD_MAPPING_FORMAT = 'sb-sheet-record-map-v1' as const

export type SheetRecordMapping = z.infer<typeof mappingSchema>

export type SheetRecordColumnMapping = SheetRecordMapping['columns'][number]

export type SheetRecordMappingSourceKind =
  SheetRecordColumnMapping['sourceKind']

export type SheetRecordFieldTarget = SheetRecordColumnMapping['target']

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
  values: z.infer<typeof pipelineJsonObjectSchema>
  errors: SheetRecordMappingIssue[]
}

const columnId = z.string().uuid()

const targetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('title') }),
  z.strictObject({
    kind: z.literal('model-field'),
    fieldName: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('constant'),
    fieldName: z.string().min(1),
    value: pipelineJsonValueSchema,
  }),
])

const mappingSchema = z.strictObject({
  format: z.literal(SHEET_RECORD_MAPPING_FORMAT),
  modelKey: z.string().min(1),
  matchKey: z.enum(['none', 'identifier']),
  recordIdPolicy: z.strictObject({
    mode: z.literal(CURRENT_RECORD_ID_POLICY.mode),
    format: z.literal(CURRENT_RECORD_ID_POLICY.format),
    uniqueness: z.literal(CURRENT_RECORD_ID_POLICY.uniqueness),
    owner: z.literal(CURRENT_RECORD_ID_POLICY.owner),
  }),
  columns: z
    .array(
      z.strictObject({
        columnId,
        sourceKind: z.enum(['bound', 'declared']),
        target: targetSchema,
      }),
    )
    .min(1),
})

export function parseSheetRecordMapping(
  value: z.input<typeof mappingSchema>,
): SheetRecordMapping {
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

function typeOk(
  logicalType: FieldLogicalType,
  value: z.infer<typeof pipelineJsonValueSchema> | undefined,
): boolean {
  if (value === null || value === undefined || value === '') return true

  switch (logicalType) {
    case 'text':
    case 'date':
    case 'timestamp':
    case 'category':
    case 'reference':
      return z.string().safeParse(value).success
    case 'integer':
      return z.number().refine(Number.isInteger).safeParse(value).success
    case 'decimal':
      return z.number().finite().safeParse(value).success
    case 'boolean':
      return z.boolean().safeParse(value).success
  }
}

export function previewSheetRecordMapping(input: {
  mapping: SheetRecordMapping
  fields: SheetRecordMappingField[]
  rows: Array<{
    rowKey: string
    values: Partial<z.infer<typeof pipelineJsonObjectSchema>>
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
    const values: SheetRecordPreviewRow['values'] = {}
    let title: string | null = null

    for (const column of mapping.columns) {
      const raw =
        column.target.kind === 'constant'
          ? column.target.value
          : row.values[column.columnId]

      if (column.target.kind === 'title') {
        const titleValue = z.string().safeParse(raw)
        title =
          titleValue.success && titleValue.data.trim().length > 0
            ? titleValue.data.trim()
            : null

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

      if (
        field.quantity &&
        (Array.isArray(raw) || pipelineJsonObjectSchema.safeParse(raw).success)
      ) {
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
        const categoryKey = z.string().parse(raw)

        if (!field.categoryKeys.includes(categoryKey)) {
          errors.push({
            code: 'inactive-category',
            columnId: column.columnId,
            fieldName,
            rowKey: row.rowKey,
            message: `Category key ${categoryKey} is not active.`,
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
            message:
              'Choose the record from the list instead of typing its ID or name.',
          })
          continue
        }
      }

      Object.defineProperty(values, fieldName, {
        value: raw,
        enumerable: true,
        configurable: true,
        writable: true,
      })
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

const recordBatchRowsSchema = z
  .array(
    z.object({
      rowKey: z.string().trim().min(1),
      operation: z.enum(['create', 'link']),
      title: z.string().optional(),
      values: pipelineJsonObjectSchema.optional(),
      recordId: z.string().optional(),
      matchIdentifier: z.string().optional(),
    }),
  )
  .min(1)
  .max(1_000)

const recordBatchResultSchema = z.strictObject({
  ok: z.boolean(),
  mutated: z.literal(false),
  rows: z.array(
    z.strictObject({
      rowIndex: z.number().int().positive(),
      rowKey: z.string(),
      classification: z.enum([
        'create',
        'existing',
        'match',
        'invalid',
        'link',
      ]),
      recordId: columnId.nullable().optional(),
      identifier: z.string().optional(),
      errors: z.array(
        z.strictObject({
          code: z.string(),
          message: z.string(),
          fieldName: z.string().optional(),
          columnId: columnId.optional(),
        }),
      ),
    }),
  ),
})

export type SheetRecordBatchValidation = z.infer<typeof recordBatchResultSchema>

export async function validateSheetRecordBatch(
  input: {
    projectId: string
    modelKey: string
    rows: Array<{
      rowKey: string
      operation: 'create' | 'link'
      title?: string
      values?: z.input<typeof pipelineJsonObjectSchema>
      recordId?: string
      matchIdentifier?: string
    }>
  },
  client: Pick<DataClient, 'rpc'>,
) {
  // Check original values before the transport can omit or coerce them.
  recordBatchRowsSchema.parse(input.rows)

  const result = await client.rpc<unknown>('validate_sheet_record_batch', {
    p_project_id: input.projectId,
    p_model_key: input.modelKey,
    p_rows: input.rows,
  })

  return recordBatchResultSchema.parse(result)
}
