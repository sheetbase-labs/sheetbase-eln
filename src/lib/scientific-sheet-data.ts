import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import type { FieldLogicalType } from '#/lib/field-definition'
import { chunkIds } from '#/lib/postgrest-in-list'

export type ScientificLogicalType = FieldLogicalType
export interface ScientificOptionWire {
  id: string
  label: string
  display_order: number
}
export interface ScientificColumnWire {
  id: string
  created_at?: string
  field_name: string
  label: string
  display_order: number
  logical_type: ScientificLogicalType
  nullable: boolean
  default_value?: unknown
  unit: unknown
  validation: Record<string, unknown>
  width: number | null
  /** Optional Handsontable numeric format override (for example `0.0E+0`). */
  format?: string | null
  options: ScientificOptionWire[]
}
export interface ScientificDatasetSchemaBinding {
  id: string
  slug: string
  name: string
  revision: number
  status: string
  latest_published_revision: number | null
}
export interface ScientificTableWire {
  id: string
  created_at?: string
  resource_name: string
  name: string
  schema_version: number
  lifecycle: string
  columns: ScientificColumnWire[]
  /** Present in the `scientific_table_metadata` RPC result; omitted by some stubs. */
  record_id?: string
  /** SCI-010: dataset schema binding. null for legacy unbound sheets. */
  dataset_schema_id?: string | null
  dataset_schema_revision?: number | null
  dataset_schema?: ScientificDatasetSchemaBinding | null
}
export interface ScientificRowWire {
  id: string
  created_at?: string
  version: number
  [field: string]: unknown
}
export interface ScientificEdit {
  rowId: string
  expectedVersion: number
  values: Record<string, unknown>
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
  defaultValue?: unknown
  unit?: Record<string, unknown>
  validation: Record<string, unknown>
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
) {
  const result = await client.rpc<ScientificTableWire[]>(
    'scientific_table_metadata',
    { p_table_id: tableId },
  )
  return result.length > 0 ? result[0] : null
}
export async function fetchScientificRows(
  client: DataClient,
  table: ScientificTableWire,
  page = 0,
) {
  const offset = Math.max(0, Math.trunc(page)) * SCIENTIFIC_PAGE_SIZE
  const query = `?select=*&order=created_at.asc,id.asc&limit=${SCIENTIFIC_PAGE_SIZE}&offset=${offset}`
  return client.list<ScientificRowWire>(
    encodeURIComponent(table.resource_name),
    query,
  )
}

export function fetchAllScientificRows(
  client: DataClient,
  table: ScientificTableWire,
) {
  return client.list<ScientificRowWire>(
    encodeURIComponent(table.resource_name),
    '?select=*&order=created_at.asc,id.asc&limit=10001',
  )
}

export interface FormulaDefinitionWire {
  id: string
  target_table_id: string
  target_row_id: string
  target_column_id: string
  source_expression: string
  template: unknown
  bindings: unknown
  engine_expression: string
  syntax_profile: string
  function_profile: string
  literal_profile: string
  engine_version: string
  status: 'supported' | 'unsupported'
  version: number | string
  created_at: string
}

export interface FormulaDependencyWire {
  formula_id: string
  source_table_id: string
  source_row_id: string
  source_column_id: string
}

export interface FormulaResultWire {
  formula_id: string
  target_table_id: string
  target_row_id: string
  target_column_id: string
  cell_kind: 'formula'
  value_is_authoritative: false
  definition_status: 'supported' | 'unsupported'
  formula_version: number | string
  current_input_revision: number | string
  calculation_status: 'pending' | 'current' | 'stale' | 'failed' | 'unavailable'
  calculated_value: unknown
  calculation_error_code: string | null
  cache_input_revision: number | string | null
  engine_version: string | null
  profile_fingerprint: string | null
  runtime_fingerprint: string | null
  calculated_at: string | null
}

export async function fetchScientificCalculationResults(
  client: DataClient,
  tableId: string,
) {
  const result: FormulaResultWire[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const page = await client.list<FormulaResultWire>(
      'formula_results',
      `?target_table_id=eq.${encodeURIComponent(tableId)}&order=formula_id.asc&limit=${pageSize}&offset=${offset}`,
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
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string }
  } | null
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
    const page = await client.list<FormulaDependencyWire>(
      'formula_dependencies',
      `?source_table_id=eq.${encodeURIComponent(tableId)}&order=formula_id.asc,source_row_id.asc,source_column_id.asc&limit=${pageSize}&offset=${offset}`,
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
    const page = await client.list<FormulaDefinitionWire>(
      'formula_definitions',
      `?target_table_id=eq.${encodeURIComponent(tableId)}&order=created_at.asc,id.asc&limit=${pageSize}&offset=${offset}`,
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
      replacement: unknown
    }

export async function mutateScientificFormula(
  input: FormulaMutationInput,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl('/api/formulas', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  })
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string }
  } | null
  if (!response.ok)
    throw new FormulaMutationError(
      body?.error?.code ?? 'formula_write_failed',
      response.status,
      body?.error?.message ?? 'Could not save the formula.',
    )
  return body
}
export function applyScientificRowChanges(
  client: DataClient,
  tableId: string,
  schemaVersion: number,
  edits: ScientificEdit[],
  inserts: Array<Record<string, unknown>>,
) {
  return client.rpc<ScientificEditResult>('apply_scientific_row_changes', {
    p_table_id: tableId,
    p_expected_schema_version: schemaVersion,
    p_edits: edits,
    p_inserts: inserts,
  })
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
  mappings: Array<Record<string, unknown>>
  rows: Array<Record<string, unknown>>
  duplicateStrategy: 'allow' | 'reject_file' | 'skip_file'
}

