import {
  Spreadsheet,
  columnLabel,
  parseAddress,
} from '@sheetbase-labs/sheetbase-table'
import type {
  CellFormat,
  ColumnSource,
  DatasetFieldHeader,
  SpreadsheetHandle,
  SpreadsheetHydrationCell,
  SpreadsheetMenuAction,
  SpreadsheetProps,
} from '@sheetbase-labs/sheetbase-table'
import { memo, useEffect, useMemo, useRef } from 'react'

import type {
  SheetbaseGridCellChange,
  SheetbaseGridColumn,
  SheetbaseGridMenuItem,
  SheetbaseGridProps,
  SheetbaseGridWriteSource,
} from './sheetbase-grid'

/**
 * COMP-06 step 2 — the `sheetbase-table` implementation of the neutral
 * `SheetbaseGridProps`. Callers keep the same contract; this module maps it
 * onto the package's `Spreadsheet` composition.
 *
 * The engine owns interaction (selection, editing, in-cell and formula-bar
 * entry, TSV copy/cut/paste, autofill, undo/redo). This adapter owns the
 * translation in both directions:
 *
 * - neutral columns/rows → the package's dataset fields, per-cell bindings and
 *   A1-addressed data;
 * - package mutations → the caller's `beforeCellsChange` / `onCellsChange`
 *   pipeline, keyed by stable column id and row id.
 *
 * Behaviours the neutral contract asks for that the engine does not expose are
 * not silently faked here; see the COMP-06 step 2 hand-off notes.
 */

type SpreadsheetMutation = Parameters<
  NonNullable<SpreadsheetProps['onMutation']>
>[0]

/** The engine's own light/dark mode; the ELN keeps the mode on `<html>`. */
function resolvedGridTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/** The engine's scalar union; anything else is stringified for display. */
function toScalar(value: unknown): string | number | boolean | Date | null {
  if (value == null) return null
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  )
    return value
  return String(value)
}

function cellAddress(row: number, column: number): string {
  return `${columnLabel(column)}${row + 1}`
}

function displayText(column: SheetbaseGridColumn, value: unknown): string {
  const text = column.displayText?.(value)
  if (text !== undefined) return text
  return value == null ? '' : String(toScalar(value) ?? '')
}

/** Neutral column type → the engine's typed field data type. */
function dataTypeOf(
  column: SheetbaseGridColumn,
): DatasetFieldHeader['dataType'] {
  if (column.type === 'number') return 'number'
  if (column.type === 'checkbox') return 'boolean'
  if (column.type === 'date') return 'date'
  if (column.type === 'datetime') return 'datetime'
  if (column.type === 'record') return 'relationship'
  return 'text'
}

/** Neutral display pattern → the engine's `CellFormat` number format enum. */
function numberFormatOf(
  pattern: string | undefined,
): CellFormat['numberFormat'] | undefined {
  if (!pattern) return undefined
  if (pattern.includes('%')) return 'percent'
  if (/[¤$€£]/.test(pattern)) return 'currency'
  if (/[ymd]/i.test(pattern)) return 'date'
  return 'number'
}

/** Neutral column source + type → the design's Source badge kind. */
function sourceOf(column: SheetbaseGridColumn): ColumnSource {
  if (column.source === 'calculated') return 'calc'
  if (column.type === 'record') return 'record'
  if (column.source === 'local') return 'local'
  return 'dataset'
}

function datasetFields(
  columns: readonly SheetbaseGridColumn[],
  readOnly: boolean,
): DatasetFieldHeader[] {
  return columns.map((column, index) => ({
    id: column.id,
    label: column.label,
    column: index,
    writable: !column.readOnly && !readOnly && column.source !== 'calculated',
    computed: column.source === 'calculated',
    source: sourceOf(column),
    dataType: dataTypeOf(column),
    options: column.options ? [...column.options] : undefined,
    numberFormat: numberFormatOf(column.numberFormat),
  }))
}

