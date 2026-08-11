import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type {
  ColumnDef,
  ColumnFiltersState,
  ExpandedState,
  SortingState,
  Updater,
  VisibilityState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  PanelRightClose,
  Pin,
  PinOff,
  X,
} from 'lucide-react'

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Select,
  Sheet,
  SheetContent,
  SheetTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { formatCount } from '#/lib/format-numbers'
import { Filters } from '#/components/reui/filters'
import type { Filter as ReuiFilter } from '#/components/reui/filters'
import { DEFAULT_REGISTRY_QUERY, formatRegistryValue } from '#/lib/registry'
import type { RegistryQuery, RegistryValueFormat } from '#/lib/registry'
import { cn } from '#/lib/utils'

export interface RegistrySummary {
  label: string
  value: React.ReactNode
  hint?: string
  /** Semantic tone for the hint text. */
  tone?: 'positive' | 'warning' | 'danger' | 'neutral'
}

export interface RegistryFilterDefinition {
  id: string
  label: string
  placeholder?: string
  options?: { value: string; label: string }[]
}

export interface RegistryGroupingOption {
  id: string
  label: string
}

export interface RegistryIncrementalRows {
  /** Whether the server reports that more matching rows can be loaded. */
  hasMore: boolean
  /** Whether the next batch is currently being fetched. */
  loadingMore: boolean
  /** Append the next server-owned batch to the loaded rows. */
  onLoadMore: () => void
  /** A failed append must not replace rows that are already available. */
  loadError?: unknown
}

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    /** Sheetbase-owned rendering contract for registry values. */
    registryFormat?: RegistryValueFormat
  }
}

export interface RegistryCompositionProps<TData> {
  registryId: string
  title: string
  description?: string
  rows: TData[]
  /** Authoritative server total, never inferred from the current page. */
  totalCount: number
  columns: ColumnDef<TData, unknown>[]
  query: RegistryQuery
  onQueryChange: (query: RegistryQuery) => void
  getRowId: (row: TData) => string
  selectedId: string | null
  /** A selected record loaded independently of the current server page. */
  selectedRecord?: TData | null
  onSelectedIdChange: (id: string | null) => void
  summaries?: RegistrySummary[]
  filterDefinitions?: RegistryFilterDefinition[]
  groupingOptions?: RegistryGroupingOption[]
  renderInspector?: (row: TData | null) => React.ReactNode
  /** Generic accessible label for the responsive inspector trigger and plane. */
  inspectorLabel?: string
  /** Controlled narrow-screen inspector state. Omit with its callback for local state. */
  inspectorOpen?: boolean
  onInspectorOpenChange?: (open: boolean) => void
  loading?: boolean
  error?: unknown
  permissionDenied?: boolean
  partialData?: boolean
  onRetry?: () => void
  emptyTitle?: string
  noResultsTitle?: string
  initialColumnVisibility?: VisibilityState
  actions?: React.ReactNode
  /** Hide the built-in title/description header when the route supplies its own. */
  hideHeader?: boolean
  /** Opt into virtualised, incrementally loaded rows instead of page controls. */
  incrementalRows?: RegistryIncrementalRows
  /** Allow users to drag column boundaries in wide data grids. */
  resizableColumns?: boolean
  /** Debounce server-owned text search. Defaults to immediate updates. */
  searchDebounceMs?: number
}

function resolveUpdater<T>(updater: Updater<T>, previous: T): T {
  return typeof updater === 'function'
    ? (updater as (old: T) => T)(previous)
    : updater
}