export function importScientificRows(
  client: DataClient,
  input: ScientificImportInput,
) {
  return client.rpc<
    ScientificEditResult & {
      transferId: string
      importedRows: number
      skippedDuplicates: number
      schemaVersion: number
    }
  >('import_scientific_rows', {
    p_table_id: input.tableId,
    p_expected_schema_version: input.schemaVersion,
    p_file: input.file,
    p_mappings: input.mappings,
    p_rows: input.rows,
    p_duplicate_strategy: input.duplicateStrategy,
  })
}

export function recordScientificExport(
  client: DataClient,
  tableId: string,
  rowCount: number,
) {
  return client.rpc('record_scientific_export', {
    p_table_id: tableId,
    p_row_count: rowCount,
    p_format: 'csv+metadata',
  })
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
  // Chunked deletes: the row-id set is a user selection of arbitrary size,
  // so it must stay under the proxy's per-value cap like every other
  // `in.()` list. Chunks are disjoint, so the merged result is the union.
  const deleted = await Promise.all(
    chunkIds(rowIds).map((chunk) =>
      client.remove(
        encodeURIComponent(resource),
        `?id=in.(${chunk.map((id) => encodeURIComponent(id)).join(',')})`,
      ),
    ),
  )
  return deleted.flat()
}

export function renameScientificTable(
  client: DataClient,
  tableId: string,
  schemaVersion: number,
  name: string,
) {
  return client.rpc('update_scientific_table_display', {
    p_table_id: tableId,
    p_expected_schema_version: schemaVersion,
    p_name: name,
  })
}

export function addScientificColumn(
  client: DataClient,
  tableId: string,
  schemaVersion: number,
  input: ScientificColumnInput,
) {
  const args: Record<string, unknown> = {
    p_table_id: tableId,
    p_expected_schema_version: schemaVersion,
    p_label: input.label,
    p_logical_type: input.logicalType,
    p_nullable: input.nullable,
    p_unit: input.unit ?? null,
    p_validation: input.validation,
    p_options: input.options ?? null,
  }
  // Undefined means no default. The SQL contract deliberately also treats
  // JSON null as omitted; required defaults therefore cannot be null.
  args.p_default = Object.hasOwn(input, 'defaultValue')
    ? input.defaultValue
    : null
  return client.rpc('add_scientific_column', args)
}

export function updateScientificColumnDisplay(
  client: DataClient,
  columnId: string,
  schemaVersion: number,
  label: string | null,
  displayOrder: number | null,
) {
  return client.rpc('update_scientific_column_display', {
    p_column_id: columnId,
    p_expected_schema_version: schemaVersion,
    p_label: label,
    p_display_order: displayOrder,
  })
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
  input: unknown,
): unknown {
  if (input === '' || input === null || input === undefined) {
    if (!column.nullable) throw new Error(`${column.label} is required.`)
    return null
  }
  let value: unknown
  const text = typeof input === 'string' ? input : String(input)
  switch (column.logical_type) {
    case 'integer':
      if (!/^[+-]?\d+$/.test(text))
        throw new Error(`${column.label} must be an integer.`)
      value = Number(text)
      if (!Number.isSafeInteger(value))
        throw new Error(`${column.label} is outside the integer range.`)
      break
    case 'decimal':
      value = typeof input === 'number' ? input : Number(text)
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
  const n = typeof value === 'number' ? value : null
  const s = typeof value === 'string' ? value : null
  if (n !== null && typeof v.min === 'number' && n < v.min)
    throw new Error(`${column.label} is below its minimum.`)
  if (n !== null && typeof v.max === 'number' && n > v.max)
    throw new Error(`${column.label} is above its maximum.`)
  if (s !== null && typeof v.minLength === 'number' && s.length < v.minLength)
    throw new Error(`${column.label} is too short.`)
  if (s !== null && typeof v.maxLength === 'number' && s.length > v.maxLength)
    throw new Error(`${column.label} is too long.`)
  if (s !== null && typeof v.pattern === 'string') {
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
