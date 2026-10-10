import {
  Spreadsheet,
  buildGridView,
  columnLabel,
  orderColumnsById,
  parseAddress,
  viewSourceRow,
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
import { memo, useEffect, useMemo, useReducer, useRef } from 'react'

import { createFormulaReferenceEditor } from './formula-reference-editor'
import type {
  SheetbaseGridCellChange,
  SheetbaseGridCellValue,
  SheetbaseGridClipboardRange,
  SheetbaseGridColumn,
  SheetbaseGridFilter,
  SheetbaseGridHandle,
  SheetbaseGridMenuItem,
  SheetbaseGridProps,
  SheetbaseGridRecordEditor,
  SheetbaseGridRow,
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
    // EXP-04.2: the header's `Source` badge names the dataset and snapshot.
    // Absent, the engine falls back to its kind-only badge (`ƒx` for `calc`).
    sourceLabel: column.sourceLabel,
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

/**
 * EXP-04.2 — the engine's header-group row: contiguous columns sharing a
 * `group` label span one header naming their source. Rebuilt from the
 * displayed order, so hiding or moving columns keeps each run spanning the
 * columns actually shown.
 */
function columnGroupsOf(
  columns: readonly SheetbaseGridColumn[],
): { label: string; columns: number[] }[] | undefined {
  const groups: { label: string; columns: number[] }[] = []
  columns.forEach((column, index) => {
    const label = column.group
    if (!label) return
    const current = groups.at(-1)
    if (current && current.label === label) current.columns.push(index)
    else groups.push({ label, columns: [index] })
  })
  return groups.length > 0 ? groups : undefined
}

/** A1-addressed stored values, the engine's mount-time data. */
function buildDisplayMap(
  rows: readonly SheetbaseGridRow[],
  columns: readonly SheetbaseGridColumn[],
): Map<string, string> {
  const map = new Map<string, string>()
  rows.forEach((row, rowIndex) => {
    columns.forEach((_column, columnIndex) => {
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
  rows: readonly SheetbaseGridRow[],
  columns: readonly SheetbaseGridColumn[],
): Map<string, SpreadsheetHydrationCell> {
  const map = new Map<string, SpreadsheetHydrationCell>()
  rows.forEach((row, rowIndex) => {
    columns.forEach((_column, columnIndex) => {
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

/** The neutral clipboard range for the engine's payload range. */
function toNeutralRange(
  range: SpreadsheetClipboardRange,
): SheetbaseGridClipboardRange {
  return {
    startRow: range.top,
    startColumn: range.left,
    endRow: range.bottom,
    endColumn: range.right,
    // Preserve positions so a display offset still indexes its own column.
    columnIds: [...range.columnIds],
  }
}

/** Whether a hook left the (possibly in-place mutated) matrix unchanged. */
function matrixEqual(
  values: readonly (readonly unknown[])[],
  original: readonly (readonly string[])[],
): boolean {
  if (values.length !== original.length) return false
  for (let row = 0; row < values.length; row += 1) {
    if (values[row].length !== original[row].length) return false
    for (let column = 0; column < values[row].length; column += 1) {
      const value = values[row][column]
      if ((value == null ? '' : String(value)) !== original[row][column])
        return false
    }
  }
  return true
}

/** Rebuild the engine payload from a transformed matrix (TSV re-serialised). */
function toClipboardPayload(
  payload: SpreadsheetClipboardPayload,
  values: readonly (readonly unknown[])[],
): SpreadsheetClipboardPayload {
  const rows = values.map((row) =>
    row.map((cell) => (cell == null ? '' : String(cell))),
  )
  return {
    text: rows.map((row) => row.join('\t')).join('\n'),
    values: rows,
    range: payload.range,
  }
}

/**
 * A clipboard hook may mutate the neutral matrix in place and/or return a
 * replacement. Unchanged payloads are left to the engine (its original TSV is
 * preserved); a transformed one is re-serialised so the rewrite reaches both
 * the clipboard and the applied change.
 */
function clipboardOverride(
  payload: SpreadsheetClipboardPayload,
  values: readonly (readonly unknown[])[],
  transformed: SheetbaseGridCellValue[][] | void,
): SpreadsheetClipboardPayload | undefined {
  const next = transformed ?? values
  if (!transformed && matrixEqual(next, payload.values)) return undefined
  return toClipboardPayload(payload, next)
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
    rowHeaders,
    height,
    stretch,
    spareRows = 0,
    appendRow,
    frozenColumns,
    initialColumnWidths,
    columnOrder,
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

  // The engine is positional: display order is expressed by the arrays the host
  // builds. A caller's persisted `columnOrder` reorders the columns (and each
  // row's cells, widths and A1 addresses) without touching column identity.
  const orderedColumns = useMemo(
    () => orderColumnsById(columns, columnOrder),
    [columns, columnOrder],
  )
  const orderedRows = useMemo(() => {
    if (!columnOrder?.length) return rows
    const indexById = new Map(
      columns.map((column, index) => [column.id, index]),
    )
    return rows.map((row) => ({
      id: row.id,
      cells: orderedColumns.map(
        (column) => row.cells[indexById.get(column.id) ?? -1] ?? null,
      ),
    }))
  }, [rows, columns, orderedColumns, columnOrder])

  // Callbacks resolve display indices through the ordered layout, so a moved
  // column still maps to the right stable id.
  const layoutRef = useRef({ columns: orderedColumns, rows: orderedRows })
  layoutRef.current = { columns: orderedColumns, rows: orderedRows }

  const annotations = useMemo(
    () =>
      (props.annotations ?? []).flatMap((note) => {
        const row = orderedRows.findIndex(
          (candidate) => candidate.id === note.rowId,
        )
        const column = orderedColumns.findIndex(
          (candidate) => candidate.id === note.columnId,
        )
        return row < 0 || column < 0
          ? []
          : [
              {
                address: cellAddress(row, column),
                recordId: note.rowId,
                fieldId: note.columnId,
                text: note.text,
              },
            ]
      }),
    [props.annotations, orderedRows, orderedColumns],
  )
  const [annotationVersion, annotationsChanged] = useReducer(
    (version: number) => version + 1,
    0,
  )
  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return
    const current = handle.snapshot().annotations ?? []
    // 0.6.0 annotation methods capture their render's array. Apply only one
    // change, then let onAnnotationsChange advance to a fresh handle; batching
    // several calls on the same handle silently keeps only the final change.
    // The acknowledgment yields between renders to avoid nested effect loops
    // when a late range spans many cells.
    for (const previous of current) {
      if (
        annotations.some(
          (note) =>
            note.recordId === previous.recordId &&
            note.fieldId === previous.fieldId,
        )
      )
        continue
      // Resolve the old identity afresh. Its former address may now belong to
      // another row; a deleted identity's historical note must never move.
      const row = orderedRows.findIndex(
        (candidate) => candidate.id === previous.recordId,
      )
      const column = orderedColumns.findIndex(
        (candidate) => candidate.id === previous.fieldId,
      )
      if (row >= 0 && column >= 0) {
        handle.removeAnnotation(cellAddress(row, column))
        return
      }
    }
    for (const note of annotations) {
      if (
        current.some(
          (previous) =>
            previous.recordId === note.recordId &&
            previous.fieldId === note.fieldId &&
            previous.text === note.text,
        )
      )
        continue
      handle.setAnnotation(note.address, note.text)
      return
    }
  }, [annotationVersion, annotations, orderedRows, orderedColumns])

  const initialColumnWidthsResolved = useMemo(() => {
    const widthById = new Map<string, number>()
    columns.forEach((column, index) => {
      const width =
        props.columnWidth?.(column.id) ??
        initialColumnWidths?.[index] ??
        column.width
      if (width !== undefined) widthById.set(column.id, width)
    })
    const widths = orderedColumns.map((column) => widthById.get(column.id))
    return widths.every((width): width is number => width !== undefined)
      ? widths
      : undefined
  }, [columns, orderedColumns, initialColumnWidths, props.columnWidth])

  // The engine keeps its own data after mount, so a rebuild of the caller's
  // rows (after a persisted write, a reorder or a hidden-column change) is
  // pushed through the handle rather than only through `initialData`.
  const columnsKey = columns
    .map((column) => column.id)
    .sort()
    .join('|')
  const orderKey = columnOrder?.join('|') ?? ''
  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return
    const { rows: currentRows, columns: currentColumns } = layoutRef.current
    handle.replaceData(buildCellMap(currentRows, currentColumns))
  }, [rows, columnsKey, orderKey])

  const mountKey = `${columnsKey}::${orderKey}`

  const fields = useMemo(
    () => datasetFields(orderedColumns, readOnly),
    [orderedColumns, readOnly],
  )
  // EXP-04.2: contiguous same-source runs become the engine's header groups.
  const columnGroups = useMemo(
    () => columnGroupsOf(orderedColumns),
    [orderedColumns],
  )
  const fieldIds = useMemo(
    () => orderedColumns.map((column) => column.id),
    [orderedColumns],
  )
  const initialData = useMemo(
    () => buildDisplayMap(layoutRef.current.rows, layoutRef.current.columns),
    // Mount-time snapshot; later data flows through `replaceData`.
    [],
  )
  const datasetHeader = useMemo(
    () => ({
      fields,
      // Bound signal: bound grids key every write by record identity and defer
      // ordering/filtering to the host instead of moving values between rows.
      recordIdForRow: (row: number) => layoutRef.current.rows[row]?.id,
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
        const values = toNeutralValues(payload.values)
        const transformed = propsRef.current.clipboard?.onCopy?.(
          values,
          toNeutralRange(payload.range),
        )
        return clipboardOverride(payload, values, transformed)
      },
      onCut: (payload: SpreadsheetClipboardPayload) => {
        if (rangeHasGuardedColumn(payload.range)) {
          announceCut(
            'Cut is unavailable because the active range contains read-only or derived cells.',
          )
          return false
        }
        announceCut('')
        const values = toNeutralValues(payload.values)
        const transformed = propsRef.current.clipboard?.onCut?.(
          values,
          toNeutralRange(payload.range),
        )
        return clipboardOverride(payload, values, transformed)
      },
      onPaste: (
        payload: SpreadsheetClipboardPayload,
        target: { row: number; column: number },
      ) => {
        const values = toNeutralValues(payload.values)
        const transformed = propsRef.current.clipboard?.onPaste?.(values, {
          row: target.row,
          column: target.column,
        })
        return clipboardOverride(payload, values, transformed)
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
      const layout = layoutRef.current
      const neutral: SheetbaseGridCellChange[] = changes.map(
        (change: SpreadsheetCellChange) => ({
          rowIndex: change.row,
          rowId: change.recordId ?? layout.rows[change.row]?.id,
          columnId:
            change.fieldId ?? layout.columns.at(change.column)?.id ?? '',
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
        const layout = layoutRef.current
        const ranges =
          axis === 'row'
            ? [
                {
                  rowStart: index,
                  rowEnd: index,
                  columnIds: layout.columns.map((column) => column.id),
                },
              ]
            : [
                {
                  rowStart: 0,
                  rowEnd: Math.max(0, layout.rows.length - 1),
                  columnIds: fieldId
                    ? [fieldId]
                    : layout.columns.map((column) => column.id),
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
        const layout = layoutRef.current
        entry.onSelect?.({
          ranges: [
            {
              rowStart: 0,
              rowEnd: Math.max(0, layout.rows.length - 1),
              columnIds: fieldId
                ? [fieldId]
                : layout.columns.map((column) => column.id),
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
    const editors: SpreadsheetCustomEditor[] = []
    // The Record picker is the more specific match (relationship fields), so
    // it is checked before the formula editor.
    if (onOpenRecordPicker) {
      editors.push({
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
      })
    }
    // COMP-06 step 3: formula-enabled columns edit through the ELN
    // formula-reference editor (in-cell `=…` entry, arrow/click reference
    // picking, and function autocomplete from the shared function list).
    if (
      orderedColumns.some(
        (column) => column.formula === true && column.readOnly !== true,
      )
    ) {
      editors.push(
        createFormulaReferenceEditor(({ point }) => {
          const column = orderedColumns.at(point.column)
          return column?.formula === true && column.readOnly !== true
        }),
      )
    }
    return editors.length > 0 ? editors : undefined
  }, [onOpenRecordPicker, openRecordPicker, orderedColumns])

  // The package calls onReady once but replaces its imperative handle after
  // edits/selections. Always dereference the current handle, not that snapshot.
  const neutralHandle = useMemo<SheetbaseGridHandle>(
    () => ({
      editActiveInput: (value) => handleRef.current?.editActiveInput(value),
      commitEdit: () => handleRef.current?.commitEdit(),
      cancelEdit: () => handleRef.current?.cancelEdit(),
      focus: () => handleRef.current?.focus(),
      selectCell: (row, column, options) =>
        handleRef.current?.selectCell(row, column, options),
      selectCellAddress: (address, options) =>
        handleRef.current?.selectCellAddress(address, options) ?? false,
      scrollCellIntoView: (row, column) =>
        handleRef.current?.scrollCellIntoView(row, column),
      snapshot: () => {
        const handle = handleRef.current
        if (!handle) throw new Error('The Sheet grid is unavailable.')
        const { data, selection } = handle.snapshot()
        return {
          data,
          selection: {
            anchor: {
              row: selection.anchor.row,
              column: selection.anchor.column,
            },
            focus: { row: selection.focus.row, column: selection.focus.column },
          },
        }
      },
    }),
    [],
  )
  const handleReady = useMemo(
    () => (handle: SpreadsheetHandle | null) => {
      propsRef.current.onReady?.(handle ? neutralHandle : null)
    },
    [neutralHandle],
  )
  useEffect(() => () => propsRef.current.onReady?.(null), [])

  // Bound grids route row structure to the host's persistence seams.
  const handleBeforeRowsInsert = useMemo(
    () => (rowIndex: number, count: number) =>
      propsRef.current.onBeforeRowsInsert?.(rowIndex, count) === false
        ? false
        : undefined,
    [],
  )
  const handleRowsInserted = useMemo(
    () => (rowIndex: number, count: number) => {
      propsRef.current.onRowsInserted?.(rowIndex, count, 'edit')
    },
    [],
  )
  const handleBeforeRowsRemove = useMemo(
    () => (rowIndex: number, count: number) =>
      propsRef.current.onBeforeRowsRemove?.(rowIndex, count) === false
        ? false
        : undefined,
    [],
  )
  const handleRowsRemoved = useMemo(
    () => (rowIndex: number, count: number) => {
      propsRef.current.onRowsRemoved?.(rowIndex, count, 'edit')
    },
    [],
  )

  return (
    <Spreadsheet
      key={mountKey}
      ref={handleRef}
      initialData={initialData}
      initialAnnotations={annotations}
      onAnnotationsChange={() => setTimeout(annotationsChanged, 0)}
      rowCount={rows.length + spareRows}
      columnCount={columns.length}
      columnGroups={columnGroups}
      appendRow={appendRow}
      fieldIds={fieldIds}
      datasetHeader={datasetHeader}
      readOnly={readOnly}
      rowHeaders={rowHeaders}
      height={height}
      stretch={stretch}
      frozenColumns={frozenColumns}
      initialColumnWidths={initialColumnWidthsResolved}
      theme={resolvedGridTheme()}
      cellState={
        cellState
          ? (row, column) => cellState(row, orderedColumns.at(column)?.id ?? '')
          : undefined
      }
      contextMenuActions={contextMenuActions}
      columnMenuItems={columnMenuActions}
      customEditors={customEditors}
      clipboard={clipboardConfig}
      query={query}
      onReady={handleReady}
      onBeforeRowsInsert={handleBeforeRowsInsert}
      onRowsInserted={handleRowsInserted}
      onBeforeRowsRemove={handleBeforeRowsRemove}
      onRowsRemoved={handleRowsRemoved}
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
        // The engine clears selection while restoring a sorted/filtered view.
        // An empty address is not A1 and must not retain the previous anchor.
        if (!selection.address || !selection.range) {
          onSelectionChange?.(null)
          return
        }
        const { row, column } = parseAddress(selection.address)
        const layout = layoutRef.current
        const definition = layout.columns.at(column)
        if (!definition) return
        const values =
          handleRef.current?.snapshot().data ??
          buildDisplayMap(layout.rows, layout.columns)
        const view = buildGridView({
          rowCount: layout.rows.length,
          query: handleRef.current?.getQuery() ?? query,
          columnFor: (fieldId) => {
            const index = layout.columns.findIndex(
              (field) => field.id === fieldId,
            )
            return index < 0 ? undefined : index
          },
          valueAt: (sourceRow, sourceColumn) =>
            values.get(cellAddress(sourceRow, sourceColumn)) ?? '',
          hasRow: (sourceRow) => Boolean(layout.rows[sourceRow]?.id),
        })
        const [start, end = start] = selection.range
          .split(':')
          .map(parseAddress)
        const rowIds: string[] = []
        for (
          let displayRow = Math.min(start.row, end.row);
          displayRow <= Math.max(start.row, end.row);
          displayRow++
        ) {
          const id = layout.rows[viewSourceRow(view, displayRow)]?.id
          if (id) rowIds.push(id)
        }
        const columnIds = layout.columns
          .slice(
            Math.min(start.column, end.column),
            Math.max(start.column, end.column) + 1,
          )
          .map((field) => field.id)
        onSelectionChange?.({
          rowIndex: row,
          rowId: layout.rows[row]?.id,
          columnId: definition.id,
          input: selection.input,
          rowIds,
          columnIds,
        })
      }}
      onColumnWidthsChange={(widths) => {
        const previous = widthsRef.current
        widthsRef.current = [...widths]
        if (!previous) return
        const layout = layoutRef.current
        widths.forEach((width, index) => {
          if (previous[index] === width) return
          const definition = layout.columns.at(index)
          if (definition) onColumnResize?.(definition.id, width)
        })
      }}
      onColumnMove={(from, to) => {
        const order = layoutRef.current.columns.map((column) => column.id)
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
        const layout = layoutRef.current
        const changes: SheetbaseGridCellChange[] = []
        for (const cell of mutation.cells) {
          const { row, column } = parseAddress(cell.address)
          const definition = layout.columns.at(column)
          if (!definition) continue
          changes.push({
            rowIndex: row,
            rowId: layout.rows[row]?.id,
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