/** A1-addressed display values, the engine's mount-time data. */
function buildDisplayMap(props: SheetbaseGridProps): Map<string, string> {
  const map = new Map<string, string>()
  props.rows.forEach((row, rowIndex) => {
    props.columns.forEach((column, columnIndex) => {
      map.set(
        cellAddress(rowIndex, columnIndex),
        displayText(column, row.cells[columnIndex]),
      )
    })
  })
  return map
}

/** A1-addressed hydration cells carrying display text and a literal binding. */
function buildCellMap(
  props: SheetbaseGridProps,
): Map<string, SpreadsheetHydrationCell> {
  const map = new Map<string, SpreadsheetHydrationCell>()
  props.rows.forEach((row, rowIndex) => {
    props.columns.forEach((column, columnIndex) => {
      const display = displayText(column, row.cells[columnIndex])
      map.set(cellAddress(rowIndex, columnIndex), {
        display,
        binding: { kind: 'literal', value: toScalar(display) },
      })
    })
  })
  return map
}

/** The engine's mutation label → the neutral write source. */
function toWriteSource(label: string): SheetbaseGridWriteSource {
  const text = label.toLowerCase()
  if (text.includes('paste')) return 'paste'
  if (text.includes('fill')) return 'fill'
  if (text.includes('clear')) return 'clear'
  return 'edit'
}

function isMenuItem(entry: unknown): entry is SheetbaseGridMenuItem {
  return typeof entry === 'object' && entry !== null
}

