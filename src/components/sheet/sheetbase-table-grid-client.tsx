import {
  Spreadsheet,
  columnLabel,
  parseAddress,
} from '@sheetbase-labs/sheetbase-table'
import type {
  CellFormat,
  ColumnSource,
  DatasetFieldHeader,
  DatasetQuery,
  FilterClause,
  FilterOperator,
  SortClause,
  SpreadsheetBeforeCellsChange,
  SpreadsheetCellChange,
  SpreadsheetClipboard,
  SpreadsheetClipboardPayload,
  SpreadsheetClipboardRange,
  SpreadsheetCustomEditor,
  SpreadsheetHandle,
  SpreadsheetHydrationCell,
  SpreadsheetMenuAction,
  SpreadsheetMutationSource,
  SpreadsheetProps,
} from '@sheetbase-labs/sheetbase-table'
import { memo, useEffect, useMemo, useRef } from 'react'

import type {
  SheetbaseGridCellChange,
  SheetbaseGridColumn,
  SheetbaseGridFilter,
  SheetbaseGridMenuItem,
  SheetbaseGridProps,
  SheetbaseGridRecordEditor,
  SheetbaseGridWriteSource,
} from './sheetbase-grid'

/**
 * COMP-06 steps 2-3 — the `sheetbase-table` implementation of the neutral
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
 *   pipeline, keyed by stable column id and row id;
 * - package host hooks → the caller's fail-closed validation, clipboard and
 *   presentation-persistence seams.
 *
 * The grid is configured as a *bound* dataset (`recordIdForRow` present) so
 * every write keeps its record identity. Under `sortMode="local"` the package
 * derives a view→source row mapping, so ordering and filtering change only the
 * displayed rows and never move values between records.
 */

/** Readonly TSV values as the neutral contract's mutable cell-value matrix. */
function toNeutralValues(values: readonly (readonly string[])[]) {
  return values.map((row) => [...row])
}

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
    // Stored value → label. Bound writes keep the real id; the grid shows the
    // human label (Record reference, category vocabulary label).
    displayText: column.displayText
      ? (storedValue: string) => column.displayText?.(storedValue)
      : undefined,
  }))
}

/** A1-addressed stored values, the engine's mount-time data. */
function buildDisplayMap(props: SheetbaseGridProps): Map<string, string> {
  const map = new Map<string, string>()
  props.rows.forEach((row, rowIndex) => {
    props.columns.forEach((_column, columnIndex) => {
      map.set(
        cellAddress(rowIndex, columnIndex),
        String(toScalar(row.cells[columnIndex]) ?? ''),
      )
    })
  })
  return map
}

/** A1-addressed hydration cells carrying the stored value and a literal binding. */
function buildCellMap(
  props: SheetbaseGridProps,
): Map<string, SpreadsheetHydrationCell> {
  const map = new Map<string, SpreadsheetHydrationCell>()
  props.rows.forEach((row, rowIndex) => {
    props.columns.forEach((_column, columnIndex) => {
      const value = String(toScalar(row.cells[columnIndex]) ?? '')
      map.set(cellAddress(rowIndex, columnIndex), {
        display: value,
        binding: { kind: 'literal', value: toScalar(value) },
      })
    })
  })
  return map
}

/** The engine's real mutation source → the neutral write source. */
function toWriteSource(
  source: SpreadsheetMutationSource,
): SheetbaseGridWriteSource {
  if (source === 'paste') return 'paste'
  if (source === 'fill') return 'fill'
  if (source === 'clear') return 'clear'
  return 'edit'
}

/**
 * The engine's audit label → its mutation source. `onMutation` (the after-hook)
 * carries no source, so undo/redo replays are classified by their label.
 */
function sourceForLabel(label: string): SpreadsheetMutationSource {
  const text = label.toLowerCase()
  if (
    text.startsWith('sort ') ||
    (text.startsWith('clear ') && text.endsWith(' sort'))
  )
    return 'sort'
  if (text.startsWith('insert ') || text.startsWith('delete '))
    return 'structure'
  if (text.startsWith('revert ')) return 'revert'
  if (text.startsWith('move ')) return 'move'
  if (text.startsWith('paste')) return 'paste'
  if (text.startsWith('autofill') || text.startsWith('fill')) return 'fill'
  if (text.startsWith('clear ') || text.startsWith('cut ')) return 'clear'
  if (text.startsWith('replace')) return 'replace'
  return 'edit'
}

