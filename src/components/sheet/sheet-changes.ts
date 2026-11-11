/**
 * Show changes for a sheet: reads the recorded changes, places them on the
 * grid's cells and turns them into the rows the change list and the cell
 * history draw. Off by default; remembered per device when switched on.
 */
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import type { CanonicalSheetGridMatrix } from '#/lib/canonical-sheet-grid'
import { formatDate, formatTime } from '#/lib/format-date'
import type { ProjectedBoundRow } from '#/lib/sheet-bound-columns'
import {
  cellAddressKey,
  changedToday,
  datasetCellKey,
  fetchSheetCellHistory,
  placeSheetCellChanges,
  valuesBeforeToday,
} from '#/lib/sheet-cell-history'
import type {
  GridCellAddress,
  PlacedSheetCellChange,
} from '#/lib/sheet-cell-history'
import { useUserNames } from '#/lib/user-names'
import type { SheetChangeRow } from './sheet-changes-panel'
import type {
  SheetbaseGridCellValue,
  SheetbaseGridColumn,
} from './sheetbase-grid'

const SHOW_CHANGES_KEY = 'sheetbase.sheet.changes'

function readShowChanges(): boolean {
  try {
    return globalThis.localStorage.getItem(SHOW_CHANGES_KEY) === 'on'
  } catch {
    return false
  }
}

function writeShowChanges(on: boolean): void {
  try {
    if (on) globalThis.localStorage.setItem(SHOW_CHANGES_KEY, 'on')
    else globalThis.localStorage.removeItem(SHOW_CHANGES_KEY)
  } catch {
    // Storage can be off (private windows); the choice then lasts the visit.
  }
}

