import { z } from 'zod'

import type { FieldDefinition } from './field-definition'
import type { DataClient } from './data-client'
import { createDataClient, DataClientError } from './data-client'
import { validateFieldValue } from './field-value-validation'
import { composedRowKeySchema } from './sheet-instance'
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
  value: unknown,
): string | null {
  return validateFieldValue(field, value)
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

const calculationCompletionSchema = z
  .object({
    instanceId: uuid,
    revision: z.number().int().positive(),
    rowCount: z.number().int().nonnegative(),
    calculationCount: z.number().int().nonnegative(),
    status: z.literal('completed'),
  })
  .passthrough()

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