const PACKAGE_OPERATOR: Record<
  SheetbaseGridFilter['operator'],
  FilterOperator
> = {
  equals: 'eq',
  'not-equals': 'neq',
  'is-empty': 'isNull',
  'is-not-empty': 'notNull',
}

/** The package's filter operator → the neutral contract, when representable. */
function neutralOperator(
  operator: FilterOperator,
): SheetbaseGridFilter['operator'] | undefined {
  const entry = (
    Object.entries(PACKAGE_OPERATOR) as Array<
      [SheetbaseGridFilter['operator'], FilterOperator]
    >
  ).find(([, value]) => value === operator)
  return entry?.[0]
}

function isMenuItem(entry: unknown): entry is SheetbaseGridMenuItem {
  return typeof entry === 'object' && entry !== null
}

/**
 * Mounts inside the grid's cell editor for a Record column: requests the shared
 * picker once and hands it the editor's own commit/cancel, so the picked Record
 * id passes through the grid's pre-commit gate.
 */
function RecordPickerOpener({
  row,
  column,
  columnId,
  commit,
  cancel,
  onOpen,
}: {
  row: number
  column: number
  columnId?: string
  commit: (value: string) => void
  cancel: () => void
  onOpen: (
    cell: { rowIndex: number; columnIndex: number; columnId: string },
    editor: SheetbaseGridRecordEditor,
  ) => void
}) {
  const lastOpened = useRef<string | null>(null)
  useEffect(() => {
    const key = `${row}:${column}`
    if (lastOpened.current === key) return
    lastOpened.current = key
    onOpen(
      { rowIndex: row, columnIndex: column, columnId: columnId ?? '' },
      {
        commit: (value) => commit(value == null ? '' : String(value)),
        cancel,
      },
    )
  }, [row, column, columnId, commit, cancel, onOpen])
  return null
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
    onSelectionChange,
    onColumnResize,
    onColumnOrderChange,
    contextMenuItems,
    columnMenuItems,
    sorts,
    filters,
    onOpenRecordPicker,
  } = props

  // Volatile props read by engine callbacks; a ref keeps the callbacks stable
  // without re-configuring the engine on every parent render.
  const propsRef = useRef(props)
  propsRef.current = props

  const handleRef = useRef<SpreadsheetHandle | null>(null)
  const widthsRef = useRef<readonly number[] | null>(null)

  const displayIds = useMemo(
    () => new Set(columns.map((column) => column.id)),
    [columns],
  )

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
    const handle = handleRef.current
    if (!handle) return
    handle.replaceData(buildCellMap(propsRef.current))
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
  const datasetHeader = useMemo(
    () => ({
      fields,
      // Bound signal: bound grids key every write by record identity and defer
      // ordering/filtering to the host instead of moving values between rows.
      recordIdForRow: (row: number) => propsRef.current.rows[row]?.id,
    }),
    [fields],
  )

  // Presentation state: the package notifies through `onSortChange` /
  // `onFiltersChange`; the adapter carries the caller's persisted clauses in
  // and back out. Under `sortMode="local"` (below) the package derives a
  // view→source row mapping for the identity-keyed bound grid, so sorting and
  // filtering reorder/hide displayed rows without moving values between
  // records — every bound write keeps its record identity.
  // Non-neutral operators (contains, between, …) are not representable in
  // `SheetbaseGridFilter` and are dropped.
  const query = useMemo<DatasetQuery>(() => {
    const sort: SortClause[] = (sorts ?? [])
      .filter((entry) => displayIds.has(entry.columnId))
      .map((entry) => ({ fieldId: entry.columnId, direction: entry.direction }))
    const filter: FilterClause[] = (filters ?? [])
      .filter((entry) => displayIds.has(entry.columnId))
      .map((entry) => ({
        fieldId: entry.columnId,
        operator: PACKAGE_OPERATOR[entry.operator],
        value: entry.value ?? undefined,
      }))
    return { sort, filters: filter }
  }, [sorts, filters, displayIds])

  const announceCut = useMemo(
    () => (message: string) => {
      const cutStatusId = propsRef.current.cutStatusId
      if (!cutStatusId || typeof document === 'undefined') return
      const node = document.getElementById(cutStatusId)
      if (node) node.textContent = message
    },
    [],
  )

  // GRID-02: cut fails closed when the range covers read-only or derived
  // columns; paste/fill read-only targets are already skipped by the engine's
  // per-cell `canEdit`.
  const rangeHasGuardedColumn = useMemo(
    () => (range: SpreadsheetClipboardRange) => {
      const current = propsRef.current
      if (current.readOnly) return true
      return range.columnIds.some((columnId) => {
        const column = columnId
          ? current.columns.find((candidate) => candidate.id === columnId)
          : undefined
        return column
          ? column.readOnly === true || column.source === 'calculated'
          : false
      })
    },
    [],
  )

  const clipboardConfig = useMemo<SpreadsheetClipboard>(
    () => ({
      onCopy: (payload: SpreadsheetClipboardPayload) => {
        propsRef.current.clipboard?.onCopy?.(toNeutralValues(payload.values), {
          startRow: payload.range.top,
          startColumn: payload.range.left,
          endRow: payload.range.bottom,
          endColumn: payload.range.right,
        })
        return undefined
      },
      onCut: (payload: SpreadsheetClipboardPayload) => {
        if (rangeHasGuardedColumn(payload.range)) {
          announceCut(
            'Cut is unavailable because the active range contains read-only or derived cells.',
          )
          return false
        }
        announceCut('')
        propsRef.current.clipboard?.onCut?.(toNeutralValues(payload.values), {
          startRow: payload.range.top,
          startColumn: payload.range.left,
          endRow: payload.range.bottom,
          endColumn: payload.range.right,
        })
        return undefined
      },
      onPaste: (
        payload: SpreadsheetClipboardPayload,
        target: { row: number; column: number },
      ) => {
        propsRef.current.clipboard?.onPaste?.(toNeutralValues(payload.values), {
          row: target.row,
          column: target.column,
        })
        return undefined
      },
      onCutStatusChange: (status) => {
        announceCut(status ? status.label : '')
      },
    }),
    [announceCut, rangeHasGuardedColumn],
  )

  // GRID-02/GRID-03: every write source is validated against the typed column
  // contract before the grid applies anything. The package's gate runs before
  // history, field writes and `onMutation`; a rejected change leaves an inline
  // edit open. Presentation-only and engine-internal mutations bypass the host.
  const handleBeforeCellsChange = useMemo<SpreadsheetBeforeCellsChange>(
    () => (changes, source) => {
      if (source === 'sort' || source === 'structure' || source === 'revert')
        return undefined
      // A bound grid must never move values between record addresses.
      if (source === 'move') return false
      const current = propsRef.current
      const neutral: SheetbaseGridCellChange[] = changes.map(
        (change: SpreadsheetCellChange) => ({
          rowIndex: change.row,
          rowId: change.recordId ?? current.rows[change.row]?.id,
          columnId:
            change.fieldId ?? current.columns.at(change.column)?.id ?? '',
          previous: change.before ?? null,
          next: change.next ?? null,
          // 0.4.0 whole-operation veto: the bulk intended target set marks
          // cells the grid will not write so the host can refuse the whole
          // operation rather than let the editable subset land.
          editable: change.editable === false ? false : undefined,
        }),
      )
      const result = current.beforeCellsChange?.(neutral, toWriteSource(source))
      if (result === false) return false
      // Carry host-coerced canonical values back into the applied mutation.
      neutral.forEach((change, index) => {
        changes[index].next =
          change.next == null ? undefined : String(change.next)
      })
      return undefined
    },
    [],
  )

  const contextMenuActions = useMemo<SpreadsheetMenuAction[]>(() => {
    if (!contextMenuItems) return []
    return contextMenuItems.filter(isMenuItem).map((entry) => ({
      id: entry.id,
      label: entry.label,
      disabled: entry.disabled,
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

  // The workspace's header-menu actions (freeze/hide) render in the column
  // menu; separators have no package equivalent and are dropped.
  const columnMenuActions = useMemo<SpreadsheetMenuAction[]>(() => {
    if (!columnMenuItems) return []
    return columnMenuItems.filter(isMenuItem).map((entry) => ({
      id: entry.id,
      label: entry.label,
      disabled: entry.disabled,
      onSelect: ({ fieldId }) => {
        const current = propsRef.current
        entry.onSelect?.({
          ranges: [
            {
              rowStart: 0,
              rowEnd: Math.max(0, current.rows.length - 1),
              columnIds: fieldId
                ? [fieldId]
                : current.columns.map((column) => column.id),
            },
          ],
        })
      },
    }))
  }, [columnMenuItems])

  const openRecordPicker = useMemo(
    () =>
      (
        cell: { rowIndex: number; columnIndex: number; columnId: string },
        editor: SheetbaseGridRecordEditor,
      ) => {
        propsRef.current.onOpenRecordPicker?.(cell, editor)
      },
    [],
  )

  const customEditors = useMemo<SpreadsheetCustomEditor[] | undefined>(() => {
    if (!onOpenRecordPicker) return undefined
    return [
      {
        matches: ({ field }) => field?.dataType === 'relationship',
        render: (context) => (
          <RecordPickerOpener
            row={context.point.row}
            column={context.point.column}
            columnId={context.columnId}
            commit={context.commit}
            cancel={context.cancel}
            onOpen={openRecordPicker}
          />
        ),
      },
    ]
  }, [onOpenRecordPicker, openRecordPicker])

  return (
    <Spreadsheet
      key={mountKey}
      ref={handleRef}
      initialData={initialData}
      rowCount={rows.length + spareRows}
      columnCount={columns.length}
      fieldIds={fieldIds}
      datasetHeader={datasetHeader}
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
      columnMenuItems={columnMenuActions}
      customEditors={customEditors}
      clipboard={clipboardConfig}
      query={query}
      // 0.4.0: view-level local ordering/filtering for the identity-keyed
      // bound grid, so persisted sorts/filters change the visible row order
      // and membership while record identity (and every bound write) stays
      // intact.
      sortMode="local"
      beforeCellsChange={handleBeforeCellsChange}
      onSortChange={(next: readonly SortClause[]) => {
        propsRef.current.onSortsChange?.(
          next.map((sort) => ({
            columnId: sort.fieldId,
            direction: sort.direction,
          })),
        )
      }}
      onFiltersChange={(next: readonly FilterClause[]) => {
        const current = propsRef.current
        const captured: SheetbaseGridFilter[] = []
        const capturedIds = new Set<string>()
        for (const clause of next) {
          const operator = neutralOperator(clause.operator)
          if (!operator) continue
          captured.push({
            columnId: clause.fieldId,
            operator,
            value:
              typeof clause.value === 'string' ||
              typeof clause.value === 'number' ||
              typeof clause.value === 'boolean'
                ? clause.value
                : undefined,
          })
          capturedIds.add(clause.fieldId)
        }
        // A hidden column has no grid column, so its persisted filter cannot be
        // captured — carry it across so a later capture does not drop it.
        const preserved = (current.filters ?? []).filter(
          (filter) =>
            !displayIds.has(filter.columnId) &&
            !capturedIds.has(filter.columnId),
        )
        current.onFiltersChange?.([...preserved, ...captured])
      }}
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
      onMutation={(
        mutation: Parameters<NonNullable<SpreadsheetProps['onMutation']>>[0],
      ) => {
        const source = sourceForLabel(mutation.label)
        if (
          source === 'sort' ||
          source === 'structure' ||
          source === 'revert' ||
          source === 'move'
        )
          return
        if (mutation.cells.length === 0) return
        const current = propsRef.current
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
        current.onCellsChange?.(changes, toWriteSource(source))
      }}
    />
  )
}

export const SheetbaseTableGridClient = memo(SheetbaseTableGridClientBase)