/** A value as the grid shows it, through the column's own display text. */
export function cellDisplayText(
  value: SheetbaseGridCellValue | undefined,
  column: SheetbaseGridColumn | undefined,
): string {
  if (value === null || value === undefined || value === '') return ''

  const shown = column?.displayText?.(value)

  if (shown !== undefined) return shown

  if (value instanceof Date) return value.toISOString()

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A grid cell value is a closed union; typeof picks its member.
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** Where each dataset cell sits on the grid, from the composition's provenance. */
function datasetCells(
  rows: readonly ProjectedBoundRow[] | undefined,
): Map<string, GridCellAddress> {
  const cells = new Map<string, GridCellAddress>()

  for (const row of rows ?? []) {
    for (const [columnId, state] of Object.entries(row.values)) {
      const source = state.provenance

      if (source.sourceKind !== 'dataset' || !source.sourceRowId) continue
      cells.set(
        datasetCellKey(
          source.sourceDatasetId,
          source.sourceRowId,
          source.sourceFieldId,
        ),
        { rowKey: row.rowKey, columnId },
      )
    }
  }

  return cells
}

function changeWhen(change: PlacedSheetCellChange, now: Date): string {
  return changedToday(change, now)
    ? formatTime(change.at)
    : formatDate(change.at, { year: false })
}

export function useSheetChanges({
  instanceId,
  revision,
  matrix,
  boundRows,
  gridColumns,
  selected,
}: {
  instanceId: string
  revision: number
  matrix: CanonicalSheetGridMatrix
  boundRows: readonly ProjectedBoundRow[] | undefined
  gridColumns: readonly SheetbaseGridColumn[]
  selected: { row: number; col: number } | null
}) {
  const [showChanges, setShowChangesState] = useState(readShowChanges)

  const setShowChanges = useCallback((next: boolean) => {
    setShowChangesState(next)
    writeShowChanges(next)
  }, [])

  // Keyed by revision: every write to the sheet reads the history again.
  const history = useQuery({
    queryKey: ['sheet-cell-history', instanceId, revision],
    queryFn: () => fetchSheetCellHistory(instanceId),
    enabled: showChanges,
    placeholderData: (previous) => previous,
  })

  const placed = useMemo(
    () =>
      placeSheetCellChanges(history.data ?? [], {
        columnIds: new Set(matrix.columns.map((column) => column.id)),
        rowKeys: new Set(matrix.rowKeys),
        datasetCells: datasetCells(boundRows),
      }),
    [history.data, matrix, boundRows],
  )

  const names = useUserNames(
    useMemo(
      () => placed.flatMap((change) => change.actorUserId ?? []),
      [placed],
    ),
  )

  const nameById = names.names

  const position = useMemo(() => {
    const rows = new Map(matrix.rowKeys.map((key, index) => [key, index]))

    const columns = new Map(
      matrix.columns.map((column, index) => [column.id, index]),
    )

    return { rows, columns }
  }, [matrix])

  const rows = useMemo<SheetChangeRow[]>(() => {
    const now = new Date()

    return placed.map((change, index) => {
      const rowIndex = position.rows.get(change.cell.rowKey) ?? 0
      const columnIndex = position.columns.get(change.cell.columnId) ?? 0
      const column = gridColumns[columnIndex]

      return {
        id: `${change.at}-${index}`,
        cellKey: cellAddressKey(change.cell),
        who: change.actorUserId
          ? (nameById[change.actorUserId] ?? t('notebook.sheetChanges.someone'))
          : t('notebook.sheetChanges.someone'),
        when: changeWhen(change, now),
        cell: t('notebook.sheetChanges.cellLabel', {
          row: rowIndex + 1,
          column: matrix.columns[columnIndex]?.label ?? '',
        }),
        before: cellDisplayText(change.before, column),
        after: cellDisplayText(change.after, column),
        beforeKnown: change.beforeKnown,
        reason: change.reason,
      }
    })
  }, [placed, position, gridColumns, matrix, nameById])

  // The board counts both: changes in the header, the cells they touched in
  // the list ("3 changes today", "Today · 3 cells").
  const today = useMemo(() => {
    const now = new Date()
    const changes = placed.filter((change) => changedToday(change, now))

    return {
      changes: changes.length,
      cells: new Set(changes.map((change) => cellAddressKey(change.cell))).size,
    }
  }, [placed])

  const before = useMemo(() => valuesBeforeToday(placed, new Date()), [placed])

  /** The struck-through value for a cell changed today, if it has one. */
  const cellBefore = useCallback(
    (rowIndex: number, columnId: string): string | undefined => {
      const rowKey = matrix.rowKeys[rowIndex]

      if (!rowKey) return undefined
      const key = cellAddressKey({ rowKey, columnId })

      if (!before.has(key)) return undefined
      const columnIndex = position.columns.get(columnId) ?? -1
      const column = gridColumns[columnIndex]
      const was = cellDisplayText(before.get(key), column)

      const now = cellDisplayText(matrix.data[rowIndex]?.[columnIndex], column)

      // A first entry has nothing to strike through: the design marks only
      // values that replaced another one.
      return was === '' || was === now ? undefined : was
    },
    [before, matrix, position, gridColumns],
  )

  const selectedKey = useMemo(() => {
    if (!selected) return null
    const rowKey = matrix.rowKeys[selected.row]
    const columnId = matrix.columns[selected.col]?.id

    return rowKey && columnId ? cellAddressKey({ rowKey, columnId }) : null
  }, [selected, matrix])

  const selectedCell = useMemo(() => {
    if (!selected || !selectedKey) return null
    const column = matrix.columns.at(selected.col)

    if (!column) return null

    return {
      title: t('notebook.sheetChanges.cellLabel', {
        row: selected.row + 1,
        column: column.label,
      }),
      value: cellDisplayText(
        matrix.data[selected.row]?.[selected.col],
        gridColumns[selected.col],
      ),
      rows: rows.filter((row) => row.cellKey === selectedKey),
    }
  }, [selected, selectedKey, matrix, gridColumns, rows])

  /** Grid coordinates of a change, to select its cell from the list. */
  const cellPosition = useCallback(
    (cellKey: string) => {
      const change = placed.find(
        (item) => cellAddressKey(item.cell) === cellKey,
      )

      if (!change) return null
      const row = position.rows.get(change.cell.rowKey)
      const col = position.columns.get(change.cell.columnId)

      return row === undefined || col === undefined ? null : { row, col }
    },
    [placed, position],
  )

  return {
    showChanges,
    setShowChanges,
    changeRows: rows,
    changesToday: today.cells,
    changeCountToday: today.changes,
    cellBefore: showChanges && before.size > 0 ? cellBefore : undefined,
    selectedChangeKey: selectedKey,
    selectedCellHistory: selectedCell,
    changeCellPosition: cellPosition,
  }
}
