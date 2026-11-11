import { columnLabel, orderColumnsById } from '@sheetbase-labs/sheetbase-table'
import type {
  CellFormat,
  ColumnSource,
  DatasetFieldHeader,
  SpreadsheetHydrationCell,
} from '@sheetbase-labs/sheetbase-table'
import { useMemo } from 'react'

import { gridStoredText } from './grid-client-values'
import type {
  SheetbaseGridColumn,
  SheetbaseGridProps,
  SheetbaseGridRow,
} from './sheetbase-grid'

export function cellAddress(row: number, column: number): string {
  return `${columnLabel(column)}${row + 1}`
}

function dataTypeOf(
  column: SheetbaseGridColumn,
): DatasetFieldHeader['dataType'] {
  switch (column.type) {
    case 'number':
      return 'number'
    case 'checkbox':
      return 'boolean'
    case 'date':
      return 'date'
    case 'datetime':
      return 'datetime'
    case 'record':
      return 'relationship'
    default:
      return 'text'
  }
}

function numberFormatOf(
  pattern: string | undefined,
): CellFormat['numberFormat'] {
  if (!pattern) return undefined

  if (pattern.includes('%')) return 'percent'

  if (/[¤$€£]/.test(pattern)) return 'currency'

  if (/[ymd]/i.test(pattern)) return 'date'

  return 'number'
}

function sourceOf(column: SheetbaseGridColumn): ColumnSource {
  if (column.source === 'calculated') return 'calc'

  if (column.type === 'record') return 'record'

  if (column.source === 'local') return 'local'

  return 'dataset'
}

export function datasetFields(
  columns: readonly SheetbaseGridColumn[],
  readOnly: boolean,
): DatasetFieldHeader[] {
  return columns.map((column, index) => ({
    id: column.id,
    label: column.label,
    column: index,
    writable: !column.readOnly && !readOnly && column.source !== 'calculated',
    computed: column.source === 'calculated',
    source: column.showSource === false ? undefined : sourceOf(column),
    sourceLabel: column.sourceLabel,
    dataType: dataTypeOf(column),
    options: column.options,
    numberFormat: numberFormatOf(column.numberFormat),
    displayText: column.displayText,
  }))
}

export function columnGroupsOf(columns: readonly SheetbaseGridColumn[]) {
  const groups: { label: string; columns: number[] }[] = []
  columns.forEach((column, index) => {
    if (!column.group) return
    const current = groups.at(-1)

    if (current?.label === column.group) current.columns.push(index)
    else groups.push({ label: column.group, columns: [index] })
  })

  return groups.length > 0 ? groups : undefined
}

export function buildDisplayMap(
  rows: readonly SheetbaseGridRow[],
  columns: readonly SheetbaseGridColumn[],
): Map<string, string> {
  const map = new Map<string, string>()
  rows.forEach((row, rowIndex) => {
    columns.forEach((_column, columnIndex) => {
      map.set(
        cellAddress(rowIndex, columnIndex),
        gridStoredText(row.cells[columnIndex]),
      )
    })
  })

  return map
}

export function buildCellMap(
  rows: readonly SheetbaseGridRow[],
  columns: readonly SheetbaseGridColumn[],
): Map<string, SpreadsheetHydrationCell> {
  const map = new Map<string, SpreadsheetHydrationCell>()

  for (const [address, value] of buildDisplayMap(rows, columns)) {
    map.set(address, { display: value, binding: { kind: 'literal', value } })
  }

  return map
}

/** Positional engine arrays and identity indexes always describe the same layout. */
export function useGridLayout(props: SheetbaseGridProps) {
  const {
    columns,
    rows,
    columnOrder,
    readOnly = false,
    initialColumnWidths,
    columnWidth,
  } = props

  const orderedColumns = useMemo(
    () => orderColumnsById(columns, columnOrder),
    [columns, columnOrder],
  )

  const columnIndex = useMemo(
    () => new Map(columns.map((column, index) => [column.id, index])),
    [columns],
  )

  const orderedRows = useMemo(
    () =>
      !columnOrder?.length
        ? rows
        : rows.map((row) => ({
            id: row.id,
            cells: orderedColumns.map(
              (column) => row.cells[columnIndex.get(column.id) ?? -1] ?? null,
            ),
          })),
    [rows, columnOrder, orderedColumns, columnIndex],
  )

  const layout = useMemo(
    () => ({
      columns: orderedColumns,
      rows: orderedRows,
      columnIndex: new Map(
        orderedColumns.map((column, index) => [column.id, index]),
      ),
      rowIndex: new Map(orderedRows.map((row, index) => [row.id, index])),
    }),
    [orderedColumns, orderedRows],
  )

  const fields = useMemo(
    () => datasetFields(orderedColumns, readOnly),
    [orderedColumns, readOnly],
  )

  const datasetHeader = useMemo(
    () => ({ fields, recordIdForRow: (row: number) => orderedRows[row]?.id }),
    [fields, orderedRows],
  )

  const widths = useMemo(() => {
    const resolved: number[] = []

    orderedColumns.forEach((column, index) => {
      const width =
        columnWidth?.(column.id) ??
        initialColumnWidths?.[columnIndex.get(column.id) ?? -1] ??
        column.width

      // Absent entries keep the engine's own per-column default widths.
      if (width !== undefined) resolved[index] = width
    })

    return resolved.length ? resolved : undefined
  }, [orderedColumns, columnWidth, initialColumnWidths, columnIndex])

  const initialData = useMemo(
    () => buildDisplayMap(orderedRows, orderedColumns),
    [orderedRows, orderedColumns],
  )

  const fieldIds = useMemo(
    () => orderedColumns.map((column) => column.id),
    [orderedColumns],
  )

  const columnGroups = useMemo(
    () => columnGroupsOf(orderedColumns),
    [orderedColumns],
  )

  const mountKey = `${columns
    .map((column) => column.id)
    .sort()
    .join('|')}::${columnOrder?.join('|') ?? ''}`

  return {
    layout,
    datasetHeader,
    widths,
    initialData,
    fieldIds,
    columnGroups,
    mountKey,
  }
}

export type GridClientLayout = ReturnType<typeof useGridLayout>['layout']
