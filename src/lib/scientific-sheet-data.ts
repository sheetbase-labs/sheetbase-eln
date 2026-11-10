import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { z } from 'zod'
import { FIELD_LOGICAL_TYPES } from '#/lib/field-definition'
import type { FieldLogicalType } from '#/lib/field-definition'
import {
  modelFieldUnitSchema,
  modelFieldValidationSchema,
  modelMetadataSchema,
} from '#/lib/model-fields'
import type { ModelMetadataPatch } from '#/lib/model-fields'
import {
  pipelineJsonObjectSchema,
  pipelineJsonValueSchema,
} from '#/lib/pipelines/types'
import { decodeFormulaBindings, decodeFormulaNode } from '#/lib/formula-ir'
import type { PersistedFormulaArtifact } from '#/lib/formula-ir'
import type { ScientificScalar } from '#/lib/scientific-literals'

export type ScientificLogicalType = FieldLogicalType

/** Known wire properties retain their original optional/required contract.
 * The decoders retain extra scientific JSON without exposing an untyped index. */
type ScientificWire<Schema extends z.ZodType> = Pick<
  z.infer<Schema>,
  keyof ModelMetadataPatch<z.infer<Schema>>
>

const scientificOptionSchema = modelMetadataSchema({
  id: z.string(),
  label: z.string(),
  display_order: z.number(),
})

export type ScientificOptionWire = ScientificWire<typeof scientificOptionSchema>

export const scientificColumnSchema = modelMetadataSchema({
  id: z.string(),
  created_at: z.string().optional(),
  field_name: z.string(),
  label: z.string(),
  display_order: z.number(),
  logical_type: z.enum(FIELD_LOGICAL_TYPES),
  nullable: z.boolean(),
  default_value: pipelineJsonValueSchema.optional(),
  unit: modelFieldUnitSchema.nullable(),
  validation: modelFieldValidationSchema,
  width: z.number().nullable(),
  /** Optional numeric format override (for example `0.0E+0`). */
  format: z.string().nullable().optional(),
  options: z.array(scientificOptionSchema),
})

export type ScientificColumnWire = Omit<
  ScientificWire<typeof scientificColumnSchema>,
  'options'
> & { options: ScientificOptionWire[] }

const scientificDatasetSchemaBindingSchema = modelMetadataSchema({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  revision: z.number(),
  status: z.string(),
  latest_published_revision: z.number().nullable(),
})

export type ScientificDatasetSchemaBinding = ScientificWire<
  typeof scientificDatasetSchemaBindingSchema
>

export const scientificTableSchema = modelMetadataSchema({
  id: z.string(),
  created_at: z.string().optional(),
  resource_name: z.string(),
  name: z.string(),
  schema_version: z.number(),
  lifecycle: z.string(),
  columns: z.array(scientificColumnSchema),
  /** Present in the `scientific_table_metadata` RPC result; omitted by some stubs. */
  record_id: z.string().optional(),
  /** SCI-010: dataset schema binding. null for legacy unbound sheets. */
  dataset_schema_id: z.string().nullable().optional(),
  dataset_schema_revision: z.number().nullable().optional(),
  dataset_schema: scientificDatasetSchemaBindingSchema.nullable().optional(),
})

export type ScientificTableWire = Omit<
  ScientificWire<typeof scientificTableSchema>,
  'columns' | 'dataset_schema'
> & {
  columns: ScientificColumnWire[]
  dataset_schema?: ScientificDatasetSchemaBinding | null
}

export const scientificRowSchema = modelMetadataSchema({
  id: z.string(),
  created_at: z.string().optional(),
  version: z.number(),
})

/** Missing fields read as undefined; an explicit non-JSON value is still
 * rejected by scientificRowSchema, rather than omitted or converted. */
export type ScientificRowWire = ScientificWire<typeof scientificRowSchema> &
  Partial<z.infer<typeof pipelineJsonObjectSchema>>

export type ScientificValues = z.infer<typeof pipelineJsonObjectSchema>

export interface ScientificEdit {
  rowId: string
  expectedVersion: number
  values: ScientificValues
}

export type ScientificEditResult =
  | { ok: true; schemaVersion: number; rows: ScientificRowWire[] }
  | {
      ok: false
      errors: Array<{
        rowId: string
        columnId: string
        code: string
        message: string
      }>
    }

const scientificEditResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    schemaVersion: z.number(),
    rows: z.array(scientificRowSchema),
  }),
  z.object({
    ok: z.literal(false),
    errors: z.array(
      z.object({
        rowId: z.string(),
        columnId: z.string(),
        code: z.string(),
        message: z.string(),
      }),
    ),
  }),
])

const scientificResponseSchema = modelMetadataSchema({
  error: modelMetadataSchema({
    code: z.string().optional(),
    message: z.string().optional(),
  }).optional(),
})

export const SCIENTIFIC_PAGE_SIZE = 200

export const scientificQueryKeys = {
  table: (id: string) => ['scientific-table', id] as const,
  rows: (id: string, page: number) => ['scientific-rows', id, page] as const,
  allRows: (id: string) => ['scientific-all-rows', id] as const,
  formulas: (id: string) => ['scientific-formulas', id] as const,
  dependencies: (id: string) => ['scientific-dependencies', id] as const,
  calculationResults: (id: string) =>
    ['scientific-calculation-results', id] as const,
}

export const scientificDataClient = createDataClient()

export interface ScientificColumnInput {
  label: string
  logicalType: ScientificLogicalType
  nullable: boolean
  defaultValue?: ScientificColumnWire['default_value']
  unit?: NonNullable<ScientificColumnWire['unit']>
  validation: ScientificColumnWire['validation']
  options?: Array<{ id: string; label: string }>
}

export interface ScientificSchemaEvidence {
  tableId: string
  columnId: string
  schemaVersion: number
  requiresConfirmation: true
  hash: string
  invalidRows?: number
  nonNullRows?: number
  formulaMarkers: number
  targetType?: ScientificLogicalType
}

export async function fetchScientificTable(
  client: DataClient,
  tableId: string,
): Promise<ScientificTableWire | null> {
  const result = z.array(scientificTableSchema).parse(
    await client.rpc<unknown>('scientific_table_metadata', {
      p_table_id: tableId,
    }),
  )

  return result.length > 0 ? result[0] : null
}

export async function fetchScientificRows(
  client: DataClient,
  table: ScientificTableWire,
  page = 0,
): Promise<ScientificRowWire[]> {
  const offset = Math.max(0, Math.trunc(page)) * SCIENTIFIC_PAGE_SIZE
  const query = `?select=*&order=created_at.asc,id.asc&limit=${SCIENTIFIC_PAGE_SIZE}&offset=${offset}`

  return z
    .array(scientificRowSchema)
    .parse(
      await client.list<unknown>(
        encodeURIComponent(table.resource_name),
        query,
      ),
    )
}

export async function fetchAllScientificRows(
  client: DataClient,
  table: ScientificTableWire,
): Promise<ScientificRowWire[]> {
  return z
    .array(scientificRowSchema)
    .parse(
      await client.list<unknown>(
        encodeURIComponent(table.resource_name),
        '?select=*&order=created_at.asc,id.asc&limit=10001',
      ),
    )
}

const formulaDefinitionSchema = modelMetadataSchema({
  id: z.string(),
  target_table_id: z.string(),
  target_row_id: z.string(),
  target_column_id: z.string(),
  source_expression: z.string(),
  template: pipelineJsonValueSchema,
  bindings: pipelineJsonValueSchema,
  engine_expression: z.string(),
  syntax_profile: z.string(),
  function_profile: z.string(),
  literal_profile: z.string(),
  engine_version: z.string(),
  status: z.enum(['supported', 'unsupported']),
  version: z.union([z.number(), z.string()]),
  created_at: z.string(),
}).transform((value) => {
  const bindings: PersistedFormulaArtifact['bindings'] = decodeFormulaBindings(
    value.bindings,
  )

  const template = decodeFormulaNode(value.template, bindings.length)

  return { ...value, bindings, template }
})

export type FormulaDefinitionWire = z.infer<typeof formulaDefinitionSchema>

const formulaDependencySchema = modelMetadataSchema({
  formula_id: z.string(),
  source_table_id: z.string(),
  source_row_id: z.string(),
  source_column_id: z.string(),
})

export type FormulaDependencyWire = z.infer<typeof formulaDependencySchema>

