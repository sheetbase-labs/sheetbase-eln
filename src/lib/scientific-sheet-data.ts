import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'

export type ScientificLogicalType =
  'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'timestamp' | 'category'
export interface ScientificOptionWire {
  id: string
  label: string
  display_order: number
}
export interface ScientificColumnWire {
  id: string
  field_name: string
  label: string
  display_order: number
  logical_type: ScientificLogicalType
  nullable: boolean
  unit: unknown
  validation: Record<string, unknown>
  width: number | null
  options: ScientificOptionWire[]
}
export interface ScientificTableWire {
  id: string
  resource_name: string
  name: string
  schema_version: number
  lifecycle: string
  columns: ScientificColumnWire[]
}
export interface ScientificRowWire {
  id: string
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
}
export const scientificDataClient = createDataClient()

export async function fetchScientificTable(
  client: DataClient,
  tableId: string,
) {
  const result = await client.rpc<ScientificTableWire[]>(
    'scientific_table_metadata',
    { p_table_id: tableId },
  )
  return result[0] ?? null
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
      if (!Number.isFinite(value as number))
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
  const v = column.validation ?? {}
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
