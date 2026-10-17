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
 */
import { useCallback, useMemo } from 'react'
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
import {
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
} from '#/components/reui/data-grid/data-grid-table'
import { DataGridTableVirtual } from '#/components/reui/data-grid/data-grid-table-virtual'

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
  readonly id: string
}

/** A band for `label`, to place in the rows a grouped screen passes. */
export function bandRow(label: string, count?: number): BandRow {
  return { __band: label, __count: count, id: `band:${label}` }
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
   * Whether rows carry the selection checkbox. A screen whose rows are links
   * rather than a selection passes false.
   */
  selectable?: boolean
  /** Ordering the route owns and writes into the grid (the sort toolbar). */
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  isLoading?: boolean
  /** The extra classes a screen's row needs (e.g. a muted cell). */
  rowClassName?: string
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
  sorting,
  onSortingChange,
  isLoading = false,
}: RegistryGridProps<T>) {
  const allColumns = useMemo<RegistryColumn<RegistryRow<T>>[]>(() => {
    const body = columns as unknown as RegistryColumn<RegistryRow<T>>[]
    if (!selectable) return body
    return [
      {
        id: 'select',
        // The checkbox sits in the first column's own inset rather than in a
        // column of its own: a 40px column would push a table that already
        // fills the list area into a horizontal scroll, which is a change to
        // the screen, not an extra row control.
        header: () => (
          <span className="absolute inset-y-0 left-1.5 flex items-center">
            <DataGridTableRowSelectAll />
          </span>
        ),
        cell: ({ row }) =>
          isBand(row.original) ? null : (
            <span className="absolute inset-y-0 left-1.5 flex items-center">
              <DataGridTableRowSelect row={row} />
            </span>
          ),
        enableSorting: false,
        enableHiding: false,
        size: 0,
      },
      ...body,
    ]
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
          const paint = 'block h-[33px] bg-surface-muted -mx-2.5'
          const first = selectable ? 1 : 0
          if (index === first) {
            return (
              <span
                className={`${paint} -ml-6 flex items-center text-label font-medium text-fg-muted`}
              >
                {original.__band}
                {original.__count !== undefined ? (
                  <span className="ml-1 font-normal">{original.__count}</span>
                ) : null}
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
    <div className="flex h-full min-h-0 flex-col max-md:hidden">
      <DataGrid
        table={table}
        recordCount={rows.length}
        isLoading={isLoading}
        i18n={{ labels: { tableLabel: label } }}
        onRowClick={(row) => {
          if (isBand(row)) return
          onRowSelectionChange?.({ [getRowId(row)]: true })
          onRowClick?.(row)
        }}
        tableLayout={{ width: 'auto', headerSticky: true }}
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
          // `text-fg-muted`, as the v3 table head renders. With the select
          // column collapsed to zero width, the first *data* cell carries the
          // 24px inset the first column always had.
          header: selectable
            ? '[&_th]:h-[31px] [&_th]:px-2.5 [&_th:nth-child(2)]:pl-6 [&_th:first-child]:relative [&_th:first-child]:w-0 [&_th:first-child]:p-0 [&_th]:text-label [&_th]:text-fg-muted'
            : '[&_th]:h-[31px] [&_th]:px-2.5 [&_th:first-child]:pl-6 [&_th]:text-label [&_th]:text-fg-muted',
          body: selectable
            ? '[&_td]:h-[33px] [&_td]:py-0 [&_td]:px-2.5 [&_td:nth-child(2)]:pl-6 [&_td:first-child]:relative [&_td:first-child]:w-0 [&_td:first-child]:p-0'
            : '[&_td]:h-[33px] [&_td]:py-0 [&_td]:px-2.5 [&_td:first-child]:pl-6',
        }}
      >
        <DataGridScrollArea orientation="both">
          <DataGridTableVirtual height="100%" estimateSize={33} overscan={12} />
        </DataGridScrollArea>
      </DataGrid>
    </div>
  )
}