const formulaResultSchema = modelMetadataSchema({
  formula_id: z.string(),
  target_table_id: z.string(),
  target_row_id: z.string(),
  target_column_id: z.string(),
  cell_kind: z.literal('formula'),
  value_is_authoritative: z.literal(false),
  definition_status: z.enum(['supported', 'unsupported']),
  formula_version: z.union([z.number(), z.string()]),
  current_input_revision: z.union([z.number(), z.string()]),
  calculation_status: z.enum([
    'pending',
    'current',
    'stale',
    'failed',
    'unavailable',
  ]),
  calculated_value: pipelineJsonValueSchema,
  calculation_error_code: z.string().nullable(),
  cache_input_revision: z.union([z.number(), z.string(), z.null()]),
  engine_version: z.string().nullable(),
  profile_fingerprint: z.string().nullable(),
  runtime_fingerprint: z.string().nullable(),
  calculated_at: z.string().nullable(),
})

export type FormulaResultWire = z.infer<typeof formulaResultSchema>

export async function fetchScientificCalculationResults(
  client: DataClient,
  tableId: string,
) {
  const result: FormulaResultWire[] = []
  const pageSize = 1000

  for (let offset = 0; ; offset += pageSize) {
    const page = z
      .array(formulaResultSchema)
      .parse(
        await client.list<unknown>(
          'formula_results',
          `?target_table_id=eq.${encodeURIComponent(tableId)}&order=formula_id.asc&limit=${pageSize}&offset=${offset}`,
        ),
      )

    result.push(...page)

    if (page.length < pageSize) return result
  }
}

export async function requestScientificCalculation(
  recordId: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl('/api/calculations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recordId }),
  })

  const parsed = scientificResponseSchema.safeParse(
    await response.json().catch(() => null),
  )

  const body = parsed.success ? parsed.data : null

  if (!response.ok)
    throw new Error(body?.error?.message ?? 'Trusted calculation failed.')

  return body
}

export async function fetchScientificDependencies(
  client: DataClient,
  tableId: string,
) {
  const result: FormulaDependencyWire[] = []
  const pageSize = 1000

  for (let offset = 0; ; offset += pageSize) {
    const page = z
      .array(formulaDependencySchema)
      .parse(
        await client.list<unknown>(
          'formula_dependencies',
          `?source_table_id=eq.${encodeURIComponent(tableId)}&order=formula_id.asc,source_row_id.asc,source_column_id.asc&limit=${pageSize}&offset=${offset}`,
        ),
      )

    result.push(...page)

    if (page.length < pageSize) return result
  }
}

export async function fetchScientificFormulas(
  client: DataClient,
  tableId: string,
) {
  const result: FormulaDefinitionWire[] = []
  const pageSize = 1000

  for (let offset = 0; ; offset += pageSize) {
    const page = z
      .array(formulaDefinitionSchema)
      .parse(
        await client.list<unknown>(
          'formula_definitions',
          `?target_table_id=eq.${encodeURIComponent(tableId)}&order=created_at.asc,id.asc&limit=${pageSize}&offset=${offset}`,
        ),
      )

    result.push(...page)

    if (page.length < pageSize) return result
  }
}

export class FormulaMutationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'FormulaMutationError'
  }
}

export type FormulaMutationInput =
  | {
      operation: 'create'
      target: { tableId: string; rowId: string; columnId: string }
      expectedSchemaVersion: number
      expectedRowVersion: number
      source: string
    }
  | {
      operation: 'update'
      target: { tableId: string; rowId: string; columnId: string }
      expectedSchemaVersion: number
      expectedRowVersion: number
      expectedFormulaVersion: number
      source: string
    }
  | {
      operation: 'remove'
      target: { tableId: string; rowId: string; columnId: string }
      expectedSchemaVersion: number
      expectedRowVersion: number
      expectedFormulaVersion: number
      replacement: ScientificScalar
    }

