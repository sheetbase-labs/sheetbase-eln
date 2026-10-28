/**
 * The registry grid: the one table body every registry screen renders.
 *
 * It is `@reui/data-grid` from the pinned base-nova registry (ADR-0055), placed
 * under `src/components/reui/`, rendered flush — the same chrome the bespoke
 * `v3/ui/table` body had before it: a muted header band, 33px rows, the app's
 * own footer band underneath, and no card around it. The swap is the table, not
 * the screen's look.
 *
 * What it adds over the copy it replaces, on every screen rather than one:
 * virtualised rows, and a per-row checkbox so selection is reachable from the
 * keyboard (the bespoke body's `onClick` row had no focusable control).
 *
 * A grouped list passes `bandRow(label)` in place of a record — the band a
 * grouped table draws across the width, e.g. `experiments.tsx`. Bands are not
 * selectable and no row renders behind them.
 *
 * The route keeps ownership of ordering: it sorts the array it passes, exactly
 * as the Sort menus it already had. The grid does not sort.
 *
 * The component owns the cell geometry — 33px rows, 10px cell padding, the 24px
 * inset on the first data column — because that is what makes the swap
 * invisible. A column that needs its own padding states it imperatively
 * (`pr-6!`); a plain `pr-6` in `meta.cellClassName` loses to the component's
 * own cell rules and is silently ignored.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { usePaneContext } from '#/components/workspace/workspace-navigation'
import type { ReactNode } from 'react'
import { useTable } from '@tanstack/react-table'
import type {
  ColumnDef,
  OnChangeFn,
  RowData,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'

import {
  DataGrid,
  dataGridFeatures,
} from '#/components/reui/data-grid/data-grid'
import type { DataGridFeatures } from '#/components/reui/data-grid/data-grid'
import { DataGridScrollArea } from '#/components/reui/data-grid/data-grid-scroll-area'
import { DataGridTableVirtual } from '#/components/reui/data-grid/data-grid-table-virtual'
import { cn } from '#/lib/utils'

/** A column of a registry table. */
export type RegistryColumn<T extends RowData> = ColumnDef<DataGridFeatures, T>

/**
 * The band a grouped registry table draws between groups: a muted strip across
 * the row with its label at the first column's inset. It carries no record, so
 * it is never selectable and never opens an inspector.
 */
export interface BandRow {
  readonly __band: string
  /** The group's size, shown after the label in the lighter weight. */
  readonly __count?: number
  /** A link or control at the band's right end. */
  readonly __action?: ReactNode
  readonly id: string
}

/** A band for `label`, to place in the rows a grouped screen passes. */
export function bandRow(
  label: string,
  count?: number,
  action?: ReactNode,
): BandRow {
  return {
    __band: label,
    __count: count,
    __action: action,
    id: `band:${label}`,
  }
}

function isBand(row: unknown): row is BandRow {
  return typeof row === 'object' && row !== null && '__band' in row
}

/** The row type a registry grid takes: a record, or a band between groups. */
export type RegistryRow<T> = T | BandRow

/**
 * A right-aligned column: the header and its cells take the table's right edge,
 * the way the bespoke body's `align="right"` head did.
 */
export function rightAligned<T extends RowData>(): Pick<
  ColumnDef<DataGridFeatures, T>,
  'meta'
> {
  return {
    meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
  }
}

/**
 * The selection a screen whose inspector follows one row wants: give it the id
 * the inspector is showing and the setter, and it hands back the state the grid
 * renders plus the change handler.
 *
 * The grid merges a checkbox toggle into the selection it was given, so the
 * handler takes the row the change *turned on* rather than the first key in the
 * merged state — otherwise a checkbox on any other row would look inert, which
 * is exactly what the first spelling of this did. Clearing the last checked row
 * closes the inspector.
 */
export function useRowFocus(
  selectedId: string | null,
  setSelectedId: (id: string | null) => void,
): {
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
} {
  const rowSelection = useMemo<RowSelectionState>(
    () => (selectedId ? { [selectedId]: true } : {}),
    [selectedId],
  )
  const onRowSelectionChange = useCallback<OnChangeFn<RowSelectionState>>(
    (next) => {
      const value = typeof next === 'function' ? next(rowSelection) : next
      const ids = Object.keys(value)
      const turnedOn = ids.find((id) => !Object.hasOwn(rowSelection, id))
      setSelectedId(turnedOn ?? ids.at(-1) ?? null)
    },
    [rowSelection, setSelectedId],
  )
  return { rowSelection, onRowSelectionChange }
}

