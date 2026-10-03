import { HotTable } from '@handsontable/react-wrapper'
import type { HotTableRef } from '@handsontable/react-wrapper'
import { memo, useEffect, useMemo, useRef } from 'react'
import type {
  CellChange,
  CellValue,
  ColumnSettings,
  RangeType,
} from 'handsontable'
import type { BaseEditor } from 'handsontable/editors/baseEditor'
import type Handsontable from 'handsontable/base'
import type { GridSettings } from 'handsontable/settings'
import type { MenuItemConfig } from 'handsontable/plugins/contextMenu'
import { registerAllModules } from 'handsontable/registry'

import type {
  SheetbaseGridCellChange,
  SheetbaseGridClientProps,
  SheetbaseGridColumn,
  SheetbaseGridFilter,
  SheetbaseGridMenuContext,
  SheetbaseGridMenuEntry,
  SheetbaseGridMenuItem,
  SheetbaseGridRange,
  SheetbaseGridSort,
  SheetbaseGridWriteSource,
} from './sheetbase-grid'
import { createRecordPickerEditor } from './record-picker-editor'
import { FormulaReferenceEditor } from './formula-reference-editor'

registerAllModules()

/**
 * The Handsontable settings surface stays internal to this module: callers
 * pass the neutral `SheetbaseGridProps` and this adapter translates them.
 */
type HandsontableGridSettings = Omit<
  GridSettings,
  'className' | 'licenseKey' | 'themeName'
>

function includesReadOnlyCell(hot: Handsontable, ranges: RangeType[]) {
  return ranges.some((range) => {
    const startRow = Math.max(0, Math.min(range.startRow, range.endRow))
    const endRow = Math.max(range.startRow, range.endRow)
    const startCol = Math.max(0, Math.min(range.startCol, range.endCol))
    const endCol = Math.max(range.startCol, range.endCol)

    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        if (hot.getCellMeta(row, col).readOnly) return true
      }
    }
    return false
  })
}

function changesIncludeReadOnlyCell(hot: Handsontable, changes: CellChange[]) {
  return changes.some((change) => {
    const col = hot.propToCol(change[1] as string | number)
    if (col < 0) return false
    return hot.getCellMeta(change[0], col).readOnly
  })
}

function announceStatus(statusId: string, message: string) {
  const status = document.getElementById(statusId)
  if (status) status.textContent = message
}

/** Map a Handsontable change source onto the neutral write source. */
function toWriteSource(source: string): SheetbaseGridWriteSource {
  if (source === 'loadData') return 'load'
  if (source === 'auto') return 'formula'
  if (source.startsWith('CopyPaste')) return 'paste'
  if (source.startsWith('Autofill')) return 'fill'
  if (source === 'sheetbase.clear-contents') return 'clear'
  return 'edit'
}

const BUILTIN_MENU_KEYS: Record<string, string> = {
  copy: 'copy',
  cut: 'cut',
  paste: 'paste',
  undo: 'undo',
  redo: 'redo',
  'insert-row-above': 'row_above',
  'insert-row-below': 'row_below',
  'remove-row': 'remove_row',
}

interface FilterConditionStack {
  column: number
  conditions: Array<{ name: string; args?: unknown[] }>
  operation?: string
}

type MenuSelection = Array<{
  start: { row: number | null; col: number | null }
  end: { row: number | null; col: number | null }
}>

function menuRanges(
  selection: MenuSelection | null,
  columns: readonly SheetbaseGridColumn[],
  hot: Handsontable,
): SheetbaseGridRange[] {
  if (!selection) return []
  return selection.map((entry) => {
    const startRow = entry.start.row ?? 0
    const endRow = entry.end.row ?? startRow
    const startCol = entry.start.col ?? 0
    const endCol = entry.end.col ?? startCol
    const from = Math.min(startCol, endCol)
    const to = Math.max(startCol, endCol)
    const columnIds: string[] = []
    for (let visual = from; visual <= to; visual += 1) {
      const column = columns[hot.toPhysicalColumn(visual)]
      if (column) columnIds.push(column.id)
    }
    return {
      rowStart: Math.min(startRow, endRow),
      rowEnd: Math.max(startRow, endRow),
      columnIds,
    }
  })
}