export async function mutateScientificFormula(
  input: FormulaMutationInput,
  fetchImpl: typeof fetch = fetch,
) {
  // Reject non-finite replacement values before JSON serialization changes them.
  pipelineJsonObjectSchema.parse(input)

  const response = await fetchImpl('/api/formulas', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  })

  const parsed = scientificResponseSchema.safeParse(
    await response.json().catch(() => null),
  )

  const body = parsed.success ? parsed.data : null

  if (!response.ok)
    throw new FormulaMutationError(
      body?.error?.code ?? 'formula_write_failed',
      response.status,
      body?.error?.message ?? 'Could not save the formula.',
    )

  return body
}

export async function applyScientificRowChanges(
  client: DataClient,
  tableId: string,
  schemaVersion: number,
  edits: ScientificEdit[],
  inserts: ScientificValues[],
): Promise<ScientificEditResult> {
  const args = {
    p_table_id: tableId,
    p_expected_schema_version: schemaVersion,
    p_edits: edits,
    p_inserts: inserts,
  }

  pipelineJsonObjectSchema.parse(args)

  return scientificEditResultSchema.parse(
    await client.rpc<unknown>('apply_scientific_row_changes', args),
  )
}

export interface ScientificImportInput {
  tableId: string
  schemaVersion: number
  file: {
    name: string
    size: number
    sha256: string
    encoding: string
    delimiter: string
    header: boolean
  }
  mappings: ScientificValues[]
  rows: ScientificValues[]
  duplicateStrategy: 'allow' | 'reject_file' | 'skip_file'
}

export async function importScientificRows(
  client: DataClient,
  input: ScientificImportInput,
) {
  const args = {
    p_table_id: input.tableId,
    p_expected_schema_version: input.schemaVersion,
    p_file: input.file,
    p_mappings: input.mappings,
    p_rows: input.rows,
    p_duplicate_strategy: input.duplicateStrategy,
  }

  pipelineJsonObjectSchema.parse(args)

  const response = await client.rpc<unknown>('import_scientific_rows', args)

  return {
    ...scientificEditResultSchema.parse(response),
    ...z
      .object({
        transferId: z.string(),
        importedRows: z.number(),
        skippedDuplicates: z.number(),
        schemaVersion: z.number(),
      })
      .parse(response),
  }
}

export async function recordScientificExport(
  client: DataClient,
  tableId: string,
  rowCount: number,
) {
  return pipelineJsonObjectSchema.parse(
    await client.rpc<unknown>('record_scientific_export', {
      p_table_id: tableId,
      p_row_count: rowCount,
      p_format: 'csv+metadata',
    }),
  )
}

/**
 * Delete rows from a scientific table by ID via PostgREST. The database
 * trigger on the dynamic table raises an exception (23514) if any row has
 * formula targets or is referenced by formula dependencies — the error is
 * surfaced to the caller.
 */
export async function deleteScientificRows(
  client: DataClient,
  resource: string,
  rowIds: string[],
) {
  const query = `?id=in.(${rowIds.map((id) => encodeURIComponent(id)).join(',')})`

  return client.remove(encodeURIComponent(resource), query)
}

export async function renameScientificTable(
  client: DataClient,
  tableId: string,
  schemaVersion: number,
  name: string,
) {
  return pipelineJsonObjectSchema.parse(
    await client.rpc<unknown>('update_scientific_table_display', {
      p_table_id: tableId,
      p_expected_schema_version: schemaVersion,
      p_name: name,
    }),
  )
}

export async function addScientificColumn(
  client: DataClient,
  tableId: string,
  schemaVersion: number,
  input: ScientificColumnInput,
) {
  const args = {
    p_table_id: tableId,
    p_expected_schema_version: schemaVersion,
    p_label: input.label,
    p_logical_type: input.logicalType,
    p_nullable: input.nullable,
    p_unit: modelFieldUnitSchema.nullable().parse(input.unit ?? null),
    p_validation: modelFieldValidationSchema.parse(input.validation),
    p_options: input.options ?? null,
    // Undefined means no default. The SQL contract deliberately also treats
    // JSON null as omitted; required defaults therefore cannot be null.
    p_default: Object.hasOwn(input, 'defaultValue')
      ? pipelineJsonValueSchema.optional().parse(input.defaultValue)
      : null,
  }

  return pipelineJsonObjectSchema.parse(
    await client.rpc<unknown>('add_scientific_column', args),
  )
}

