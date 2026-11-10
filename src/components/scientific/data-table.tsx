import { t } from '#/copy'
import * as React from 'react'
import { flexRender, useTable } from '@tanstack/react-table'
import type {
  ColumnDef,
  ColumnVisibilityState,
  RowData,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'
import { Icon } from '#/components/icons'

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
  DropdownMenuItem,
} from '#/components/ui/dropdown-menu'
import { cn } from '#/lib/utils'

import { dataTableFeatures } from './data-table-features'
import type { DataTableFeatures } from './data-table-features'

export type {
  DataTableColumnMeta,
  DataTableFeatures,
} from './data-table-features'

interface DataTableProps<TData extends RowData> {
  /** Column defs for this table. v9 types a column's value per column, so the
   * defs are `ColumnDef<DataTableFeatures, TData, unknown>` — the shape
   * `useTable` itself takes — and annotate with `DataTableFeatures`. */
  columns: ColumnDef<DataTableFeatures, TData, unknown>[]
  data: TData[]
  enableSorting?: boolean
  enableRowSelection?: boolean
  /** Told which rows are chosen whenever the choice (or the data) changes. */
  onSelectionChange?: (rows: TData[]) => void
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
  onSelectionChange,
  onRowClick,
  toolbar,
  className,
  tableClassName,
  label,
  enablePagination = false,
  enableColumnVisibility = false,
  initialColumnVisibility = {},
  variant = 'default',
  emptyMessage = t('notebook.dataTable.noResults'),
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

  // Tell the host which rows are chosen, but only when the choice itself
  // changed: a host that keeps the rows in state would otherwise loop on a
  // fresh array every render.
  const lastSelected = React.useRef<TData[]>([])
  React.useEffect(() => {
    if (!onSelectionChange) return

    const chosen = getRowId
      ? data.filter((row) => getRowId(row) in rowSelection)
      : data.filter((_, index) => String(index) in rowSelection)

    const before = lastSelected.current

    if (
      chosen.length === before.length &&
      chosen.every((row, index) => row === before[index])
    )
      return
    lastSelected.current = chosen
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- The chosen rows are derived from the table's own selection and the host owns the bulk actions; notifying it is the only way it learns which rows the reader ticked, and there is no render-time channel for it.
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent -- Selection is live table state, so the host must be told whenever it settles rather than on a snapshot taken at the click.
    // react-doctor-disable-next-line react-doctor/no-prop-callback-in-effect -- The callback is the host's selection store, not a mirror of a prop; the ref guard above keeps it from looping.
    onSelectionChange(chosen)
  }, [rowSelection, data, getRowId, onSelectionChange])

  // v9's `useTable` returns a new object whenever table state changes, so the
  // reset must not depend on the table instance: an effect that did would
  // re-run on every render and pin the page at 1. `setPageIndex` is an own
  // property of the table instance, so its identity is stable across renders.
  const { setPageIndex } = table
  React.useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- New rows make the old page number meaningless; `autoResetPageIndex` would also reset on every sort, which this table deliberately preserves.
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
                  {t('notebook.dataTable.columns')}
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
                        {/* oxlint-disable-next-line anti-slop/no-runtime-typeof -- TanStack types a column header as a string or a renderer; this menu shows the string form and names the column when it is not one. */}
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
                      aria-label={t('notebook.dataTable.ariaLabel')}
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
                          <Icon name="arrowUp" className="size-3.5" />
                        ) : header.column.getIsSorted() === 'desc' ? (
                          <Icon name="arrowDown" className="size-3.5" />
                        ) : (
                          <Icon name="arrowUpDown" className="size-3.5" />
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
                        aria-label={t('notebook.dataTable.selectRowAriaLabel')}
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
            {t('notebook.dataTable.rowsPerPage')}
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
              {t('notebook.dataTable.pagePageindexOfMax', {
                pageIndex: table.state.pagination.pageIndex + 1,
                max: Math.max(1, table.getPageCount()),
              })}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              {t('common.actions.previous')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              {t('common.actions.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export { DataTable, type DataTableProps }
