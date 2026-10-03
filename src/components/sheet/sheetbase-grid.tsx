import type Handsontable from 'handsontable/base'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import { Component, useEffect, useId, useState } from 'react'

/**
 * COMP-06 step 1 — the caller-facing contract for a scientific Sheet grid is
 * written in Sheetbase terms (columns with a source and a type, rows, per-cell
 * state and write callbacks). It does not mention the rendering engine: the
 * Handsontable-specific settings live inside `sheetbase-grid-client.tsx`,
 * which translates these props onto Handsontable until later steps swap the
 * implementation onto `sheetbase-table`. Callers never build vendor settings.
 */

/** One cell value as the grid stores and displays it. */
export type SheetbaseGridCellValue = unknown

/**
 * Where a column's values come from. `bound` columns write through the owning
 * record/Dataset; `local` columns are Sheet-instance-local; `calculated`
 * columns are derived and never user-writable.
 */
export type SheetbaseGridColumnSource = 'bound' | 'local' | 'calculated'

/** The neutral editor/rendering type of a column's cells. */
export type SheetbaseGridColumnType =
  'text' | 'number' | 'checkbox' | 'date' | 'datetime' | 'select' | 'record'

export interface SheetbaseGridColumn {
  /** Stable column identity (field id / local field id). */
  id: string
  /** Header label, already carrying any display-only unit suffix. */
  label: string
  source: SheetbaseGridColumnSource
  type: SheetbaseGridColumnType
  /** The column cannot be edited (derived, retired or read-only Sheet). */
  readOnly?: boolean
  /** Initial column width in pixels. */
  width?: number
  /** Numeric display pattern for `number` columns (for example `0.00`). */
  numberFormat?: string
  /** Allowed values for `select` columns. */
  options?: readonly string[]
  /** ISO format for `date`/`datetime` columns. */
  dateFormat?: string
  /**
   * Display-only text for a stored value (Record labels, category labels).
   * Returning `undefined` keeps the engine's default rendering.
   */
  displayText?: (value: unknown) => string | undefined
  /** Editable cells in this column open the formula-reference editor. */
  formula?: boolean
}

/** One grid row: a stable identity plus its cells, in column order. */
export interface SheetbaseGridRow {
  /** Stable row identity (rowKey / record id); absent for a spare row. */
  id?: string
  cells: readonly SheetbaseGridCellValue[]
}

export type SheetbaseGridWriteSource =
  'edit' | 'paste' | 'fill' | 'clear' | 'load' | 'formula'

export interface SheetbaseGridCellChange {
  /** Index into `rows`, resolved to physical order after presentation. */
  rowIndex: number
  rowId?: string
  columnId: string
  previous: unknown
  next: unknown
}

export interface SheetbaseGridSelection {
  rowIndex: number
  /** Stable row identity at that index, when the row has one. */
  rowId?: string
  columnId: string
}

export interface SheetbaseGridSort {
  columnId: string
  direction: 'asc' | 'desc'
}

/** A saved filter, expressed with neutral comparison operators. */
export interface SheetbaseGridFilter {
  columnId: string
  operator: 'equals' | 'not-equals' | 'is-empty' | 'is-not-empty'
  value?: string | number | boolean | null
}

/** A selection range in display coordinates, with the column ids it covers. */
export interface SheetbaseGridRange {
  rowStart: number
  rowEnd: number
  /** Display columns covered by the range, in order (may repeat a column). */
  columnIds: string[]
}

export interface SheetbaseGridMenuContext {
  ranges: readonly SheetbaseGridRange[]
}

/** Menu operations the wrapper implements itself. */
export type SheetbaseGridBuiltinMenuItem =
  | 'separator'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'undo'
  | 'redo'
  | 'insert-row-above'
  | 'insert-row-below'
  | 'remove-row'
  | 'clear-contents'

export interface SheetbaseGridMenuItem {
  id: string
  label: string
  disabled?: () => boolean
  /** For a `clear-contents` item: skip cells that are already empty. */
  skipEmpty?: boolean
  onSelect?: (context: SheetbaseGridMenuContext) => void
}

export type SheetbaseGridMenuEntry =
  SheetbaseGridBuiltinMenuItem | SheetbaseGridMenuItem

/**
 * Transitional: the formula engine is still the vendor engine owned by the
 * calling workspace. COMP-06 step 4 moves calculation authority into the grid.
 */
