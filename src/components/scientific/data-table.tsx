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
  CellData,
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
export interface DataTableColumnMeta {
  className?: string
}

// v9 registers features per table instead of exposing the whole v8 surface to
// every table. The built-in sort functions are registered so a sortable
// column without an explicit `sortFn` resolves exactly as it did on v8.
const dataTableFeatures = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
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

// `enablePagination` decides only whether rows are sliced, so the pagination
// feature is registered in both bundles (the pager's state and methods exist
// either way) and only the row model that slices is conditional. v9's core row
// model already resets the page index when `data` changes, and on filtering,
// sorting and grouping, so this table owns no reset effect of its own.
const paginatedDataTableFeatures = tableFeatures({
  ...dataTableFeatures,
  paginatedRowModel: createPaginatedRowModel(),
})

/** The column-definition shape this table's features accept. */
export type DataTableColumnDef<TData extends RowData> = ColumnDef<
  typeof dataTableFeatures,
  TData,
  CellData
>

interface DataTableProps<TData extends RowData> {
  columns: DataTableColumnDef<TData>[]
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
    features: enablePagination ? paginatedDataTableFeatures : dataTableFeatures,
    data,
    columns,
    state: { sorting, rowSelection, columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getRowId,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    enableSorting,
    enableRowSelection,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
  })

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
