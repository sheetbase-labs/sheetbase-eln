/**
 * Reconstruct a read-only grid from frozen Sheet Instance state.
 * Does not call live composition; it only reads localFields / localValues.
 */
import { z } from 'zod'

import { composedRowKeySchema } from './sheet-instance'

/** One value as a `jsonb` column holds it. */
const jsonValue = z.json()

type FrozenJson = z.output<typeof jsonValue>

/** A stored JSON object: what a frozen instance state is. */
const jsonObject = z.record(z.string(), jsonValue)

/** A frozen Sheet Instance state, as the evidence stores it. */
export type FrozenSheetState = z.output<typeof jsonObject>

export type FrozenSheetGridColumn = {
  id: string
  label: string
}

export type FrozenSheetGrid = {
  columns: FrozenSheetGridColumn[]
  rows: string[][]
  /** Only explicit submitted composed identities permit cell comments. */
  rowKeys: string[] | null
}

export type FrozenComposedGrid = {
  columns?: Array<{ id?: FrozenJson; label?: FrozenJson }>
  rows?: FrozenJson
  rowKeys?: FrozenJson
}

const stringValue = z.string()
const booleanValue = z.boolean()
const numberValue = z.number()

/** One local field of a frozen state; an entry of any other shape is not one. */
const localFieldSchema = z.object({
  fieldId: z.string(),
  key: z.string().optional(),
  label: z.string().optional(),
})

const localFieldsSchema = z
  .array(jsonValue)
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const field = localFieldSchema.safeParse(entry)

      return field.success ? [field.data] : []
    }),
  )

const stringListSchema = z
  .array(jsonValue)
  .catch([])
  .transform((items) =>
    items.flatMap((item) => {
      const text = stringValue.safeParse(item)

      return text.success ? [text.data] : []
    }),
  )

/** A stored JSON object, or nothing when the value is of any other shape. */
function asRecord(value: FrozenJson | undefined): FrozenSheetState | null {
  const parsed = jsonObject.safeParse(value)

  return parsed.success ? parsed.data : null
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A frozen cell is stored JSON of no shape this module knows; the guards below decide what it is and every other shape reads as an empty cell.
export function formatFrozenCell(value: unknown): string {
  if (value === null || value === undefined) return ''

  const flag = booleanValue.safeParse(value)

  if (flag.success) return flag.data ? 'Yes' : 'No'

  const number = numberValue.safeParse(value)

  if (number.success)
    return Number.isFinite(number.data) ? String(number.data) : ''

  const text = stringValue.safeParse(value)

  if (text.success) return text.data

  if (Array.isArray(value)) {
    return value
      .map((item) => formatFrozenCell(item))
      .filter(Boolean)
      .join(', ')
  }

  return ''
}

/** The header a column shows: its declared label, else its key, else a stand-in. */
function columnLabel(
  label: FrozenJson | undefined,
  key: FrozenJson | undefined,
): string {
  const declared = stringValue.safeParse(label)

  if (declared.success && declared.data.trim()) return declared.data

  const fallback = stringValue.safeParse(key)

  return fallback.success ? fallback.data : 'Column'
}

export function frozenSheetGridFromState(
  state: FrozenSheetState,
): FrozenSheetGrid {
  const fields = localFieldsSchema.parse(state.localFields)
  const byId = new Map(fields.map((field) => [field.fieldId, field]))

  const presentation = asRecord(state.presentation) ?? {}
  const columnOrder = stringListSchema.parse(presentation.columnOrder)
  const requestedOrder = new Set(columnOrder)
  const hidden = new Set(stringListSchema.parse(presentation.hiddenColumnIds))

  const orderedIds = [
    ...columnOrder.filter((id) => byId.has(id) && !hidden.has(id)),
    ...fields
      .map((field) => field.fieldId)
      .filter((id) => !hidden.has(id) && !requestedOrder.has(id)),
  ]

  const columns = orderedIds.map((id) => {
    const field = byId.get(id)

    return { id, label: columnLabel(field?.label, field?.key) }
  })

  const localValues = asRecord(state.localValues) ?? {}

  const rows = Object.keys(localValues).map((rowKey) => {
    const row = asRecord(localValues[rowKey]) ?? {}

    return columns.map((column) => formatFrozenCell(row[column.id]))
  })

  return { columns, rows, rowKeys: null }
}

export function frozenSheetGridFromEvidence(evidence: {
  instanceState: FrozenSheetState
  composedGrid?: FrozenComposedGrid | null
}): FrozenSheetGrid {
  const grid = evidence.composedGrid

  if (grid && Array.isArray(grid.columns) && grid.columns.length > 0) {
    const columns = grid.columns.flatMap((column) => {
      const id = stringValue.safeParse(column.id)

      if (!id.success) return []

      return [{ id: id.data, label: columnLabel(column.label, undefined) }]
    })

    const rows = Array.isArray(grid.rows)
      ? grid.rows.map((row) =>
          Array.isArray(row)
            ? row.map((cell) => formatFrozenCell(cell))
            : columns.map(() => ''),
        )
      : []

    const identities = z
      .array(z.union([z.uuid(), composedRowKeySchema]))
      .safeParse(grid.rowKeys)

    const rowKeys =
      identities.success &&
      identities.data.length === rows.length &&
      new Set(identities.data).size === rows.length
        ? identities.data
        : null

    return { columns, rows, rowKeys }
  }

  return frozenSheetGridFromState(evidence.instanceState)
}
