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
 * The route keeps ownership of ordering: it sorts the array it passes, exactly
 * as the Sort menus it already had. The grid does not sort.
 */
import { useMemo } from 'react'
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

export interface RegistryGridProps<T extends RowData> {
  /** The table's accessible name, e.g. "Samples". */
  label: string
  rows: T[]
  columns: RegistryColumn<T>[]
  getRowId: (row: T) => string
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  /** The single row the inspector shows; clicking a row selects it. */
  onRowClick?: (row: T) => void
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
  rowSelection,
  onRowSelectionChange,
  onRowClick,
  sorting,
  onSortingChange,
  isLoading = false,
}: RegistryGridProps<T>) {
  const allColumns = useMemo<RegistryColumn<T>[]>(
    () => [
      {
        id: 'select',
        header: () => <DataGridTableRowSelectAll />,
        cell: ({ row }) => <DataGridTableRowSelect row={row} />,
        enableSorting: false,
        enableHiding: false,
        size: 40,
      },
      ...columns,
    ],
    [columns],
  )

  const table = useTable({
    features: dataGridFeatures,
    columns: allColumns,
    data: rows,
    state: sorting ? { rowSelection, sorting } : { rowSelection },
    onRowSelectionChange,
    onSortingChange,
    getRowId,
    // A virtualised grid renders every row, so the paginated row model has to
    // be told the data already is the page; these screens have no server paging.
    manualPagination: true,
    enableRowSelection: true,
  })

  return (
    <div className="flex h-full min-h-0 flex-col max-md:hidden">
      <DataGrid
        table={table}
        recordCount={rows.length}
        isLoading={isLoading}
        i18n={{ labels: { tableLabel: label } }}
        onRowClick={(row) => {
          onRowSelectionChange({ [getRowId(row)]: true })
          onRowClick?.(row)
        }}
        tableLayout={{ width: 'auto', headerSticky: true }}
        tableClassNames={{
          // The registry table never wraps: a row is one line, and the scroll
          // area carries the overflow (the v3 table's own rule).
          base: 'w-full whitespace-nowrap',
          // The v3 table's header band: muted across the full width.
          headerRow: 'bg-surface-muted',
          header: 'text-fg-muted',
        }}
      >
        <DataGridScrollArea orientation="both">
          <DataGridTableVirtual height="100%" estimateSize={33} overscan={12} />
        </DataGridScrollArea>
      </DataGrid>
    </div>
  )
}
