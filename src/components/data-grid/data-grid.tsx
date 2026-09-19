import * as React from 'react'
import { flexRender } from '@tanstack/react-table'
import type { RowData } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight } from 'lucide-react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { formatDataGridValue } from '#/lib/data-grid'
import type { AppTable } from '#/lib/table-features'
import { cn } from '#/lib/utils'
import type { DataGridIncrementalRows } from './data-grid-types'

export interface DataGridProps<TData extends RowData> {
  table: AppTable<TData>
  title: string
  getRowId: (row: TData) => string
  selectedId: string | null
  onRowOpen: (id: string) => void
  /** Replaces the rows for loading, error, permission and empty states. */
  fallback?: React.ReactNode
  partialData?: boolean
  incrementalRows?: DataGridIncrementalRows
  resizableColumns?: boolean
  /** Resets virtual scroll when the server-owned query changes. */
  resetKey?: string
  /** Used only to qualify grouped counts rendered from one server page. */
  pageCount?: number
}

/** Dense, keyboard-accessible TanStack grid with optional virtual row loading. */
export function DataGrid<TData extends RowData>({
  table,
  title,
  getRowId,
  selectedId,
  onRowOpen,
  fallback,
  partialData = false,
  incrementalRows,
  resizableColumns = false,
  resetKey = '',
  pageCount = 1,
}: DataGridProps<TData>) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const lastRequestedRowCountRef = React.useRef(-1)
  const incrementalEnabled = incrementalRows !== undefined
  const displayRows = table.getRowModel().rows
  const navigableRows = displayRows.filter((row) => !row.getIsGrouped())
  const [activeRowId, setActiveRowId] = React.useState<string | null>(
    selectedId ??
      (navigableRows[0] ? getRowId(navigableRows[0].original) : null),
  )
  const rowVirtualizer = useVirtualizer({
    count: incrementalRows ? displayRows.length : 0,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 29,
    overscan: 10,
  })
  const virtualItems = rowVirtualizer.getVirtualItems()

  React.useEffect(() => {
    if (
      selectedId &&
      navigableRows.some((row) => getRowId(row.original) === selectedId)
    ) {
      setActiveRowId(selectedId)
      return
    }
    if (
      !activeRowId ||
      !navigableRows.some((row) => getRowId(row.original) === activeRowId)
    ) {
      setActiveRowId(
        navigableRows[0] ? getRowId(navigableRows[0].original) : null,
      )
    }
  }, [activeRowId, getRowId, navigableRows, selectedId])

  React.useEffect(() => {
    if (!incrementalEnabled) return
    lastRequestedRowCountRef.current = -1
    if (viewportRef.current) viewportRef.current.scrollTop = 0
  }, [incrementalEnabled, resetKey])

  const tableState = table.store.state
  const dataLength = table.options.data.length
  React.useEffect(() => {
    if (
      !incrementalRows?.hasMore ||
      incrementalRows.loadingMore ||
      displayRows.length === 0 ||
      (tableState.grouping.length > 0 && tableState.expanded !== true)
    ) {
      return
    }
    const lastVisible = virtualItems.at(-1)
    if (
      lastVisible &&
      lastVisible.index >= displayRows.length - 10 &&
      lastRequestedRowCountRef.current !== dataLength
    ) {
      lastRequestedRowCountRef.current = dataLength
      incrementalRows.onLoadMore()
    }
  }, [
    displayRows.length,
    incrementalRows,
    tableState,
    dataLength,
    virtualItems,
  ])

  function focusRow(index: number) {
    const row = navigableRows[index]
    const id = getRowId(row.original)
    setActiveRowId(id)
    const focusMountedRow = () =>
      Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>('[data-grid-row-id]') ??
          [],
      )
        .find((element) => element.dataset.gridRowId === id)
        ?.focus()

    if (!incrementalRows) {
      focusMountedRow()
      return
    }
    rowVirtualizer.scrollToIndex(displayRows.indexOf(row), { align: 'auto' })
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(focusMountedRow),
    )
  }

  return (
    <div
      ref={rootRef}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border"
    >
      <div
        ref={viewportRef}
        data-grid-scroll-viewport=""
        className="min-h-0 flex-1 overflow-auto"
      >
        {fallback !== undefined ? (
          fallback
        ) : (
          <>
            {partialData ? (
              <div
                role="status"
                className="border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground"
              >
                <span className="font-semibold">Partial data.</span> Some rows
                or fields could not be returned; totals describe the server
                result.
              </div>
            ) : null}
            <Table
              variant="quiet"
              aria-label={title}
              data-density="compact"
              containerClassName={
                incrementalRows ? 'overflow-visible' : undefined
              }
              style={
                resizableColumns
                  ? { width: table.getTotalSize(), minWidth: '100%' }
                  : undefined
              }
            >
              <TableHeader
                className={
                  incrementalRows
                    ? 'sticky top-0 z-10 bg-background'
                    : undefined
                }
              >
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    key={headerGroup.id}
                    className="hover:bg-transparent"
                  >
                    {headerGroup.headers.map((header) => {
                      const sorted = header.column.getIsSorted()
                      const label =
                        typeof header.column.columnDef.header === 'string'
                          ? header.column.columnDef.header
                          : header.column.id
                      return (
                        <TableHead
                          key={header.id}
                          className={cn(
                            resizableColumns && 'relative',
                            'whitespace-nowrap',
                            header.column.columnDef.meta?.dataGridFormat
                              ?.kind === 'scientific' && 'text-right',
                          )}
                          style={
                            resizableColumns
                              ? { width: header.getSize() }
                              : undefined
                          }
                          aria-sort={
                            sorted === 'asc'
                              ? 'ascending'
                              : sorted === 'desc'
                                ? 'descending'
                                : 'none'
                          }
                        >
                          {header.isPlaceholder ? null : header.column.getCanSort() ? (
                            <button
                              type="button"
                              className={cn(
                                'inline-flex items-center gap-0.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                header.column.columnDef.meta?.dataGridFormat
                                  ?.kind === 'scientific' &&
                                  'w-full justify-end text-right',
                              )}
                              onClick={header.column.getToggleSortingHandler()}
                              aria-label={`Sort by ${label} ${sorted === 'asc' ? 'descending' : 'ascending'}`}
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                              {sorted ? (
                                <span
                                  aria-hidden
                                  className="text-muted-foreground"
                                >
                                  {sorted === 'asc' ? '↑' : '↓'}
                                </span>
                              ) : null}
                            </button>
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )
                          )}
                          {resizableColumns && header.column.getCanResize() ? (
                            <div
                              role="separator"
                              tabIndex={0}
                              className="absolute inset-y-0 right-0 w-1 cursor-col-resize touch-none select-none bg-transparent hover:bg-primary/50 focus-visible:bg-primary focus-visible:outline-none"
                              aria-label={`Resize ${label} column`}
                              aria-orientation="vertical"
                              aria-valuemin={
                                header.column.columnDef.minSize ?? 20
                              }
                              aria-valuemax={
                                header.column.columnDef.maxSize ?? 1000
                              }
                              aria-valuenow={header.getSize()}
                              onDoubleClick={() => header.column.resetSize()}
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              onKeyDown={(event) => {
                                if (event.key === 'Home') {
                                  event.preventDefault()
                                  header.column.resetSize()
                                  return
                                }
                                if (
                                  event.key !== 'ArrowLeft' &&
                                  event.key !== 'ArrowRight'
                                )
                                  return
                                event.preventDefault()
                                const delta =
                                  event.key === 'ArrowRight' ? 10 : -10
                                const min =
                                  header.column.columnDef.minSize ?? 20
                                const max =
                                  header.column.columnDef.maxSize ?? 1000
                                table.setColumnSizing((previous) => ({
                                  ...previous,
                                  [header.column.id]: Math.min(
                                    max,
                                    Math.max(min, header.getSize() + delta),
                                  ),
                                }))
                              }}
                            />
                          ) : null}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {incrementalRows && virtualItems[0]?.start ? (
                  <TableRow
                    aria-hidden="true"
                    className="border-0 hover:bg-transparent"
                  >
                    <TableCell
                      colSpan={table.getVisibleLeafColumns().length}
                      className="border-0 p-0"
                      style={{ height: virtualItems[0].start }}
                    />
                  </TableRow>
                ) : null}
                {(incrementalRows
                  ? virtualItems.map((item) => displayRows[item.index])
                  : displayRows
                ).map((row) => {
                  if (row.getIsGrouped()) {
                    const groupValue = row.getValue(row.groupingColumnId!)
                    return (
                      <TableRow
                        key={row.id}
                        className="border-b border-border bg-muted/20 hover:bg-muted/40"
                      >
                        <TableCell
                          colSpan={row.getVisibleCells().length}
                          className="p-0 !py-0"
                        >
                          <button
                            type="button"
                            className="flex h-8 w-full items-center gap-1.5 px-3 text-xs font-medium"
                            onClick={() => row.getToggleExpandedHandler()()}
                            aria-label="Toggle group"
                          >
                            {row.getIsExpanded() ? (
                              <ChevronDown className="size-3.5 shrink-0" />
                            ) : (
                              <ChevronRight className="size-3.5 shrink-0" />
                            )}
                            {String(groupValue ?? '—')}
                            <span className="ml-0.5 text-muted-foreground">
                              ({row.subRows.length}
                              {incrementalRows
                                ? incrementalRows.hasMore
                                  ? ' loaded'
                                  : ''
                                : pageCount > 1
                                  ? ' on this page'
                                  : ''}
                              )
                            </span>
                          </button>
                        </TableCell>
                      </TableRow>
                    )
                  }
                  const id = getRowId(row.original)
                  const navigableIndex = navigableRows.indexOf(row)
                  return (
                    <TableRow
                      key={id}
                      data-grid-row-id={id}
                      data-state={id === selectedId ? 'selected' : undefined}
                      aria-selected={id === selectedId}
                      tabIndex={id === activeRowId ? 0 : -1}
                      className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onFocus={() => setActiveRowId(id)}
                      onClick={() => onRowOpen(id)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          if (
                            navigableIndex === navigableRows.length - 1 &&
                            incrementalRows?.hasMore &&
                            !incrementalRows.loadingMore
                          ) {
                            incrementalRows.onLoadMore()
                          } else {
                            focusRow(
                              Math.min(
                                navigableIndex + 1,
                                navigableRows.length - 1,
                              ),
                            )
                          }
                        } else if (event.key === 'ArrowUp') {
                          event.preventDefault()
                          focusRow(Math.max(navigableIndex - 1, 0))
                        } else if (event.key === 'Home') {
                          event.preventDefault()
                          focusRow(0)
                        } else if (event.key === 'End') {
                          event.preventDefault()
                          focusRow(navigableRows.length - 1)
                        } else if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onRowOpen(id)
                        }
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            'whitespace-nowrap text-xs',
                            typeof cell.getValue() === 'number' &&
                              'scientific-nums text-right tabular-nums',
                          )}
                        >
                          {cell.column.columnDef.meta?.dataGridFormat
                            ? formatDataGridValue(
                                cell.getValue(),
                                cell.column.columnDef.meta.dataGridFormat,
                              )
                            : flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                              )}
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                })}
                {incrementalRows && virtualItems.length > 0 ? (
                  <TableRow
                    aria-hidden="true"
                    className="border-0 hover:bg-transparent"
                  >
                    <TableCell
                      colSpan={table.getVisibleLeafColumns().length}
                      className="border-0 p-0"
                      style={{
                        height: Math.max(
                          0,
                          rowVirtualizer.getTotalSize() -
                            virtualItems[virtualItems.length - 1].end,
                        ),
                      }}
                    />
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </>
        )}
      </div>
    </div>
  )
}