export interface SheetbaseGridFormulas {
  engine: unknown
  sheetName: string
}

/** Clipboard hooks for formula-preserving copy/cut/paste. */
export interface SheetbaseGridClipboard {
  onCopy?: (
    data: SheetbaseGridCellValue[][],
    range: {
      startRow: number
      startColumn: number
      endRow: number
      endColumn: number
    },
  ) => void
  onCut?: (
    data: SheetbaseGridCellValue[][],
    range: {
      startRow: number
      startColumn: number
      endRow: number
      endColumn: number
    },
  ) => void
  onPaste?: (
    data: SheetbaseGridCellValue[][],
    target: { row: number; column: number },
  ) => void
}

export interface SheetbaseGridProps {
  columns: readonly SheetbaseGridColumn[]
  rows: readonly SheetbaseGridRow[]
  ariaLabel?: string
  description?: string
  /** Blocks all editing; selection, copy and presentation stay live. */
  readOnly?: boolean
  /** Show the row-number header column. */
  rowHeaders?: boolean
  /** Extra blank rows kept at the end for entry. */
  spareRows?: number
  /** Fixed height, or `'fill'` to fill the container. */
  height?: number | 'fill'
  /** How columns stretch to fill the available width. */
  stretch?: 'none' | 'last' | 'all'
  /** Column width by id (takes precedence over `column.width`). */
  columnWidth?: (columnId: string) => number | undefined
  /** Initial widths in column order (enables resizing when given). */
  initialColumnWidths?: readonly number[]
  /** Enable column resizing when no initial widths are supplied. */
  resizable?: boolean
  /** Initial display order by column id (enables reordering when given). */
  columnOrder?: readonly string[]
  /** Enable column reordering. */
  reorderable?: boolean
  /**
   * Reset the engine's visual column order after a move once the caller has
   * persisted the new order (the rebuilt rows already carry it).
   */
  resetColumnOrderOnChange?: boolean
  /** Number of leading columns pinned in place. */
  frozenColumns?: number
  /** Enable client-side column sorting. */
  sorting?: boolean
  /** Restored sort state. */
  sorts?: readonly SheetbaseGridSort[]
  onSortsChange?: (sorts: SheetbaseGridSort[]) => void
  /** Enable the column filter dropdown. */
  filtering?: boolean
  /** Restored filter state. */
  filters?: readonly SheetbaseGridFilter[]
  onFiltersChange?: (filters: SheetbaseGridFilter[]) => void
  /** Extra items appended to the column header menu. */
  columnMenuItems?: readonly SheetbaseGridMenuEntry[]
  /** Context menu entries; `false` disables the menu. */
  contextMenuItems?: readonly SheetbaseGridMenuEntry[] | false
  /** Called when a `clear-contents` selection contains nothing to clear. */
  onNothingToClear?: () => void
  /** Formula engine configuration. */
  formulas?: SheetbaseGridFormulas
  clipboard?: SheetbaseGridClipboard
  /**
   * Per-cell presentation state. Reserved for the `sheetbase-table` contract;
   * the current engine renders read-only/derived via the column's source.
   */
  cellState?: (
    rowIndex: number,
    columnId: string,
  ) => SheetbaseCellState | undefined
  /**
   * Validation gate for every write source. Return `false` to reject the whole
   * change; mutated `change.next` values are applied back to the grid.
   */
  beforeCellsChange?: (
    changes: SheetbaseGridCellChange[],
    source: SheetbaseGridWriteSource,
  ) => boolean | void
  /** Fired after a change set is applied. */
  onCellsChange?: (
    changes: readonly SheetbaseGridCellChange[],
    source: SheetbaseGridWriteSource,
  ) => void
  onSelectionChange?: (selection: SheetbaseGridSelection | null) => void
  onColumnResize?: (columnId: string, width: number) => void
  onColumnOrderChange?: (columnIds: string[]) => void
  /** Preflight hook for row removal; return `false` to block it. */
  onBeforeRowsRemove?: (rowIndex: number, amount: number) => boolean | void
  /** Fired after rows are removed. */
  onRowsRemoved?: (
    rowIndex: number,
    amount: number,
    source: SheetbaseGridWriteSource,
  ) => void
  /**
   * Opens the shared Record picker for a `record` cell. Coordinates are the
   * cell's display position so the caller can write the picked value back
   * through the same change pipeline.
   */
  onOpenRecordPicker?: (cell: {
    rowIndex: number
    columnIndex: number
    columnId: string
  }) => void
  /**
   * Transitional: the live engine instance, for imperative operations the
   * neutral contract does not yet cover. COMP-06 step 2 replaces this with a
   * neutral handle.
   */
  onReady?: (instance: Handsontable | null) => void
}