/** Detect the xl breakpoint (1280px+) for inspector pin behaviour. */
function useIsXl(): boolean {
  const [isXl, setIsXl] = React.useState(false)
  React.useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    )
      return
    const mq = window.matchMedia('(min-width: 1280px)')
    setIsXl(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsXl(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isXl
}

const PIN_KEY = (registryId: string) =>
  `sheetbase-inspector-pinned-${registryId}`

function RegistryFilters({
  definitions,
  query,
  onQueryChange,
  debounceMs,
}: {
  definitions: RegistryFilterDefinition[]
  query: RegistryQuery
  onQueryChange: (query: RegistryQuery) => void
  debounceMs: number
}) {
  const fromQuery = React.useCallback(
    (): ReuiFilter<string>[] =>
      query.filters.map((filter) => ({
        id: filter.id,
        field: filter.id,
        operator: 'is',
        values: [filter.value],
      })),
    [query.filters],
  )
  const [filters, setFilters] = React.useState(fromQuery)
  const timeoutRef = React.useRef<number | undefined>(undefined)

  React.useEffect(() => setFilters(fromQuery()), [fromQuery])
  React.useEffect(() => () => window.clearTimeout(timeoutRef.current), [])

  function emit(next: ReuiFilter<string>[]) {
    const routeFilters = next
      .filter((filter) => filter.values[0])
      .map((filter) => ({ id: filter.field, value: filter.values[0] }))
    const unchanged =
      routeFilters.length === query.filters.length &&
      routeFilters.every(
        (filter, index) =>
          filter.id === query.filters[index]?.id &&
          filter.value === query.filters[index]?.value,
      )
    if (unchanged) return
    onQueryChange({ ...query, pageIndex: 0, filters: routeFilters })
  }

  function handleChange(next: ReuiFilter<string>[]) {
    const previous = filters
    setFilters(next)
    window.clearTimeout(timeoutRef.current)
    const changed = next.find(
      (filter) =>
        filter.values[0] !==
        previous.find((candidate) => candidate.id === filter.id)?.values[0],
    )
    const definition = definitions.find(
      (candidate) => candidate.id === changed?.field,
    )
    if (changed && !definition?.options && debounceMs > 0) {
      timeoutRef.current = window.setTimeout(() => emit(next), debounceMs)
    } else {
      emit(next)
    }
  }

  return (
    <Filters
      filters={filters}
      fields={definitions.map((definition) => ({
        key: definition.id,
        label: definition.label,
        placeholder: definition.placeholder,
        type: definition.options ? ('select' as const) : ('text' as const),
        options: definition.options,
        operators: [{ value: 'is', label: 'is' }],
        defaultOperator: 'is',
      }))}
      onChange={handleChange}
      allowMultiple={false}
      size="sm"
      i18n={{ addFilter: 'Add filter' }}
    />
  )
}

export function RegistryComposition<TData>({
  registryId,
  title,
  description,
  rows,
  totalCount,
  columns,
  query,
  onQueryChange,
  getRowId,
  selectedId,
  selectedRecord,
  onSelectedIdChange,
  summaries = [],
  filterDefinitions = [],
  groupingOptions = [],
  renderInspector,
  inspectorLabel = 'Inspector',
  inspectorOpen: controlledInspectorOpen,
  onInspectorOpenChange,
  loading = false,
  error = null,
  permissionDenied = false,
  partialData = false,
  onRetry,
  emptyTitle = 'No records yet',
  noResultsTitle = 'No matching records',
  initialColumnVisibility = {},
  actions,
  hideHeader = false,
  incrementalRows,
  resizableColumns = false,
  searchDebounceMs = 0,
}: RegistryCompositionProps<TData>) {
  const compositionRef = React.useRef<HTMLElement>(null)
  const scrollViewportRef = React.useRef<HTMLDivElement>(null)
  const lastRequestedRowCountRef = React.useRef(-1)
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(initialColumnVisibility)
  const [uncontrolledInspectorOpen, setUncontrolledInspectorOpen] =
    React.useState(false)
  const [inspectorPinned, setInspectorPinned] = React.useState(false)
  const isXl = useIsXl()
  const [activeRowId, setActiveRowId] = React.useState<string | null>(
    selectedId ?? (rows[0] ? getRowId(rows[0]) : null),
  )

  React.useEffect(() => {
    try {
      setInspectorPinned(localStorage.getItem(PIN_KEY(registryId)) === '1')
    } catch {
      /* ignore */
    }
  }, [registryId])

  const togglePin = React.useCallback(() => {
    const next = !inspectorPinned
    try {
      localStorage.setItem(PIN_KEY(registryId), next ? '1' : '0')
    } catch {
      /* ignore */
    }
    setInspectorPinned(next)
  }, [inspectorPinned, registryId])

  React.useEffect(() => {
    if (selectedId && rows.some((row) => getRowId(row) === selectedId)) {
      setActiveRowId(selectedId)
      return
    }
    if (!activeRowId || !rows.some((row) => getRowId(row) === activeRowId)) {
      setActiveRowId(rows[0] ? getRowId(rows[0]) : null)
    }
  }, [activeRowId, getRowId, rows, selectedId])

  // Auto-open the inspector when a selection arrives (from row click, URL, etc.)
  React.useEffect(() => {
    if (selectedId) setInspectorOpen(true)
  }, [selectedId])

  const sorting = query.sorting as SortingState
  const grouping = query.grouping
  const [expanded, setExpanded] = React.useState<ExpandedState>(
    grouping.length > 0 ? true : {},
  )
  const columnFilters: ColumnFiltersState = query.filters
  const groupingKey = grouping.join('\u0000')

  React.useEffect(() => {
    setExpanded(groupingKey ? true : {})
  }, [groupingKey])

  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    autoResetExpanded: false,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableColumnResizing: resizableColumns,
    columnResizeMode: 'onChange',
    rowCount: totalCount,
    state: {
      pagination: { pageIndex: query.pageIndex, pageSize: query.pageSize },
      sorting,
      grouping,
      expanded,
      columnFilters,
      columnVisibility,
    },
    onPaginationChange(updater) {
      const next = resolveUpdater(updater, {
        pageIndex: query.pageIndex,
        pageSize: query.pageSize,
      })
      onQueryChange({ ...query, ...next })
    },
    onSortingChange(updater) {
      onQueryChange({
        ...query,
        pageIndex: 0,
        sorting: resolveUpdater(updater, sorting),
      })
    },
    onGroupingChange(updater) {
      onQueryChange({
        ...query,
        pageIndex: 0,
        grouping: resolveUpdater(updater, grouping),
      })
      setExpanded(true)
    },
    onExpandedChange: setExpanded,
    onColumnFiltersChange(updater) {
      const next = resolveUpdater(updater, columnFilters)
      onQueryChange({
        ...query,
        pageIndex: 0,
        filters: next.map((filter) => ({
          id: filter.id,
          value: String(filter.value ?? ''),
        })),
      })
    },
    onColumnVisibilityChange: setColumnVisibility,
  })

  const displayRows = table.getRowModel().rows
  const navigableRows = displayRows.filter((row) => !row.getIsGrouped())
  const rowVirtualizer = useVirtualizer({
    count: incrementalRows ? displayRows.length : 0,
    getScrollElement: () => scrollViewportRef.current,
    estimateSize: () => 29,
    overscan: 10,
  })
  const virtualItems = rowVirtualizer.getVirtualItems()
  const incrementalEnabled = incrementalRows !== undefined
  const queryGeneration = JSON.stringify({
    pageSize: query.pageSize,
    sorting: query.sorting,
    grouping: query.grouping,
    filters: query.filters,
  })

  React.useEffect(() => {
    if (!incrementalEnabled) return
    lastRequestedRowCountRef.current = -1
    if (scrollViewportRef.current) scrollViewportRef.current.scrollTop = 0
  }, [incrementalEnabled, queryGeneration])

  React.useEffect(() => {
    if (
      !incrementalRows?.hasMore ||
      incrementalRows.loadingMore ||
      displayRows.length === 0 ||
      (grouping.length > 0 && expanded !== true)
    ) {
      return
    }
    const lastVisible = virtualItems.at(-1)
    if (
      lastVisible &&
      lastVisible.index >= displayRows.length - 10 &&
      lastRequestedRowCountRef.current !== rows.length
    ) {
      lastRequestedRowCountRef.current = rows.length
      incrementalRows.onLoadMore()
    }
  }, [
    displayRows.length,
    expanded,
    grouping.length,
    incrementalRows,
    rows.length,
    virtualItems,
  ])

  const pageCount = Math.max(1, Math.ceil(totalCount / query.pageSize))
  const selectedRow = selectedId
    ? (rows.find((row) => getRowId(row) === selectedId) ??
      (selectedRecord && getRowId(selectedRecord) === selectedId
        ? selectedRecord
        : null))
    : null
  const hasFilters = query.filters.some((filter) => filter.value !== '')
  const inspectorOpen = controlledInspectorOpen ?? uncontrolledInspectorOpen
  const setInspectorOpen = React.useCallback(
    (open: boolean) => {
      if (controlledInspectorOpen === undefined) {
        setUncontrolledInspectorOpen(open)
      }
      onInspectorOpenChange?.(open)
      if (!open) {
        onSelectedIdChange(null)
      }
    },
    [controlledInspectorOpen, onInspectorOpenChange, onSelectedIdChange],
  )

  const inspectorContent = renderInspector ? (
    selectedId && !selectedRow ? (
      <RegistryState
        title="Selected record is outside this page"
        detail="Its selection is preserved while the record details are loaded."
      />
    ) : (
      <div className="flex h-full flex-col">
        {/* Inspector controls: pin + close */}
        <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border px-2 py-1">
          {isXl ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={togglePin}
              aria-label={inspectorPinned ? 'Unpin inspector' : 'Pin inspector'}
              aria-pressed={inspectorPinned}
            >
              {inspectorPinned ? (
                <PinOff className="size-4" />
              ) : (
                <Pin className="size-4" />
              )}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setInspectorOpen(false)
              onSelectedIdChange(null)
            }}
            aria-label="Close inspector"
          >
            <PanelRightClose className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {renderInspector(selectedRow)}
        </div>
      </div>
    )
  ) : null

  function setGrouping(id: string) {
    onQueryChange({
      ...query,
      pageIndex: 0,
      grouping: id ? [id] : [],
    })
  }

  function focusRow(index: number) {
    const row = navigableRows[index]
    const id = getRowId(row.original)
    setActiveRowId(id)

    const focusMountedRow = () => {
      const elements = compositionRef.current?.querySelectorAll<HTMLElement>(
        '[data-registry-row-id]',
      )
      Array.from(elements ?? [])
        .find((element) => element.dataset.registryRowId === id)
        ?.focus()
    }

    if (!incrementalRows) {
      focusMountedRow()
      return
    }

    const displayIndex = displayRows.indexOf(row)
    rowVirtualizer.scrollToIndex(displayIndex, { align: 'auto' })
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(focusMountedRow),
    )
  }

  const stateContent = permissionDenied ? (
    <RegistryState
      title="Permission denied"
      detail="You do not have access to this registry."
    />
  ) : loading ? (
    <RegistryLoading title={title} columns={Math.max(columns.length, 1)} />
  ) : error ? (
    <RegistryState
      title="Could not load records"
      detail="The registry request failed."
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null
      }
      alert
    />
  ) : totalCount === 0 && rows.length === 0 ? (
    <RegistryState
      title={hasFilters ? noResultsTitle : emptyTitle}
      detail={
        hasFilters
          ? 'Change or clear the filters to broaden the server query.'
          : 'Records will appear here when they are available.'
      }
    />
  ) : (
    <>
      {partialData ? (
        <div
          role="status"
          className="border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground"
        >
          <span className="font-semibold">Partial data.</span> Some rows or
          fields could not be returned; totals describe the server result.
        </div>
      ) : null}
      <Table
        aria-label={title}
        data-density="compact"
        containerClassName={incrementalRows ? 'overflow-visible' : undefined}
        style={resizableColumns ? { width: table.getTotalSize() } : undefined}
      >
        <TableHeader
          className={incrementalRows ? 'sticky top-0 z-10 bg-card' : undefined}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
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
                      'h-7 whitespace-nowrap px-2.5 text-[0.65rem]',
                    )}
                    style={
                      resizableColumns ? { width: header.getSize() } : undefined
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
                        className="inline-flex items-center gap-0.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={`Sort by ${label} ${sorted === 'asc' ? 'descending' : 'ascending'}`}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {sorted ? (
                          <span aria-hidden className="text-muted-foreground">
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
                        aria-valuemin={header.column.columnDef.minSize ?? 20}
                        aria-valuemax={header.column.columnDef.maxSize ?? 1000}
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
                          ) {
                            return
                          }
                          event.preventDefault()
                          const delta = event.key === 'ArrowRight' ? 10 : -10
                          const min = header.column.columnDef.minSize ?? 20
                          const max = header.column.columnDef.maxSize ?? 1000
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
              const groupVal = row.getValue(row.groupingColumnId!)
              return (
                <TableRow
                  key={row.id}
                  className="border-b border-border bg-muted/40 hover:bg-muted/60"
                >
                  <TableCell
                    colSpan={row.getVisibleCells().length}
                    className="p-0"
                  >
                    <button
                      type="button"
                      className="flex h-8 w-full items-center gap-1.5 px-2.5 text-xs font-semibold"
                      onClick={() => row.getToggleExpandedHandler()()}
                      aria-label={`Toggle group`}
                    >
                      {row.getIsExpanded() ? (
                        <ChevronDown className="size-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0" />
                      )}
                      {String(groupVal ?? '—')}
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
            // Aggregated placeholder rows — skip them.
            if (row.depth > 0 && !row.original) return null
            const id = getRowId(row.original)
            const selected = id === selectedId
            const navigableIndex = navigableRows.indexOf(row)
            return (
              <TableRow
                key={id}
                data-registry-row-id={id}
                data-state={selected ? 'selected' : undefined}
                aria-selected={selected}
                tabIndex={id === activeRowId ? 0 : -1}
                className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onFocus={() => setActiveRowId(id)}
                onClick={() => {
                  onSelectedIdChange(id)
                  setInspectorOpen(true)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    if (
                      navigableIndex === navigableRows.length - 1 &&
                      incrementalRows?.hasMore
                    ) {
                      incrementalRows.onLoadMore()
                    } else {
                      focusRow(
                        Math.min(navigableIndex + 1, navigableRows.length - 1),
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
                    onSelectedIdChange(id)
                    setInspectorOpen(true)
                  }
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      'whitespace-nowrap px-2.5 py-1 text-xs',
                      typeof cell.getValue() === 'number' &&
                        'scientific-nums text-right tabular-nums',
                    )}
                  >
                    {cell.column.columnDef.meta?.registryFormat
                      ? formatRegistryValue(
                          cell.getValue(),
                          cell.column.columnDef.meta.registryFormat,
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
  )

  return (
    <section
      ref={compositionRef}
      aria-labelledby={`${registryId}-title`}
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      {!hideHeader ? (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1
              id={`${registryId}-title`}
              className="text-xl font-semibold tracking-tight"
            >
              {title}
            </h1>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {permissionDenied ? null : actions}
        </header>
      ) : null}

      {!permissionDenied && summaries.length > 0 ? (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] divide-x overflow-hidden rounded-md border bg-card">
          {summaries.map((summary) => (
            <div key={summary.label} className="min-w-0 px-3 py-2">
              <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                {summary.label}
              </dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums leading-tight">
                {summary.value}
              </dd>
              {summary.hint ? (
                <dd
                  className={cn(
                    'mt-0.5 text-xs font-medium',
                    summary.tone === 'positive' && 'text-emerald-600',
                    summary.tone === 'warning' && 'text-amber-600',
                    summary.tone === 'danger' && 'text-red-600',
                    (!summary.tone || summary.tone === 'neutral') &&
                      'text-muted-foreground',
                  )}
                >
                  {summary.hint}
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      ) : null}

      {!permissionDenied ? (
        <div className="flex flex-wrap items-center gap-2">
          {filterDefinitions.length > 0 ? (
            <RegistryFilters
              definitions={filterDefinitions}
              query={query}
              onQueryChange={onQueryChange}
              debounceMs={searchDebounceMs}
            />
          ) : null}

          {/* Clear filters */}
          {query.filters.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={() =>
                onQueryChange({ ...query, filters: [], pageIndex: 0 })
              }
            >
              <X className="size-3.5" />
              Clear all
            </Button>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            {/* Group */}
            {groupingOptions.length > 0 ? (
              <Select
                aria-label="Group rows"
                value={query.grouping[0] ?? ''}
                onChange={(event) => setGrouping(event.target.value)}
                className="h-8 w-auto text-xs"
              >
                <option value="">No grouping</option>
                {groupingOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    Group: {option.label}
                  </option>
                ))}
              </Select>
            ) : null}

            {/* Columns */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  aria-label="Choose visible columns"
                >
                  <Columns3 className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                {table.getAllLeafColumns().map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    disabled={!column.getCanHide()}
                    onCheckedChange={(checked) =>
                      column.toggleVisibility(Boolean(checked))
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
        </div>
      ) : null}

      {/* Table + pinned inspector layout */}
      <div className="flex min-h-0 flex-1 min-w-0 gap-4">
        {/* Table — always takes full width. Inspector slides over or pins. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-card">
          <div
            ref={scrollViewportRef}
            data-registry-scroll-viewport=""
            className="min-h-0 flex-1 overflow-auto"
          >
            {stateContent}
          </div>
        </div>

        {/* Pinned inspector — docked aside on xl+ only */}
        {renderInspector &&
        !permissionDenied &&
        inspectorPinned &&
        inspectorOpen &&
        isXl ? (
          <aside
            aria-label={inspectorLabel}
            className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border bg-background"
          >
            {inspectorContent}
          </aside>
        ) : null}
      </div>

      {/* Slide-over inspector — Sheet on all breakpoints when not pinned,
          or below xl when pinned */}
      {renderInspector && !permissionDenied ? (
        <Sheet
          open={inspectorOpen && (!inspectorPinned || !isXl)}
          onOpenChange={setInspectorOpen}
        >
          <SheetContent
            side="right"
            className="w-[min(24rem,92vw)] border-l p-0"
            showClose={false}
          >
            <SheetTitle className="sr-only">{inspectorLabel}</SheetTitle>
            <div className="h-full">{inspectorContent}</div>
          </SheetContent>
        </Sheet>
      ) : null}

      {!permissionDenied ? (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 py-1.5 text-xs text-muted-foreground">
          <span className="leading-5">
            {formatCount(totalCount)} {totalCount === 1 ? 'record' : 'records'}
            {incrementalRows && rows.length < totalCount
              ? ` · ${formatCount(rows.length)} loaded`
              : ''}
            {query.grouping.length > 0 &&
            (incrementalRows?.hasMore || (!incrementalRows && pageCount > 1))
              ? incrementalRows
                ? ' · group counts describe loaded rows'
                : ' · groups continue across pages'
              : ''}
          </span>
          {incrementalRows ? (
            <div className="flex items-center gap-2">
              <span aria-live="polite">
                {incrementalRows.loadError
                  ? 'Could not load more records'
                  : incrementalRows.loadingMore
                    ? 'Loading more records…'
                    : incrementalRows.hasMore
                      ? 'Scroll for more'
                      : 'All records loaded'}
              </span>
              {incrementalRows.hasMore ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={incrementalRows.loadingMore}
                  onClick={incrementalRows.onLoadMore}
                >
                  {incrementalRows.loadError ? 'Try again' : 'Load more'}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                Rows
                <Select
                  aria-label="Rows per page"
                  value={String(query.pageSize)}
                  onChange={(event) =>
                    onQueryChange({
                      ...query,
                      pageIndex: 0,
                      pageSize: Number(event.target.value),
                    })
                  }
                  className="h-8 w-20 bg-background text-xs"
                >
                  {[25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </Select>
              </label>
              <span>
                Page {query.pageIndex + 1} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous page"
                disabled={query.pageIndex === 0 || loading}
                onClick={() => table.previousPage()}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next page"
                disabled={query.pageIndex >= pageCount - 1 || loading}
                onClick={() => table.nextPage()}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </footer>
      ) : null}
    </section>
  )
}

function RegistryState({
  title,
  detail,
  action,
  alert = false,
}: {
  title: string
  detail: string
  action?: React.ReactNode
  alert?: boolean
}) {
  return (
    <div
      className="flex min-h-56 flex-col items-center justify-center gap-2 p-8 text-center"
      role={alert ? 'alert' : undefined}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{detail}</p>
      {action}
    </div>
  )
}

function RegistryLoading({
  title,
  columns,
}: {
  title: string
  columns: number
}) {
  return (
    <div aria-busy="true" aria-label={`Loading ${title}`}>
      <p className="sr-only">Loading {title}</p>
      {Array.from({ length: 6 }).map((_, row) => (
        <div key={row} className="flex gap-4 border-b px-3 py-3 last:border-0">
          {Array.from({ length: columns }).map((__, column) => (
            <Skeleton key={column} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export { DEFAULT_REGISTRY_QUERY }