function menuItemConfig(
  item: SheetbaseGridMenuItem,
  columns: readonly SheetbaseGridColumn[],
): MenuItemConfig {
  return {
    name: item.label,
    disabled: item.disabled,
    callback: function (this: Handsontable, _key, selection: unknown[]) {
      const context: SheetbaseGridMenuContext = {
        ranges: menuRanges(selection as MenuSelection, columns, this),
      }
      item.onSelect?.(context)
    },
  }
}

function clearContentsItem(
  columns: readonly SheetbaseGridColumn[],
  onNothingToClear: (() => void) | undefined,
  skipEmpty = true,
): MenuItemConfig {
  return {
    name: 'Clear contents',
    callback: function (this: Handsontable) {
      const ranges = this.getSelectedRange()
      if (!ranges || ranges.length === 0) return
      const updates: Array<[number, number, unknown]> = []
      for (const range of ranges) {
        const startRow = Math.min(range.from.row ?? 0, range.to.row ?? 0)
        const endRow = Math.max(range.from.row ?? 0, range.to.row ?? 0)
        const startCol = Math.min(range.from.col ?? 0, range.to.col ?? 0)
        const endCol = Math.max(range.from.col ?? 0, range.to.col ?? 0)
        for (let row = startRow; row <= endRow; row += 1) {
          for (let col = startCol; col <= endCol; col += 1) {
            const column = columns[this.toPhysicalColumn(col)]
            if (!column || column.readOnly) continue
            const current = this.getDataAtCell(row, col)
            if (skipEmpty && (current == null || current === '')) continue
            updates.push([row, col, null])
          }
        }
      }
      if (updates.length === 0) {
        onNothingToClear?.()
        return
      }
      this.setDataAtCell(updates, 'sheetbase.clear-contents')
    },
  }
}

function contextMenuItems(
  entries: readonly SheetbaseGridMenuEntry[],
  columns: readonly SheetbaseGridColumn[],
  onNothingToClear: (() => void) | undefined,
): Array<string | MenuItemConfig> {
  return entries.map((entry) => {
    if (typeof entry === 'string') {
      if (entry === 'separator') return '---------'
      if (entry === 'clear-contents')
        return clearContentsItem(columns, onNothingToClear)
      return BUILTIN_MENU_KEYS[entry] ?? entry
    }
    // A caller-declared `clear-contents` item keeps the wrapper's clear
    // behaviour but may own its disabled state.
    if (entry.id === 'clear-contents') {
      return {
        ...clearContentsItem(columns, onNothingToClear, entry.skipEmpty),
        disabled: entry.disabled,
      }
    }
    return menuItemConfig(entry, columns)
  })
}

function columnMenuItems(
  entries: readonly SheetbaseGridMenuEntry[],
  columns: readonly SheetbaseGridColumn[],
): Record<string, unknown> {
  const items: Record<string, unknown> = {
    filter_by_condition: {},
    filter_operators: {},
    filter_by_condition2: {},
    filter_by_value: {},
    filter_action_bar: {},
  }
  for (const [index, entry] of entries.entries()) {
    if (typeof entry === 'string') {
      items[`sheetbase_separator_${index}`] = '---------'
      continue
    }
    items[`sheetbase_item_${entry.id}`] = menuItemConfig(entry, columns)
  }
  return items
}

function displayRenderer(column: SheetbaseGridColumn) {
  return (
    _instance: Handsontable,
    td: HTMLTableCellElement,
    _row: number,
    _col: number,
    _prop: string | number,
    value: unknown,
  ) => {
    const text = column.displayText?.(value)
    td.textContent =
      text ?? (value == null ? '' : String(value as string | number))
    return td
  }
}

