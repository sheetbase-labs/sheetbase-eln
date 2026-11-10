import { z } from 'zod'

import type { FieldDefinition } from './field-definition'
import type { DataClient } from './data-client'
import { createDataClient, DataClientError } from './data-client'
import { validateFieldValue } from './field-value-validation'
import { composedRowKeySchema } from './sheet-instance'
import type { SheetLocalValue } from './sheet-instance'
import { sheetInstanceCalculationSchema } from './sheet-calculation'
import {
  pipelineJsonObjectSchema,
  pipelineJsonValueSchema,
} from './pipelines/types'
import { rfc3339TimestampSchema } from './parameter'
import { sheetInstanceFromWire } from './sheet-instance-data'
import {
  sheetDefinitionUuidSchema as uuid,
  sheetFieldDefinitionSchema,
} from './sheet-definition'

/** Structural canonical-value validation shared by non-DB callers. Delegates
 * to the MODEL-02 kernel (`validateFieldValue`) so Sheet cells, Record
 * input and the parity suite validate one semantics. Reference
 * existence/model compatibility remains an authoritative server check. */
export function sheetLocalValueError(
  field: FieldDefinition,
  value: SheetLocalValue,
): string | null {
  return validateFieldValue(field, value)
}

const addressedRow = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('composed'),
    rowKey: composedRowKeySchema,
    identityValues: z.array(z.unknown()).min(1).max(8),
    /** Offset of the current bounded composition page (at most 200 rows). */
    compositionOffset: z.number().int().min(0).max(10_000),
  }),
  z.strictObject({ kind: z.literal('local'), rowKey: uuid }),
])

const cell = z.strictObject({
  rowKey: z.string(),
  fieldId: uuid,
  value: z.unknown(),
})

const fieldChange = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('add'),
    field: sheetFieldDefinitionSchema,
  }),
  z.strictObject({
    operation: z.literal('edit'),
    field: sheetFieldDefinitionSchema,
  }),
  z.strictObject({ operation: z.literal('retire'), fieldId: uuid }),
])

export type LocalFieldChange = z.infer<typeof fieldChange>

export async function mutateSheetLocalState(
  input: {
    instanceId: string
    expectedRevision: number
    retryToken: string
    fieldChanges?: LocalFieldChange[]
    rows?: Array<z.infer<typeof addressedRow>>
    cells?: Array<z.infer<typeof cell>>
  },
  client: DataClient = createDataClient(),
) {
  const rows = z
    .array(addressedRow)
    .max(200)
    .parse(input.rows ?? [])

  const cells = z
    .array(cell)
    .max(1_000)
    .parse(input.cells ?? [])

  const fieldChanges = z
    .array(fieldChange)
    .max(32)
    .parse(input.fieldChanges ?? [])

  const result = await client.rpc<unknown>(
    'mutate_sheet_instance_local_state',
    {
      p_instance_id: input.instanceId,
      p_expected_revision: input.expectedRevision,
      p_retry_token: uuid.parse(input.retryToken),
      p_field_changes: fieldChanges,
      p_rows: rows,
      p_cells: cells,
    },
  )

  return sheetInstanceFromWire(result)
}

export const sheetLocalAddressedRowSchema = addressedRow
export const sheetLocalCellSchema = cell

export function createAdHocTextField(
  label: string,
  existingKeys: string[] = [],
) {
  const trimmed = label.trim() || 'Column'

  let key = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)

  if (!/^[a-z]/.test(key)) key = `column_${key || '1'}`
  const used = new Set(existingKeys)
  let candidate = key
  let n = 2

  while (used.has(candidate)) {
    candidate = `${key}_${n}`
    n += 1
  }

  return {
    fieldId: crypto.randomUUID(),
    key: candidate,
    label: trimmed,
    description: null,
    logicalType: 'text' as const,
    nullable: true,
    defaultValue: null,
    cardinality: 'one' as const,
    quantity: null,
    validation: {},
    category: null,
    relationship: null,
    computation: { mode: 'stored' as const },
    lifecycle: 'active' as const,
  }
}