export interface RegistryGridProps<T extends RowData> {
  /** The table's accessible name, e.g. "Samples". */
  label: string
  rows: RegistryRow<T>[]
  columns: RegistryColumn<T>[]
  getRowId: (row: T) => string
  /** Required only when `selectable`; omit it on a screen whose rows are links. */
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  /** The single row the inspector shows; clicking a row selects it. */
  onRowClick?: (row: T) => void
  /**
   * Whether a row can be selected (click or keyboard) to drive the screen's
   * inspector. A detail table whose rows are not a selection passes false.
   */
  selectable?: boolean
  /** Ordering the route owns and writes into the grid (the sort toolbar). */
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  isLoading?: boolean
  /** The extra classes a screen's row needs (e.g. a muted cell). */
  rowClassName?: string
  /**
   * The wrapper's own classes. A registry list passes `max-md:hidden` because
   * it has a `MobileList` underneath; a detail-screen table renders at every
   * width, which is what it did before it moved onto the grid.
   */
  className?: string
}

export function RegistryGrid<T extends RowData>({
  label,
  rows,
  columns,
  getRowId,
  rowSelection = {},
  onRowSelectionChange,
  onRowClick,
  selectable = true,
  className,
  sorting,
  onSortingChange,
  isLoading = false,
}: RegistryGridProps<T>) {
  const gridRef = useRef<HTMLDivElement>(null)

  // Linked panes: report this grid's selected row, and take the row the pane
  // being followed selects when this grid has it.
  const { reportSelection, followedSelection } = usePaneContext()
  const selectedKey = Object.keys(rowSelection).at(0)
  useEffect(() => {
    if (selectable) reportSelection(selectedKey)
  }, [reportSelection, selectable, selectedKey])
  useEffect(() => {
    if (
      !selectable ||
      !followedSelection ||
      followedSelection === selectedKey ||
      !rows.some((row) => !isBand(row) && getRowId(row) === followedSelection)
    )
      return
    onRowSelectionChange?.({ [followedSelection]: true })
    // Only a change in what is followed moves this grid's selection.
  }, [followedSelection])

  /**
   * The row is the control. A selectable row takes focus (one tab stop, on the
   * selected row or the first), Enter or Space selects it, and the arrow keys
   * walk the rows — the keyboard path the old click-only table never had, with
   * no checkbox column duplicating the click.
   */
  useEffect(() => {
    const root = gridRef.current
    if (!root || !selectable) return
    const rowOf = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLTableRowElement>('tbody tr[data-index]')
        : null
    const sync = () => {
      const rows = [
        ...root.querySelectorAll<HTMLTableRowElement>('tbody tr[data-index]'),
      ]
      const selected = rows.find((tr) => tr.dataset.state === 'selected')
      for (const tr of rows) {
        tr.tabIndex = tr === (selected ?? rows[0]) ? 0 : -1
      }
    }
    const observer = new MutationObserver(sync)
    observer.observe(root, { childList: true, subtree: true })
    const onKeyDown = (event: KeyboardEvent) => {
      const tr = rowOf(event.target)
      if (!tr) return
      // Enter opens the row. Space is the peek key everywhere, so it is left
      // to the workspace shortcut rather than selecting here.
      if (event.key === 'Enter') {
        event.preventDefault()
        tr.click()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const next =
          event.key === 'ArrowDown'
            ? tr.nextElementSibling
            : tr.previousElementSibling
        if (next instanceof HTMLTableRowElement && next.dataset.index) {
          event.preventDefault()
          next.focus()
        }
      }
    }
    root.addEventListener('keydown', onKeyDown)
    sync()
    return () => {
      observer.disconnect()
      root.removeEventListener('keydown', onKeyDown)
    }
  }, [selectable, rows])

  const allColumns = useMemo<RegistryColumn<RegistryRow<T>>[]>(() => {
    const body = columns as unknown as RegistryColumn<RegistryRow<T>>[]
    return body
  }, [columns, selectable])

  /**
   * A band renders as the muted strip the grouped screens draw: every cell
   * paints it, and the first data column carries the label. Each cell paints
   * its own strip, so the band is continuous across the row — which an HTML
   * table cannot otherwise express without a spanning cell.
   */
  const decorated = useMemo<RegistryColumn<RegistryRow<T>>[]>(
    () =>
      allColumns.map((column, index) => ({
        ...column,
        cell: (context) => {
          const original = context.row.original
          if (!isBand(original)) {
            const cell = column.cell
            return typeof cell === 'function'
              ? cell(context)
              : ((context.getValue() as ReactNode) ?? null)
          }
          // Every cell paints the strip, so it reads as one band across the
          // row; the first data column carries the label.
          // The strip reaches over the cell's own padding: 24px at the table's
          // outer edges, 10px between cells.
          const left = index === 0 ? '-ml-6 pl-6' : '-ml-2.5'
          const right = index === allColumns.length - 1 ? '-mr-6' : '-mr-2.5'
          const paint = `block h-[33px] bg-surface-muted ${left} ${right}`
          if (index === 0) {
            return (
              <span
                className={`${paint} flex items-center text-label font-medium text-fg-muted`}
              >
                {original.__band}
                {original.__count !== undefined ? (
                  <span className="ml-1 font-normal">{original.__count}</span>
                ) : null}
              </span>
            )
          }
          if (index === allColumns.length - 1 && original.__action) {
            return (
              <span
                className={`${paint} flex items-center justify-end pr-6 text-label`}
              >
                {original.__action}
              </span>
            )
          }
          return <span className={paint} />
        },
      })),
    [allColumns, selectable],
  )

  const table = useTable({
    features: dataGridFeatures,
    columns: decorated,
    data: rows,
    state: sorting ? { rowSelection, sorting } : { rowSelection },
    onRowSelectionChange,
    onSortingChange,
    // Bands carry their own id; records go through the screen's own resolver.
    getRowId: (row) => (isBand(row) ? row.id : getRowId(row)),
    // A virtualised grid renders every row, so the paginated row model has to
    // be told the data already is the page; these screens have no server paging.
    manualPagination: true,
    // A band is a heading, not a record: it cannot be selected or clicked.
    enableRowSelection: (row) => !isBand(row.original),
  })

  return (
    // `[&>*]` stretches the grid's own scroll container: it sizes itself to
    // its rows, which on a short list leaves the horizontal scrollbar floating
    // under the last row instead of at the list area's edge.
    <div
      ref={gridRef}
      className={cn(
        'flex h-full min-h-0 flex-col [&>*]:min-h-0 [&>*]:flex-1',
        className,
      )}
    >
      <DataGrid
        className="min-h-0 flex-1"
        table={table}
        recordCount={rows.length}
        isLoading={isLoading}
        i18n={{ labels: { tableLabel: label } }}
        onRowClick={(row) => {
          if (isBand(row)) return
          onRowSelectionChange?.({ [getRowId(row)]: true })
          onRowClick?.(row)
        }}
        // The rows scroll inside the grid, so a sticky header would hold the
        // band at the top of the list area while scrolling — a behaviour the
        // tables it replaces never had. The header scrolls with the rows.
        tableLayout={{ width: 'auto', headerSticky: false }}
        tableClassNames={{
          // The registry table never wraps: a row is one line, and the scroll
          // area carries the overflow (the v3 table's own rule).
          base: 'num w-full whitespace-nowrap',
          // The v3 table's own geometry, so the swap is invisible: a 31px
          // muted header band, 33px rows, 10px cell padding with the first
          // cell inset to 24px.
          headerRow: 'bg-surface-muted',
          // The th carries its own font and colour, so the header's own
          // classes have to reach it: `text-label` (12px, medium) in
          // `text-fg-muted`, as the v3 table head renders.
          header:
            '[&_th]:h-[31px] [&_th]:px-2.5 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6 [&_th]:text-label [&_th]:text-fg-muted',
          body: '[&_td]:h-[33px] [&_td]:py-0 [&_td]:px-2.5 [&_td:first-child]:pl-6 [&_td:last-child]:pr-6',
        }}
      >
        <DataGridScrollArea orientation="both" className="h-full">
          <DataGridTableVirtual height="100%" estimateSize={33} overscan={12} />
        </DataGridScrollArea>
      </DataGrid>
    </div>
  )
}