function toHotColumn(
  column: SheetbaseGridColumn,
  index: number,
  gridReadOnly: boolean,
  recordPickerEditor: typeof BaseEditor | null,
): ColumnSettings {
  const readOnly = column.readOnly ?? gridReadOnly
  const base: ColumnSettings = { data: index, readOnly }
  if (column.displayText) base.renderer = displayRenderer(column)
  if (column.type === 'number') {
    base.type = 'numeric'
    if (column.numberFormat)
      base.numericFormat = { pattern: column.numberFormat }
    if (column.formula && !readOnly) base.editor = FormulaReferenceEditor
    return base
  }
  if (column.type === 'checkbox') {
    base.type = 'checkbox'
    return base
  }
  if (column.type === 'date') {
    base.type = 'date'
    if (column.dateFormat) {
      base.dateFormat = column.dateFormat
      base.correctFormat = false
    }
    return base
  }
  if (column.type === 'datetime') {
    base.type = 'text'
    return base
  }
  if (column.type === 'select') {
    base.type = 'dropdown'
    base.source = [...(column.options ?? [])]
    return base
  }
  if (column.type === 'record') {
    base.type = 'text'
    if (!readOnly && recordPickerEditor) base.editor = recordPickerEditor
    return base
  }
  base.type = 'text'
  if (column.formula && !readOnly) base.editor = FormulaReferenceEditor
  return base
}

