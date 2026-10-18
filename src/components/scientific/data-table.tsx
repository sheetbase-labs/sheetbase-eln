import * as React from 'react'
import {
  columnVisibilityFeature,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  metaHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_alphanumericCaseSensitive,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  sortFn_textCaseSensitive,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type {
  ColumnDef,
  ColumnVisibilityState,
  RowData,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'
// Sort-direction arrows; the v3 set has no equivalents.
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#/components/v3/ui/dropdown-menu'
import { cn } from '#/lib/utils'

// Column width/alignment hints consumed by the TableHead/TableCell renderers
// so the dense grid stays aligned without per-cell className repetition.
//
// v9 types `columnDef.meta` from the feature bundle's `columnMeta` slot, which
// wins over the global `ColumnMeta` interface — a v8 `declare module`
// augmentation is ignored by any table built from a bundle, so the type is
// exported and registered instead.
export interface DataTableColumnMeta {
  className?: string
}

/**
 * The features this table declares. v9 asks every table to name the features
 * it uses up front, and the bundle carries the row models and the `sortFns`
 * registry with them.
 *
 * `sortFns` is load-bearing, not decoration: a string `sortFn` resolves
 * against this registry alone, and the default `sortFn: 'auto'` infers one of
 * its names from the first rows' values — a partial map makes ordinary string
 * columns warn in development and fall back to unsorted order.
 */
export const dataTableFeatures = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    alphanumericCaseSensitive: sortFn_alphanumericCaseSensitive,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
    textCaseSensitive: sortFn_textCaseSensitive,
  },
  columnMeta: metaHelper<DataTableColumnMeta>(),
})

/** The feature set `dataTableFeatures` registers; annotate columns with it. */
export type DataTableFeatures = typeof dataTableFeatures

interface DataTableProps<TData extends RowData> {
  /** Column defs for this table. v9 types a column's value per column, so the
   * defs are `ColumnDef<DataTableFeatures, TData, unknown>` — the shape
   * `useTable` itself takes — and annotate with `DataTableFeatures`. */
  columns: ColumnDef<DataTableFeatures, TData, unknown>[]
  data: TData[]
  enableSorting?: boolean
  enableRowSelection?: boolean
  onRowClick?: (row: TData) => void
  toolbar?: React.ReactNode
  className?: string
  tableClassName?: string
  label?: string
  enablePagination?: boolean
  enableColumnVisibility?: boolean
  initialColumnVisibility?: ColumnVisibilityState
  variant?: 'default' | 'quiet'
  emptyMessage?: React.ReactNode
  getRowId?: (row: TData) => string
}

function DataTable<TData extends RowData>({
  columns,
  data,
  enableSorting = true,
  enableRowSelection = false,
  onRowClick,
  toolbar,
  className,
  tableClassName,
  label,
  enablePagination = false,
  enableColumnVisibility = false,
  initialColumnVisibility = {},
  variant = 'default',
  emptyMessage = 'No results.',
  getRowId,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>(initialColumnVisibility)
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    state: { sorting, rowSelection, columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getRowId,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    // The v9 paginated row model slices whenever it is registered, so a table
    // that renders every row keeps them by declaring pagination manual:
    // `getRowModel()` then returns the pre-paginated (sorted, unsliced) model.
    manualPagination: !enablePagination,
    enableSorting,
    enableRowSelection,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
  })

  // v9's `useTable` returns a new object whenever table state changes, so the
  // reset must not depend on the table instance: an effect that did would
  // re-run on every render and pin the page at 1. `setPageIndex` is an own
  // property of the table instance, so its identity is stable across renders.
  const { setPageIndex } = table
  React.useEffect(() => {
    if (enablePagination) setPageIndex(0)
  }, [data, enablePagination, setPageIndex])

  return (
    <div className={cn('min-w-0 space-y-2', className)}>
      {(toolbar || enableColumnVisibility) && (
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          {enableColumnVisibility && (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="secondary" size="sm" icon="schema" />
                  }
                >
                  Columns
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {table
                    .getAllLeafColumns()
                    .filter((column) => column.getCanHide())
                    .map((column) => (
                      <DropdownMenuItem
                        key={column.id}
                        closeOnClick={false}
                        icon={column.getIsVisible() ? 'check' : undefined}
                        onClick={() => column.toggleVisibility()}
                      >
                        {typeof column.columnDef.header === 'string'
                          ? column.columnDef.header
                          : column.id}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      )}
      <div
        className={
          variant === 'quiet'
            ? 'border-y border-border'
            : 'overflow-hidden rounded-md border'
        }
      >
        <Table className={tableClassName} aria-label={label}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {enableRowSelection && (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all rows"
                      checked={table.getIsAllPageRowsSelected()}
                      indeterminate={
                        !table.getIsAllPageRowsSelected() &&
                        table.getIsSomePageRowsSelected()
                      }
                      onCheckedChange={(value) =>
                        table.toggleAllPageRowsSelected(Boolean(value))
                      }
                    />
                  </TableHead>
                )}
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={header.column.columnDef.meta?.className}
                    aria-sort={
                      header.column.getIsSorted() === 'asc'
                        ? 'ascending'
                        : header.column.getIsSorted() === 'desc'
                          ? 'descending'
                          : undefined
                    }
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <Button
                        variant="quiet"
                        size="sm"
                        className="-ml-2 rounded-sm hover:bg-transparent hover:text-fg dark:hover:bg-transparent"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {header.column.getIsSorted() === 'asc' ? (
                          <ArrowUp className="size-3.5" />
                        ) : header.column.getIsSorted() === 'desc' ? (
                          <ArrowDown className="size-3.5" />
                        ) : (
                          <ArrowUpDown className="size-3.5" />
                        )}
                      </Button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  className={cn(onRowClick && 'cursor-pointer')}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {enableRowSelection && (
                    <TableCell
                      onClick={(event) => event.stopPropagation()}
                      className="w-10"
                    >
                      <Checkbox
                        aria-label="Select row"
                        checked={row.getIsSelected()}
                        onCheckedChange={(value) =>
                          row.toggleSelected(Boolean(value))
                        }
                      />
                    </TableCell>
                  )}
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cell.column.columnDef.meta?.className}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={
                    table.getVisibleLeafColumns().length +
                    (enableRowSelection ? 1 : 0)
                  }
                  className="h-24 text-center text-fg-muted"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {enablePagination && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-fg-muted">
          <label className="flex items-center gap-2">
            Rows per page
            <select
              className="rounded-md border border-input bg-surface p-1 text-fg"
              value={table.state.pagination.pageSize}
              onChange={(event) =>
                table.setPageSize(Number(event.target.value))
              }
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <span role="status">
              Page {table.state.pagination.pageIndex + 1} of{' '}
              {Math.max(1, table.getPageCount())}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export { DataTable, type DataTableProps }