function SheetbaseTableGridClientBase(props: SheetbaseGridProps) {
  const {
    columns,
    rows,
    readOnly = false,
    spareRows = 0,
    frozenColumns,
    initialColumnWidths,
    cellState,
    beforeCellsChange,
    onCellsChange,
    onSelectionChange,
    onColumnResize,
    onColumnOrderChange,
    contextMenuItems,
  } = props

  // Volatile props read by engine callbacks; a ref keeps the callbacks stable
  // without re-configuring the engine on every parent render.
  const propsRef = useRef(props)
  propsRef.current = props

  const handleRef = useRef<SpreadsheetHandle | null>(null)
  // The adapter's last accepted display state, used to revert a rejected
  // mutation the engine already committed. Populated by the sync effect below.
  const cellsRef = useRef<Map<string, SpreadsheetHydrationCell>>(new Map())
  // Set while the adapter pushes authoritative data into the engine, so the
  // resulting mutation echo never re-enters the caller's write pipeline.
  const hydratingRef = useRef(false)
  const widthsRef = useRef<readonly number[] | null>(null)

  const initialColumnWidthsResolved = useMemo(() => {
    const widths = columns.map(
      (column, index) =>
        props.columnWidth?.(column.id) ??
        initialColumnWidths?.[index] ??
        column.width,
    )
    return widths.every((width): width is number => width !== undefined)
      ? widths
      : undefined
  }, [columns, initialColumnWidths, props.columnWidth])

  // The engine keeps its own data after mount, so a rebuild of the caller's
  // rows (after a persisted write, a reorder or a hidden-column change) is
  // pushed through the handle rather than only through `initialData`.
  const columnsKey = columns
    .map((column) => column.id)
    .sort()
    .join('|')
  useEffect(() => {
    const next = buildCellMap(propsRef.current)
    cellsRef.current = next
    const handle = handleRef.current
    if (!handle) return
    hydratingRef.current = true
    try {
      handle.replaceData(next)
    } finally {
      hydratingRef.current = false
    }
  }, [rows, columnsKey])

  const mountKey = columnsKey

  const fields = useMemo(
    () => datasetFields(columns, readOnly),
    [columns, readOnly],
  )
  const fieldIds = useMemo(() => columns.map((column) => column.id), [columns])
  const initialData = useMemo(
    () => buildDisplayMap(props),
    // Mount-time snapshot; later data flows through `replaceData`.
    [],
  )

  const contextMenuActions = useMemo<SpreadsheetMenuAction[]>(() => {
    if (!contextMenuItems) return []
    return contextMenuItems.filter(isMenuItem).map((entry) => ({
      label: entry.label,
      onSelect: ({ axis, index, fieldId }) => {
        const current = propsRef.current
        const ranges =
          axis === 'row'
            ? [
                {
                  rowStart: index,
                  rowEnd: index,
                  columnIds: current.columns.map((column) => column.id),
                },
              ]
            : [
                {
                  rowStart: 0,
                  rowEnd: Math.max(0, current.rows.length - 1),
                  columnIds: fieldId
                    ? [fieldId]
                    : current.columns.map((column) => column.id),
                },
              ]
        entry.onSelect?.({ ranges })
      },
    }))
  }, [contextMenuItems])

  return (
    <Spreadsheet
      key={mountKey}
      ref={handleRef}
      initialData={initialData}
      rowCount={rows.length + spareRows}
      columnCount={columns.length}
      fieldIds={fieldIds}
      datasetHeader={{ fields }}
      readOnly={readOnly}
      frozenColumns={frozenColumns}
      initialColumnWidths={initialColumnWidthsResolved}
      theme={resolvedGridTheme()}
      cellState={
        cellState
          ? (row, column) => cellState(row, columns.at(column)?.id ?? '')
          : undefined
      }
      contextMenuActions={contextMenuActions}
      onSelectionChange={(selection) => {
        const { row, column } = parseAddress(selection.address)
        const definition = propsRef.current.columns.at(column)
        if (!definition) return
        onSelectionChange?.({
          rowIndex: row,
          rowId: propsRef.current.rows[row]?.id,
          columnId: definition.id,
        })
      }}
      onColumnWidthsChange={(widths) => {
        const previous = widthsRef.current
        widthsRef.current = [...widths]
        if (!previous) return
        widths.forEach((width, index) => {
          if (previous[index] === width) return
          const definition = propsRef.current.columns.at(index)
          if (definition) onColumnResize?.(definition.id, width)
        })
      }}
      onColumnMove={(from, to) => {
        const order = propsRef.current.columns.map((column) => column.id)
        const moved = order.splice(from, 1).at(0)
        if (moved === undefined) return
        order.splice(to, 0, moved)
        onColumnOrderChange?.(order)
      }}
      onMutation={(mutation: SpreadsheetMutation) => {
        if (hydratingRef.current) return
        const current = propsRef.current
        const source = toWriteSource(mutation.label)
        const changes: SheetbaseGridCellChange[] = []
        for (const cell of mutation.cells) {
          const { row, column } = parseAddress(cell.address)
          const definition = current.columns.at(column)
          if (!definition) continue
          changes.push({
            rowIndex: row,
            rowId: current.rows[row]?.id,
            columnId: definition.id,
            previous: cell.before ?? null,
            next: cell.after ?? null,
          })
        }
        if (changes.length === 0) return
        const result = beforeCellsChange?.(changes, source)
        if (result === false) {
          // The engine commits before the neutral contract can veto, so a
          // rejected change is reverted to the adapter's last accepted state.
          for (const cell of mutation.cells) {
            const previous = cell.before
            if (previous === undefined || previous === '')
              cellsRef.current.delete(cell.address)
            else
              cellsRef.current.set(cell.address, {
                display: previous,
                binding: { kind: 'literal', value: toScalar(previous) },
              })
          }
          const handle = handleRef.current
          if (handle) {
            hydratingRef.current = true
            try {
              handle.replaceData(new Map(cellsRef.current))
            } finally {
              hydratingRef.current = false
            }
          }
          return
        }
        for (const cell of mutation.cells) {
          const after = cell.after
          if (after === undefined || after === '')
            cellsRef.current.delete(cell.address)
          else
            cellsRef.current.set(cell.address, {
              display: after,
              binding: { kind: 'literal', value: toScalar(after) },
            })
        }
        onCellsChange?.(changes, source)
      }}
    />
  )
}

export const SheetbaseTableGridClient = memo(SheetbaseTableGridClientBase)