function SheetbaseGridClientBase(props: SheetbaseGridClientProps) {
  const {
    columns,
    rows,
    licenseKey,
    ariaLabel,
    descriptionId,
    cutStatusId,
    onReady,
  } = props

  // Set while saved filters are being (re)applied through the Filters plugin,
  // so the resulting `afterFilter` echo never re-persists restored state.
  const applyingFiltersRef = useRef(false)

  // The wrapper's hotInstance is assigned during the child's mount, after a
  // callback ref first sees the wrapper. Read it in the parent effect instead.
  const hotRef = useRef<HotTableRef>(null)
  useEffect(() => {
    const hot = hotRef.current?.hotInstance
    if (!hot) return
    hot.rootElement.setAttribute('aria-label', ariaLabel)
    hot.rootElement.setAttribute('aria-describedby', descriptionId)
    onReady?.(hot)
    return () => onReady?.(null)
  }, [ariaLabel, descriptionId, onReady])

  // Keep the picker opener in a ref so the editor class is created once even
  // as the caller re-renders with new callbacks (a new editor class would kill
  // an open editor and reconfigure the grid).
  const pickerRef = useRef({
    columns,
    open: props.onOpenRecordPicker,
  })
  pickerRef.current = { columns, open: props.onOpenRecordPicker }
  const recordPickerEditor = useMemo(
    () =>
      pickerRef.current.open
        ? createRecordPickerEditor(({ row, col }) => {
            const column = pickerRef.current.columns[col]
            if (!column) return
            pickerRef.current.open?.({
              rowIndex: row,
              columnIndex: col,
              columnId: column.id,
            })
          })
        : null,
    [],
  )

  const spreadsheetSettings = useMemo<HandsontableGridSettings>(() => {
    const callerBeforeChange = props.beforeCellsChange
    const callerAfterChange = props.onCellsChange
    const clipboardCopy = props.clipboard?.onCopy
    const clipboardCut = props.clipboard?.onCut
    const clipboardPaste = props.clipboard?.onPaste

    const toNeutralChange = (
      hot: Handsontable,
      change: CellChange,
    ): SheetbaseGridCellChange => {
      const rawColumn =
        typeof change[1] === 'number' ? change[1] : hot.propToCol(change[1] as string)
      const physicalColumn =
        typeof rawColumn === 'number' && rawColumn >= 0
          ? hot.toPhysicalColumn(rawColumn)
          : -1
      const physicalRow = hot.toPhysicalRow(change[0])
      return {
        rowIndex: physicalRow,
        rowId: rows[physicalRow]?.id,
        columnId: columns[physicalColumn]?.id ?? '',
        previous: change[2],
        next: change[3],
      }
    }

    const settings: HandsontableGridSettings = {
      data: rows.map((row) => [...row.cells]),
      columns: columns.map((column, index) =>
        toHotColumn(column, index, props.readOnly ?? false, recordPickerEditor),
      ),
      rowHeaders: props.rowHeaders ?? false,
      colHeaders: columns.map((column) => column.label),
      readOnly: props.readOnly ?? false,
      // Keep the spreadsheet contract wrapper-owned and explicit rather than
      // relying on vendor defaults that callers could accidentally replace.
      selectionMode: 'multiple',
      navigableHeaders: false,
      tabNavigation: true,
      outsideClickDeselects: true,
      enterBeginsEditing: true,
      enterMoves: { row: 1, col: 0 },
      tabMoves: { row: 0, col: 1 },
      autoWrapRow: false,
      autoWrapCol: false,
      copyPaste: true,
      fillHandle: !(props.readOnly ?? false),
      minSpareRows: props.spareRows ?? 0,
      renderAllRows: props.renderAllRows,
      renderAllColumns: props.renderAllColumns,
    }
    if (props.height !== undefined)
      settings.height = props.height === 'fill' ? '100%' : props.height
    if (props.stretch) settings.stretchH = props.stretch

    if (props.columnWidth) {
      settings.colWidths = (visualColumn: number) => {
        const hot = hotRef.current?.hotInstance
        const column =
          columns[hot?.toPhysicalColumn(visualColumn) ?? visualColumn]
        return column ? props.columnWidth?.(column.id) : undefined
      }
    }
    if (props.initialColumnWidths) {
      settings.manualColumnResize = [...props.initialColumnWidths]
    } else if (props.resizable) {
      settings.manualColumnResize = true
    }
    if (props.columnOrder) {
      const physicalById = new Map(
        columns.map((column, index) => [column.id, index]),
      )
      settings.manualColumnMove = props.columnOrder.map(
        (id) => physicalById.get(id) ?? 0,
      )
    } else if (props.reorderable) {
      settings.manualColumnMove = true
    }
    if (typeof props.frozenColumns === 'number') {
      settings.fixedColumnsStart = Math.min(props.frozenColumns, columns.length)
    }
    if (props.sorting || (props.sorts?.length ?? 0) > 0) {
      settings.columnSorting = {
        initialConfig: (props.sorts ?? []).flatMap((sort) => {
          const column = columns.findIndex(
            (candidate) => candidate.id === sort.columnId,
          )
          return column >= 0
            ? [{ column, sortOrder: sort.direction }]
            : []
        }),
      }
    }
    if (props.filtering) settings.filters = true
    if (props.columnMenuItems) {
      settings.dropdownMenu = {
        items: columnMenuItems(props.columnMenuItems, columns),
      } as GridSettings['dropdownMenu']
    }
    if (props.contextMenuItems === false) {
      settings.contextMenu = false
    } else if (props.contextMenuItems) {
      const entries = props.contextMenuItems
      settings.contextMenu = {
        items: (hot: Handsontable) =>
          contextMenuItems(entries, columns, props.onNothingToClear).map(
            (item) =>
              typeof item === 'string'
                ? item
                : typeof item.callback === 'function'
                  ? { ...item, callback: item.callback.bind(hot) }
                  : item,
          ),
      }
    }
    if (props.formulas) {
      settings.formulas = props.formulas as GridSettings['formulas']
    }
    const clipboardCopyHandler = clipboardCopy
      ? (data: CellValue[][], coords: RangeType[]) => {
          const range = coords.at(0)
          if (!range) return
          clipboardCopy(data, {
            startRow: range.startRow,
            startColumn: range.startCol,
            endRow: range.endRow,
            endColumn: range.endCol,
          })
        }
      : undefined
    const clipboardCutHandler = clipboardCut
      ? (data: CellValue[][], coords: RangeType[]) => {
          const range = coords.at(0)
          if (!range) return
          clipboardCut(data, {
            startRow: range.startRow,
            startColumn: range.startCol,
            endRow: range.endRow,
            endColumn: range.endCol,
          })
        }
      : undefined
    if (clipboardCopyHandler) settings.beforeCopy = clipboardCopyHandler
    if (clipboardPaste) {
      settings.beforePaste = (data: CellValue[][], coords: RangeType[]) => {
        const target = coords.at(0)
        if (!target) return
        clipboardPaste(data, {
          row: target.startRow,
          column: target.startCol,
        })
      }
    }

    // GRID-02: paste and fill are bulk-write sources. They fail closed when
    // any target cell is read-only or derived — partial writes that silently
    // skip guarded cells would misrepresent what the scientist committed.
    const bulkWriteSources = new Set(['CopyPaste.paste', 'Autofill.fill'])
    settings.beforeCut = function (
      this: Handsontable,
      data: CellValue[][],
      ranges: RangeType[],
    ) {
      if (includesReadOnlyCell(this, ranges)) {
        announceStatus(
          cutStatusId,
          'Cut is unavailable because the active range contains read-only or derived cells.',
        )
        return false
      }
      announceStatus(cutStatusId, '')
      return clipboardCutHandler ? clipboardCutHandler(data, ranges) : undefined
    }
    settings.beforeChange = function (
      this: Handsontable,
      changes: CellChange[] | null,
      source: string,
    ) {
      if (
        changes &&
        bulkWriteSources.has(source) &&
        changesIncludeReadOnlyCell(this, changes)
      ) {
        announceStatus(
          cutStatusId,
          source === 'CopyPaste.paste'
            ? 'Paste is unavailable because the target range contains read-only or derived cells.'
            : 'Fill is unavailable because the target range contains read-only or derived cells.',
        )
        return false
      }
      if (!changes || changes.length === 0 || !callerBeforeChange)
        return undefined
      const neutral = changes.map((change) => toNeutralChange(this, change))
      const result = callerBeforeChange(neutral, toWriteSource(source))
      if (result === false) {
        // Nullify instead of only returning false: the undo plugin records any
        // non-null change set regardless of the return value.
        for (let index = 0; index < changes.length; index += 1) {
          changes[index] = null as unknown as CellChange
        }
        return false
      }
      for (let index = 0; index < changes.length; index += 1) {
        changes[index][3] = neutral[index]?.next
      }
      return result
    }
    settings.afterChange = function (
      this: Handsontable,
      changes: CellChange[] | null,
      source: string,
    ) {
      if (!changes || !callerAfterChange) return
      callerAfterChange(
        changes.map((change) => toNeutralChange(this, change)),
        toWriteSource(source),
      )
    }
    settings.afterSelectionEnd = function (
      this: Handsontable,
      row: number,
      col: number,
    ) {
      if (row < 0 || col < 0 || !props.onSelectionChange) return
      const column = columns[this.toPhysicalColumn(col)]
      if (!column) return
      const physicalRow = this.toPhysicalRow(row)
      props.onSelectionChange({
        rowIndex: physicalRow,
        rowId: rows[physicalRow]?.id,
        columnId: column.id,
      })
    }
    if (props.onColumnResize) {
      settings.afterColumnResize = function (
        newSize: number,
        visualColumn: number,
      ) {
        const column = columns[this.toPhysicalColumn(visualColumn)]
        if (column) props.onColumnResize?.(column.id, newSize)
      }
    }
    if (props.onColumnOrderChange) {
      settings.afterColumnMove = function (
        _movedColumns: number[],
        _finalIndex: number,
        _dropIndex: number | undefined,
        movePossible: boolean,
        orderChanged: boolean,
      ) {
        if (!movePossible || !orderChanged) return
        const count = this.countCols()
        const ids: string[] = []
        for (let visual = 0; visual < count; visual += 1) {
          const column = columns[this.toPhysicalColumn(visual)]
          if (column) ids.push(column.id)
        }
        if (props.resetColumnOrderOnChange) {
          this.columnIndexMapper.setIndexesSequence(
            Array.from({ length: count }, (_, index) => index),
          )
        }
        props.onColumnOrderChange?.(ids)
      }
    }
    if (props.onSortsChange) {
      settings.afterColumnSort = function (
        _current: Array<{ column: number; sortOrder: string }>,
        destination: Array<{ column: number; sortOrder: string }>,
      ) {
        const sorts: SheetbaseGridSort[] = []
        for (const config of destination) {
          if (config.sortOrder !== 'asc' && config.sortOrder !== 'desc')
            continue
          const column = columns[this.toPhysicalColumn(config.column)]
          if (column)
            sorts.push({ columnId: column.id, direction: config.sortOrder })
        }
        if (JSON.stringify(sorts) === JSON.stringify(props.sorts ?? [])) return
        props.onSortsChange?.(sorts)
      }
    }
    if (props.onFiltersChange) {
      settings.afterFilter = function (stack: FilterConditionStack[]) {
        if (applyingFiltersRef.current) return
        const captured: SheetbaseGridFilter[] = []
        for (const entry of stack) {
          if (
            entry.operation !== undefined &&
            entry.operation !== 'conjunction'
          )
            continue
          const column = columns[entry.column]
          if (!column) continue
          for (const condition of entry.conditions) {
            const name = condition.name
            if (name === 'true' || name === 'false') {
              captured.push({
                columnId: column.id,
                operator: 'equals',
                value: name === 'true',
              })
            } else if (name === 'empty') {
              captured.push({ columnId: column.id, operator: 'is-empty' })
            } else if (name === 'not_empty') {
              captured.push({ columnId: column.id, operator: 'is-not-empty' })
            } else if (name === 'eq' || name === 'neq') {
              const value = condition.args?.at(0)
              if (
                value !== null &&
                typeof value !== 'string' &&
                typeof value !== 'number' &&
                typeof value !== 'boolean'
              )
                continue
              captured.push({
                columnId: column.id,
                operator: name === 'eq' ? 'equals' : 'not-equals',
                value,
              })
            }
          }
        }
        // A hidden column has no grid column, so its condition cannot be
        // captured — carry the persisted entries across so a later capture
        // does not silently drop them.
        const displayIds = new Set(columns.map((column) => column.id))
        const capturedIds = new Set(captured.map((filter) => filter.columnId))
        const preserved = (props.filters ?? []).filter(
          (filter) =>
            !displayIds.has(filter.columnId) &&
            !capturedIds.has(filter.columnId),
        )
        const filters: SheetbaseGridFilter[] = [...preserved, ...captured]
        if (JSON.stringify(filters) === JSON.stringify(props.filters ?? []))
          return
        props.onFiltersChange?.(filters)
      }
    }
    if (props.onBeforeRowsRemove || props.onRowsRemoved) {
      settings.beforeRemoveRow = function (index: number, amount: number) {
        if (props.onBeforeRowsRemove?.(index, amount) === false) return false
        return undefined
      }
      settings.afterRemoveRow = function (
        index: number,
        amount: number,
        source: string,
      ) {
        props.onRowsRemoved?.(index, amount, toWriteSource(source))
      }
    }
    return settings
  }, [
    columns,
    rows,
    props.readOnly,
    props.rowHeaders,
    props.height,
    props.stretch,
    props.spareRows,
    props.initialColumnWidths,
    props.resizable,
    props.columnOrder,
    props.reorderable,
    props.resetColumnOrderOnChange,
    props.frozenColumns,
    props.sorting,
    props.sorts,
    props.filtering,
    props.filters,
    props.columnMenuItems,
    props.contextMenuItems,
    props.formulas,
    props.clipboard,
    props.beforeCellsChange,
    props.onCellsChange,
    props.onSelectionChange,
    props.onColumnResize,
    props.onColumnOrderChange,
    props.onSortsChange,
    props.onFiltersChange,
    props.onBeforeRowsRemove,
    props.onRowsRemoved,
    props.onNothingToClear,
    props.columnWidth,
    props.renderAllRows,
    props.renderAllColumns,
    cutStatusId,
    recordPickerEditor,
  ])

  // GRID-04: whenever the display column set changes (reorder persisted,
  // hide/show, column added/retired), the grid is rebuilt from the display
  // order — make sure the visual index map never lingers over a different
  // column shape.
  const columnIdsKey = columns.map((column) => column.id).join('|')
  useEffect(() => {
    if (!props.resetColumnOrderOnChange) return
    const hot = hotRef.current?.hotInstance
    if (!hot) return
    const mapper = hot.columnIndexMapper
    const identity = Array.from(
      { length: hot.countCols() },
      (_, index) => index,
    )
    const current = mapper.getIndexesSequence()
    if (
      current.length !== identity.length ||
      current.some((value, index) => value !== identity[index])
    ) {
      mapper.setIndexesSequence(identity)
    }
  }, [columnIdsKey, props.resetColumnOrderOnChange])

  // Saved filters are applied through the engine's Filters plugin on mount and
  // re-applied after every rebuild — a presentation change reloads the data,
  // which clears in-session plugin state.
  const filtersKey = JSON.stringify(props.filters ?? [])
  useEffect(() => {
    if (!props.filtering) return
    const hot = hotRef.current?.hotInstance
    if (!hot) return
    const filtersPlugin = hot.getPlugin('filters') as
      | {
          clearConditions: () => void
          addCondition: (
            column: number,
            name: string,
            args: unknown[],
            operation?: string,
          ) => void
          filter: () => void
        }
      | undefined
    if (!filtersPlugin) return
    applyingFiltersRef.current = true
    try {
      filtersPlugin.clearConditions()
      const displayById = new Map(
        columns.map((column, index) => [column.id, index]),
      )
      for (const filter of props.filters ?? []) {
        const column = displayById.get(filter.columnId)
        if (column === undefined) continue
        if (filter.operator === 'equals') {
          if (filter.value === true) {
            filtersPlugin.addCondition(column, 'true', [], 'conjunction')
          } else if (filter.value === false) {
            filtersPlugin.addCondition(column, 'false', [], 'conjunction')
          } else {
            filtersPlugin.addCondition(
              column,
              'eq',
              [filter.value ?? null],
              'conjunction',
            )
          }
        } else if (filter.operator === 'not-equals') {
          filtersPlugin.addCondition(
            column,
            'neq',
            [filter.value ?? null],
            'conjunction',
          )
        } else if (filter.operator === 'is-empty') {
          filtersPlugin.addCondition(column, 'empty', [], 'conjunction')
        } else {
          filtersPlugin.addCondition(column, 'not_empty', [], 'conjunction')
        }
      }
      filtersPlugin.filter()
    } finally {
      applyingFiltersRef.current = false
    }
  }, [columns, filtersKey, props.filtering, props.filters])

  return (
    <HotTable
      {...spreadsheetSettings}
      className="sheetbase-grid"
      licenseKey={licenseKey}
      themeName="ht-theme-main"
      ref={hotRef}
    />
  )
}

// Memoize so that parent re-renders (e.g. formula bar state changes,
// selection updates) don't re-render the HotTable component when
// its props haven't actually changed.
// This is critical for editor stability: a re-render of HotTable
// causes it to call updateSettings, which can kill the active editor.
export const SheetbaseGridClient = memo(SheetbaseGridClientBase)
