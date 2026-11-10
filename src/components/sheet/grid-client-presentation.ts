import {
  buildGridView,
  parseAddress,
  viewSourceRow,
} from '@sheetbase-labs/sheetbase-table'
import type {
  DatasetQuery,
  FilterClause,
  FilterOperator,
  SpreadsheetHandle,
  SpreadsheetMenuAction,
  SpreadsheetSelection,
} from '@sheetbase-labs/sheetbase-table'
import { z } from 'zod'

import type {
  SheetbaseGridFilter,
  SheetbaseGridMenuEntry,
  SheetbaseGridMenuItem,
  SheetbaseGridProps,
  SheetbaseGridSelection,
} from './sheetbase-grid'
import { buildDisplayMap, cellAddress } from './grid-client-layout'
import type { GridClientLayout } from './grid-client-layout'

const PACKAGE_OPERATOR = {
  equals: 'eq',
  'not-equals': 'neq',
  'is-empty': 'isNull',
  'is-not-empty': 'notNull',
} satisfies Record<SheetbaseGridFilter['operator'], FilterOperator>

function neutralOperator(
  operator: FilterOperator,
): SheetbaseGridFilter['operator'] | undefined {
  switch (operator) {
    case 'eq':
      return 'equals'
    case 'neq':
      return 'not-equals'
    case 'isNull':
      return 'is-empty'
    case 'notNull':
      return 'is-not-empty'
    default:
      return undefined
  }
}

export function gridQuery(
  props: Pick<SheetbaseGridProps, 'columns' | 'sorts' | 'filters'>,
): DatasetQuery {
  const ids = new Set(props.columns.map((column) => column.id))

  return {
    sort: (props.sorts ?? [])
      .filter((entry) => ids.has(entry.columnId))
      .map((entry) => ({
        fieldId: entry.columnId,
        direction: entry.direction,
      })),
    filters: (props.filters ?? [])
      .filter((entry) => ids.has(entry.columnId))
      .map((entry) => ({
        fieldId: entry.columnId,
        operator: PACKAGE_OPERATOR[entry.operator],
        value: entry.value ?? undefined,
      })),
  }
}

// FilterClause.value is unknown in the installed shared query declarations.
// Decode only this external input, not typed grid rows or clipboard strings.
const filterValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
])

export function captureGridFilters(
  next: readonly FilterClause[],
  props: SheetbaseGridProps,
): SheetbaseGridFilter[] {
  const captured: SheetbaseGridFilter[] = []
  const capturedIds = new Set<string>()

  for (const clause of next) {
    const operator = neutralOperator(clause.operator)

    if (!operator) continue
    const value = filterValueSchema.safeParse(clause.value)
    captured.push({
      columnId: clause.fieldId,
      operator,
      value: value.success ? value.data : undefined,
    })
    capturedIds.add(clause.fieldId)
  }

  const displayIds = new Set(props.columns.map((column) => column.id))

  const preserved = (props.filters ?? []).filter(
    (filter) =>
      !displayIds.has(filter.columnId) && !capturedIds.has(filter.columnId),
  )

  return [...preserved, ...captured]
}

function isMenuItem(
  entry: SheetbaseGridMenuEntry,
): entry is SheetbaseGridMenuItem {
  return entry instanceof Object
}

export function gridMenuActions(
  entries: readonly SheetbaseGridMenuEntry[] | false | undefined,
  layout: GridClientLayout,
  columnMenu = false,
): SpreadsheetMenuAction[] {
  if (!entries) return []

  return entries.filter(isMenuItem).map((entry) => ({
    id: entry.id,
    label: entry.label,
    disabled: entry.disabled,
    onSelect: ({ axis, index, fieldId }) => {
      const row = !columnMenu && axis === 'row'
      entry.onSelect?.({
        ranges: [
          {
            rowStart: row ? index : 0,
            rowEnd: row ? index : Math.max(0, layout.rows.length - 1),
            columnIds:
              !row && fieldId
                ? [fieldId]
                : layout.columns.map((column) => column.id),
          },
        ],
      })
    },
  }))
}

export function gridSelection(
  selection: SpreadsheetSelection,
  layout: GridClientLayout,
  handle: SpreadsheetHandle | null,
  query: DatasetQuery,
): SheetbaseGridSelection | null {
  if (!selection.address || !selection.range) return null
  const { row, column } = parseAddress(selection.address)
  const definition = layout.columns.at(column)

  if (!definition) return null

  const values =
    handle?.snapshot().data ?? buildDisplayMap(layout.rows, layout.columns)

  const view = buildGridView({
    rowCount: layout.rows.length,
    query: handle?.getQuery() ?? query,
    columnFor: (fieldId) => layout.columnIndex.get(fieldId),
    valueAt: (sourceRow, sourceColumn) =>
      values.get(cellAddress(sourceRow, sourceColumn)) ?? '',
    hasRow: (sourceRow) => Boolean(layout.rows[sourceRow]?.id),
  })

  const [start, end = start] = selection.range.split(':').map(parseAddress)
  const rowIds: string[] = []

  for (
    let displayRow = Math.min(start.row, end.row);
    displayRow <= Math.max(start.row, end.row);
    displayRow++
  ) {
    const id = layout.rows[viewSourceRow(view, displayRow)]?.id

    if (id) rowIds.push(id)
  }

  return {
    rowIndex: row,
    rowId: layout.rows[row]?.id,
    columnId: definition.id,
    input: selection.input,
    rowIds,
    columnIds: layout.columns
      .slice(
        Math.min(start.column, end.column),
        Math.max(start.column, end.column) + 1,
      )
      .map((field) => field.id),
  }
}
