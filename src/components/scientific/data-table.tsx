import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type {
  ColumnDef,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'
import { ArrowUpDown, ArrowUp, ArrowDown, Columns3 } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from '#/components/ui/dropdown-menu'
import { cn } from '#/lib/utils'

// Column width/alignment hints consumed by the TableHead/TableCell renderers
// so the dense grid stays aligned without per-cell className repetition.
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    className?: string
  }
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
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
  initialColumnVisibility?: VisibilityState
  variant?: 'default' | 'quiet'
  emptyMessage?: React.ReactNode
  getRowId?: (row: TData) => string
}

function DataTable<TData, TValue>({
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
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] = React.useState(
    initialColumnVisibility,
  )
  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection, columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getRowId,
    initialState: { pagination: { pageSize: 20 } },
    getPaginationRowModel: enablePagination
      ? getPaginationRowModel()
      : undefined,
    enableSorting,
    enableRowSelection,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  React.useEffect(() => {
    if (enablePagination) table.setPageIndex(0)
  }, [data, enablePagination, table])

  return (
    <div className={cn('min-w-0 space-y-2', className)}>
      {(toolbar || enableColumnVisibility) && (
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          {enableColumnVisibility && (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Columns3 className="size-4" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {table
                    .getAllLeafColumns()
                    .filter((column) => column.getCanHide())
                    .map((column) => (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) =>
                          column.toggleVisibility(!!value)
                        }
                      >
                        {typeof column.columnDef.header === 'string'
                          ? column.columnDef.header
                          : column.id}
                      </DropdownMenuCheckboxItem>
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
        <Table variant={variant} className={tableClassName} aria-label={label}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {enableRowSelection && (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all rows"
                      checked={
                        table.getIsAllPageRowsSelected() ||
                        (table.getIsSomePageRowsSelected() && 'indeterminate')
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
                        variant="ghost"
                        size="sm"
                        className="-ml-2 h-8 rounded-sm px-2 font-medium hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
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
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {enablePagination && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            Rows per page
            <select
              className="rounded-md border border-input bg-background p-1 text-foreground"
              value={table.getState().pagination.pageSize}
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
              Page {table.getState().pagination.pageIndex + 1} of{' '}
              {Math.max(1, table.getPageCount())}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
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