export async function mutateSheetInstanceCalculations(
  input: {
    instanceId: string
    expectedRevision: number
    retryToken: string
    changes: SheetInstanceCalculationChange[]
  },
  client: DataClient = createDataClient(),
) {
  // Validate raw scientific values before owner schemas can clone nested objects.
  pipelineJsonValueSchema.parse(input.changes)
  z.array(calculationChangeSchema).min(1).max(32).parse(input.changes)

  const result = await client.rpc<unknown>(
    'mutate_sheet_instance_calculations',
    {
      p_instance_id: uuid.parse(input.instanceId),
      p_expected_revision: input.expectedRevision,
      p_retry_token: uuid.parse(input.retryToken),
      p_changes: input.changes,
    },
  )

  return sheetInstanceFromWire(result)
}

const calculationChangeSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('add'),
    calculation: sheetInstanceCalculationSchema,
  }),
  z.strictObject({
    operation: z.literal('edit'),
    calculation: sheetInstanceCalculationSchema,
  }),
  z.strictObject({ operation: z.literal('retire'), calculationId: uuid }),
])

export type SheetInstanceCalculationChange = z.infer<
  typeof calculationChangeSchema
>

const calculationResultSchema = z.strictObject({
  calculationId: uuid,
  rowKey: z.union([uuid, composedRowKeySchema]),
  scope: z.enum(['definition', 'instance']),
  definitionVersionId: uuid.nullable(),
  calculationStatus: z.enum(['current', 'stale']),
  calculatedValue: z.number().finite().nullable(),
  resultKind: z.enum(['value', 'error']),
  errorCode: z.string().nullable(),
  diagnostic: z.string().nullable(),
  expression: sheetInstanceCalculationSchema.shape.expression,
  dependencies: sheetInstanceCalculationSchema.shape.dependencies,
  // Validate the owner contract without replacing scientific extension objects with clones.
  outputField: z.custom<z.infer<typeof sheetFieldDefinitionSchema>>(
    (value) =>
      pipelineJsonObjectSchema.safeParse(value).success &&
      sheetFieldDefinitionSchema.safeParse(value).success,
  ),
  sourceRevisions: z.array(pipelineJsonValueSchema),
  dependencyProvenance: z.array(pipelineJsonValueSchema),
  calculatedAt: rfc3339TimestampSchema,
  permission: z.strictObject({ editability: z.literal('read-only') }),
})

const calculationResultsSchema = z.strictObject({
  instanceId: uuid,
  revision: z.number().int().positive(),
  results: z.array(calculationResultSchema),
})

export type SheetInstanceCalculationResult = z.infer<
  typeof calculationResultSchema
>

export type SheetInstanceCalculationResults = z.infer<
  typeof calculationResultsSchema
>

export async function readSheetInstanceCalculationResults(
  instanceId: string,
  rowKeys: string[],
  client: DataClient = createDataClient(),
) {
  const result = await client.rpc<unknown>(
    'read_sheet_instance_calculation_results',
    {
      p_instance_id: uuid.parse(instanceId),
      p_row_keys: z
        .array(z.union([uuid, composedRowKeySchema]))
        .max(200)
        .parse(rowKeys),
    },
  )

  return calculationResultsSchema.parse(result)
}

const calculationCompletionSchema = z.looseObject({
  instanceId: uuid,
  revision: z.number().int().positive(),
  rowCount: z.number().int().nonnegative(),
  calculationCount: z.number().int().nonnegative(),
  status: z.literal('completed'),
})

export async function recalculateSheetInstance(
  input: {
    instanceId: string
    expectedRevision: number
    offset?: number
    limit?: number
  },
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl('/api/sheet-calculations', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ ...input, retryToken: crypto.randomUUID() }),
  })

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const error = z
      .object({ error: z.object({ code: z.string(), message: z.string() }) })
      .safeParse(body)

    throw new DataClientError(
      error.success ? error.data.error.code : 'calculation_failed',
      error.success
        ? error.data.error.message
        : `Sheet calculation failed (HTTP ${response.status}).`,
      response.status,
    )
  }

  const result = calculationCompletionSchema.safeParse(body)

  if (
    !result.success ||
    result.data.instanceId !== input.instanceId ||
    result.data.revision !== input.expectedRevision
  )
    throw new DataClientError(
      'invalid_response',
      'The server did not confirm calculation of the requested Sheet revision.',
      response.status,
    )

  return result.data
}