export async function updateScientificColumnDisplay(
  client: DataClient,
  columnId: string,
  schemaVersion: number,
  label: string | null,
  displayOrder: number | null,
) {
  return pipelineJsonObjectSchema.parse(
    await client.rpc<unknown>('update_scientific_column_display', {
      p_column_id: columnId,
      p_expected_schema_version: schemaVersion,
      p_label: label,
      p_display_order: displayOrder,
    }),
  )
}

export function preflightScientificConversion(
  client: DataClient,
  columnId: string,
  schemaVersion: number,
  type: ScientificLogicalType,
  hash: string | null = null,
) {
  return client.rpc<ScientificSchemaEvidence | { converted: true }>(
    'convert_scientific_column',
    {
      p_column_id: columnId,
      p_expected_schema_version: schemaVersion,
      p_new_logical_type: type,
      p_confirmation_hash: hash,
    },
  )
}

export function preflightScientificRetirement(
  client: DataClient,
  columnId: string,
  schemaVersion: number,
  hash: string | null = null,
) {
  return client.rpc<ScientificSchemaEvidence | { retired: true }>(
    'retire_scientific_column',
    {
      p_column_id: columnId,
      p_expected_schema_version: schemaVersion,
      p_confirmation_hash: hash,
    },
  )
}

export interface CellValidationError {
  row: number
  columnId: string
  message: string
}

/** Strict, total conversion at the client boundary. Throws before any RPC. */
export function decodeScientificValue(
  column: ScientificColumnWire,
  input: ScientificColumnWire['default_value'],
): ScientificScalar {
  const decoded = z
    .union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])
    .safeParse(input)

  if (!decoded.success)
    throw new Error(`${column.label} must be a scalar value.`)

  if (input === '' || input === null || input === undefined) {
    if (!column.nullable) throw new Error(`${column.label} is required.`)

    return null
  }

  let value: ScientificScalar
  const text = String(decoded.data)

  switch (column.logical_type) {
    case 'integer':
      if (!/^[+-]?\d+$/.test(text))
        throw new Error(`${column.label} must be an integer.`)
      value = Number(text)

      if (!Number.isSafeInteger(value))
        throw new Error(`${column.label} is outside the integer range.`)
      break
    case 'decimal':
      value = Number(text)

      if (!Number.isFinite(value))
        throw new Error(`${column.label} must be a finite number.`)
      break
    case 'boolean':
      if (input === true || input === 'true' || input === 1 || input === '1')
        value = true
      else if (
        input === false ||
        input === 'false' ||
        input === 0 ||
        input === '0'
      )
        value = false
      else throw new Error(`${column.label} must be true or false.`)
      break
    case 'category': {
      const option = column.options.find(
        (o) => o.id === input || o.label === input,
      )

      if (!option) throw new Error(`${column.label} must be a known category.`)
      value = option.id
      break
    }

    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
        throw new Error(`${column.label} must be YYYY-MM-DD.`)
      const d = new Date(`${text}T00:00:00Z`)

      if (Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== text)
        throw new Error(`${column.label} is not a valid date.`)
      value = text
      break
    }

    case 'timestamp': {
      const d = new Date(text)

      if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || Number.isNaN(d.valueOf()))
        throw new Error(`${column.label} must be a valid timestamp.`)
      value = text
      break
    }

    default:
      value = text
  }

  const v = column.validation
  const numeric = z.number().safeParse(value)
  const string = z.string().safeParse(value)
  const n = numeric.success ? numeric.data : null
  const s = string.success ? string.data : null

  if (n !== null && v.min !== undefined && n < v.min)
    throw new Error(`${column.label} is below its minimum.`)

  if (n !== null && v.max !== undefined && n > v.max)
    throw new Error(`${column.label} is above its maximum.`)

  if (s !== null && v.minLength !== undefined && s.length < v.minLength)
    throw new Error(`${column.label} is too short.`)

  if (s !== null && v.maxLength !== undefined && s.length > v.maxLength)
    throw new Error(`${column.label} is too long.`)

  if (s !== null && v.pattern !== undefined) {
    let regex: RegExp

    try {
      regex = new RegExp(v.pattern)
    } catch {
      throw new Error(`${column.label} has invalid validation metadata.`)
    }

    if (!regex.test(s))
      throw new Error(`${column.label} has an invalid format.`)
  }

  return value
}
