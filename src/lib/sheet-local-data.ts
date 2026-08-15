import { z } from 'zod'

import type { FieldDefinition } from './field-definition'
import type { DataClient } from './data-client'
import { createDataClient } from './data-client'
import { composedRowKeySchema } from './sheet-instance'
import { sheetInstanceFromWire } from './sheet-instance-data'
import {
  sheetDefinitionUuidSchema as uuid,
  sheetFieldDefinitionSchema,
} from './sheet-definition'

const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/
const timestamp =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/

function validDate(value: string) {
  const match = calendarDate.exec(value)
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <=
      [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  )
}

function scalarError(field: FieldDefinition, value: unknown): string | null {
  const valid =
    field.logicalType === 'text'
      ? typeof value === 'string'
      : field.logicalType === 'integer'
        ? typeof value === 'number' && Number.isSafeInteger(value)
        : field.logicalType === 'decimal'
          ? typeof value === 'number' && Number.isFinite(value)
          : field.logicalType === 'boolean'
            ? typeof value === 'boolean'
            : field.logicalType === 'date'
              ? typeof value === 'string' && validDate(value)
              : field.logicalType === 'timestamp'
                ? typeof value === 'string' &&
                  (() => {
                    const match = timestamp.exec(value)
                    return Boolean(
                      match &&
                      validDate(`${match[1]}-${match[2]}-${match[3]}`) &&
                      Number(match[4]) <= 23 &&
                      Number(match[5]) <= 59 &&
                      Number(match[6]) <= 59 &&
                      (value.endsWith('Z') ||
                        (Number(match[7]) <= 23 && Number(match[8]) <= 59)),
                    )
                  })()
                : typeof value === 'string' && uuid.safeParse(value).success
  if (!valid) return 'invalid_value'
  if (
    field.logicalType === 'text' &&
    typeof value === 'string' &&
    ((field.validation.minLength !== undefined &&
      value.length < field.validation.minLength) ||
      (field.validation.maxLength !== undefined &&
        value.length > field.validation.maxLength) ||
      (field.validation.pattern !== undefined &&
        !new RegExp(field.validation.pattern).test(value)))
  )
    return 'text_validation'
  if (
    (field.logicalType === 'integer' || field.logicalType === 'decimal') &&
    typeof value === 'number' &&
    ((field.validation.min !== undefined && value < field.validation.min) ||
      (field.validation.max !== undefined && value > field.validation.max))
  )
    return 'numeric_validation'
  if (
    field.logicalType === 'category' &&
    (field.category?.kind !== 'embedded' ||
      !field.category.options.some(
        (option) => option.id === value && option.lifecycle === 'active',
      ))
  )
    return 'invalid_category_option'
  return null
}

/** Structural canonical-value validation shared by non-DB callers. Reference
 * existence/model compatibility remains an authoritative server check. */
export function sheetLocalValueError(
  field: FieldDefinition,
  value: unknown,
): string | null {
  if (value === null)
    return field.nullable || field.defaultValue !== null
      ? null
      : 'required_value'
  const values = field.cardinality === 'many' ? value : [value]
  if (!Array.isArray(values) || values.length === 0 || values.length > 1_000)
    return 'invalid_cardinality'
  if (field.cardinality === 'one' && Array.isArray(value))
    return 'invalid_cardinality'
  for (const item of values) {
    const error = scalarError(field, item)
    if (error) return error
  }
  return null
}

const addressedRow = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('composed'),
      rowKey: composedRowKeySchema,
      identityValues: z.array(z.unknown()).min(1).max(8),
      /** Offset of the current bounded composition page (at most 200 rows). */
      compositionOffset: z.number().int().min(0).max(10_000),
    })
    .strict(),
  z.object({ kind: z.literal('local'), rowKey: uuid }).strict(),
])
const cell = z
  .object({ rowKey: z.string(), fieldId: uuid, value: z.unknown() })
  .strict()

const fieldChange = z.discriminatedUnion('operation', [
  z
    .object({ operation: z.literal('add'), field: sheetFieldDefinitionSchema })
    .strict(),
  z
    .object({ operation: z.literal('edit'), field: sheetFieldDefinitionSchema })
    .strict(),
  z.object({ operation: z.literal('retire'), fieldId: uuid }).strict(),
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

export async function mutateSheetInstanceCalculations(
  input: {
    instanceId: string
    expectedRevision: number
    retryToken: string
    changes: unknown[]
  },
  client: DataClient = createDataClient(),
) {
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

export async function readSheetInstanceCalculationResults(
  instanceId: string,
  rowKeys: string[],
  client: DataClient = createDataClient(),
) {
  return client.rpc<unknown>('read_sheet_instance_calculation_results', {
    p_instance_id: uuid.parse(instanceId),
    p_row_keys: z
      .array(z.union([uuid, composedRowKeySchema]))
      .max(200)
      .parse(rowKeys),
  })
}
