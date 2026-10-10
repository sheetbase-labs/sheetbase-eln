/**
 * Reconstruct a read-only grid from frozen Sheet Instance state.
 * Does not call live composition; it only reads localFields / localValues.
 */
import { z } from 'zod'

import { composedRowKeySchema } from './sheet-instance'

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
  columns?: Array<{ id?: unknown; label?: unknown }>
  rows?: unknown
  rowKeys?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function formatFrozenCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((item) => formatFrozenCell(item))
      .filter(Boolean)
      .join(', ')
  }
  return ''
}

export function frozenSheetGridFromState(
  state: Record<string, unknown>,
): FrozenSheetGrid {
  const fields = Array.isArray(state.localFields)
    ? state.localFields
        .map((field) => asRecord(field))
        .filter((field): field is Record<string, unknown> => field !== null)
        .filter((field) => typeof field.fieldId === 'string')
    : []
  const byId = new Map(
    fields.map((field) => [field.fieldId as string, field] as const),
  )
  const presentation = asRecord(state.presentation) ?? {}
  const columnOrder = Array.isArray(presentation.columnOrder)
    ? presentation.columnOrder.filter(
        (id): id is string => typeof id === 'string',
      )
    : []
  const hidden = new Set(
    Array.isArray(presentation.hiddenColumnIds)
      ? presentation.hiddenColumnIds.filter(
          (id): id is string => typeof id === 'string',
        )
      : [],
  )
  const orderedIds = [
    ...columnOrder.filter((id) => byId.has(id) && !hidden.has(id)),
    ...fields
      .map((field) => field.fieldId as string)
      .filter((id) => !hidden.has(id) && !columnOrder.includes(id)),
  ]
  const columns = orderedIds.map((id) => {
    const field = byId.get(id)
    const label =
      typeof field?.label === 'string' && field.label.trim()
        ? field.label
        : typeof field?.key === 'string'
          ? field.key
          : 'Column'
    return { id, label }
  })
  const localValues = asRecord(state.localValues) ?? {}
  const rows = Object.keys(localValues).map((rowKey) => {
    const row = asRecord(localValues[rowKey]) ?? {}
    return columns.map((column) => formatFrozenCell(row[column.id]))
  })
  return { columns, rows, rowKeys: null }
}

export function frozenSheetGridFromEvidence(evidence: {
  instanceState: Record<string, unknown>
  composedGrid?: FrozenComposedGrid | null
}): FrozenSheetGrid {
  const grid = evidence.composedGrid
  if (grid && Array.isArray(grid.columns) && grid.columns.length > 0) {
    const columns = grid.columns.flatMap((column) => {
      if (typeof column.id !== 'string') return []
      const label =
        typeof column.label === 'string' && column.label.trim()
          ? column.label
          : 'Column'
      return [{ id: column.id, label }]
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