/**
 * Per-cell presentation state, mirroring the COMP-02 contract the
 * `sheetbase-table` backend will consume.
 */
export type SheetbaseCellState =
  'invalid' | 'flagged' | 'pending' | 'derived' | 'readonly' | 'unsynced'

export interface SheetbaseGridClientProps extends SheetbaseGridProps {
  licenseKey: string
  ariaLabel: string
  descriptionId: string
  cutStatusId: string
  /** Internal test seam: render every row regardless of the viewport. */
  renderAllRows?: boolean
  /** Internal test seam: render every column regardless of the viewport. */
  renderAllColumns?: boolean
}

type ClientGrid = ComponentType<SheetbaseGridClientProps>

interface GridBoundaryProps {
  children: ReactNode
}

interface GridBoundaryState {
  failed: boolean
}

class GridBoundary extends Component<GridBoundaryProps, GridBoundaryState> {
  state: GridBoundaryState = { failed: false }

  static getDerivedStateFromError(): GridBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Sheetbase grid failed to initialise.', error, info)
  }

  render() {
    if (this.state.failed) {
      return <GridFailure message="The scientific sheet could not start." />
    }
    return this.props.children
  }
}

function GridFailure({ message }: { message: string }) {
  return (
    <div
      className="rounded-md border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      <p className="font-medium">Sheet unavailable</p>
      <p className="mt-1 text-xs">
        {message} Reload the page or contact support.
      </p>
    </div>
  )
}

export function SheetbaseGrid({
  ariaLabel = 'Scientific data sheet',
  description = 'Spreadsheet. Tab moves forward and Shift+Tab moves back; at a horizontal edge, Tab returns to the page. Arrow keys move, and Shift+Arrow extends the active range. Control or Command with an arrow moves to an edge. Home and End move within a row; Control or Command with Home or End moves to a grid corner. Page Up and Page Down move by a viewport. Enter or F2 starts editing, Enter commits, and Escape cancels. Control or Command+A selects all cells, Control+Space selects a column, and Shift+Space selects a row. Control or Command-click adds a range; keyboard commands affect the last active range. Copy and cut use only the active range. Cut is blocked when that range contains read-only or derived cells.',
  onReady,
  ...props
}: SheetbaseGridProps) {
  const descriptionId = useId()
  const cutStatusId = useId()
  const [ClientGrid, setClientGrid] = useState<ClientGrid | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const licenseKey = import.meta.env.VITE_HANDSONTABLE_LICENSE_KEY?.trim()

  useEffect(() => {
    if (!licenseKey) return
    let active = true
    import('./sheetbase-grid-client')
      .then(({ SheetbaseGridClient }) => {
        if (active) setClientGrid(() => SheetbaseGridClient)
      })
      .catch((error: unknown) => {
        console.error('Sheetbase grid client bundle failed to load.', error)
        if (active) setLoadFailed(true)
      })
    return () => {
      active = false
    }
  }, [licenseKey])

  if (!licenseKey) {
    return <GridFailure message="A Handsontable licence is not configured." />
  }
  if (loadFailed) {
    return <GridFailure message="The grid client could not be loaded." />
  }

  return (
    <section
      className="relative h-full min-h-0 w-full overflow-hidden rounded-sm focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring/50"
      aria-describedby={descriptionId}
      aria-label={ariaLabel}
    >
      <p className="sr-only" id={descriptionId}>
        {description}
      </p>
      <p
        className="pointer-events-none absolute bottom-2 left-2 z-50 max-w-[calc(100%_-_1rem)] rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md empty:hidden"
        id={cutStatusId}
        aria-live="polite"
      />
      {ClientGrid ? (
        <GridBoundary>
          <ClientGrid
            {...props}
            ariaLabel={ariaLabel}
            descriptionId={descriptionId}
            cutStatusId={cutStatusId}
            licenseKey={licenseKey}
            onReady={onReady}
          />
        </GridBoundary>
      ) : (
        <div
          className="rounded-md border border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground"
          role="status"
        >
          Preparing scientific sheet…
        </div>
      )}
    </section>
  )
}
