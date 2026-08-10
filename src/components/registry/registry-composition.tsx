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
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  PanelRightClose,
  Pin,
  PinOff,
  Search,
  X,
} from 'lucide-react'

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
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
import {
  createRegistrySavedViewStore,
  DEFAULT_REGISTRY_QUERY,
  formatRegistryValue,
  sanitizeRegistryView,
} from '#/lib/registry'
import type {
  RegistryDensity,
  RegistryQuery,
  RegistrySavedView,
  RegistrySavedViewStore,
  RegistryValueFormat,
} from '#/lib/registry'
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

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    /** Sheetbase-owned rendering contract for registry values. */
    registryFormat?: RegistryValueFormat
  }
}

export interface RegistryCompositionProps<TData> {
  registryId: string
  workspaceId: string
  userId: string
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
  initialDensity?: RegistryDensity
  savedViewStore?: RegistrySavedViewStore
  actions?: React.ReactNode
  /** Hide the built-in title/description header when the route supplies its own. */
  hideHeader?: boolean
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
    if (typeof window === 'undefined' || !window.matchMedia) return
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

function viewId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `view-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function activeFilter(query: RegistryQuery, id: string): string {
  return query.filters.find((filter) => filter.id === id)?.value ?? ''
}

export function RegistryComposition<TData>({
  registryId,
  workspaceId,
  userId,
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
  initialDensity = 'compact',
  savedViewStore,
  actions,
  hideHeader = false,
}: RegistryCompositionProps<TData>) {
  const compositionRef = React.useRef<HTMLElement>(null)
  const store = React.useMemo(
    () =>
      savedViewStore ??
      createRegistrySavedViewStore({ registryId, workspaceId, userId }),
    [registryId, savedViewStore, userId, workspaceId],
  )
  const [savedViews, setSavedViews] = React.useState<RegistrySavedView[]>([])
  const [selectedViewId, setSelectedViewId] = React.useState('')
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(initialColumnVisibility)
  const [density, setDensity] = React.useState<RegistryDensity>(initialDensity)
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
    setSavedViews(store.list())
    setSelectedViewId('')
  }, [store])

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

  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
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

  const viewPolicy = React.useMemo(
    () => ({
      sortColumnIds: table
        .getAllLeafColumns()
        .filter((column) => column.getCanSort())
        .map((column) => column.id),
      visibilityColumnIds: table
        .getAllLeafColumns()
        .filter((column) => column.getCanHide())
        .map((column) => column.id),
      filterIds: filterDefinitions.map((filter) => filter.id),
      groupingIds: groupingOptions.map((group) => group.id),
      pageSizes: [25, 50, 100],
      fallbackPageSize: [25, 50, 100].includes(query.pageSize)
        ? query.pageSize
        : DEFAULT_REGISTRY_QUERY.pageSize,
    }),
    [filterDefinitions, groupingOptions, query.pageSize, table],
  )

  const pageCount = Math.max(1, Math.ceil(totalCount / query.pageSize))
  const selectedRow = selectedId
    ? (rows.find((row) => getRowId(row) === selectedId) ??
      (selectedRecord && getRowId(selectedRecord) === selectedId
        ? selectedRecord
        : null))
    : null
  const hasFilters = query.filters.some((filter) => filter.value !== '')
  const searchFilter = filterDefinitions.find(
    (filter) => filter.id === 'search' || filter.id === 'q',
  )
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

  function setFilter(id: string, value: string) {
    const filters = query.filters.filter((filter) => filter.id !== id)
    if (value) filters.push({ id, value })
    onQueryChange({ ...query, pageIndex: 0, filters })
  }

  function setGrouping(id: string) {
    onQueryChange({
      ...query,
      pageIndex: 0,
      grouping: id ? [id] : [],
    })
  }

  function saveView() {
    const name = window.prompt('Save current view as…')?.trim()
    if (!name) return
    store.save({
      id: viewId(),
      name,
      state: { query, columnVisibility, density },
    })
    setSavedViews(store.list())
  }

  function applyView(id: string) {
    setSelectedViewId(id)
    const view = savedViews.find((candidate) => candidate.id === id)
    if (!view) return
    const safeView = sanitizeRegistryView(view, viewPolicy)
    onQueryChange(safeView.state.query)
    setColumnVisibility(safeView.state.columnVisibility)
    setDensity(safeView.state.density)
  }

  function focusRow(index: number) {
    const row = rows[index]
    if (!row) return
    const id = getRowId(row)
    setActiveRowId(id)
    const elements = compositionRef.current?.querySelectorAll<HTMLElement>(
      '[data-registry-row-id]',
    )
    if (elements && index < elements.length) elements[index].focus()
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
  ) : totalCount === 0 ? (
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
      <Table aria-label={title} data-density={density}>
        <TableHeader>
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
                    className={
                      density === 'compact'
                        ? 'h-7 whitespace-nowrap px-2.5 text-[0.65rem]'
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
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row, index) => {
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
                      className={cn(
                        'flex w-full items-center gap-1.5 font-semibold',
                        density === 'compact'
                          ? 'h-8 px-2.5 text-xs'
                          : 'h-10 px-3 text-sm',
                      )}
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
                        ({row.subRows.length})
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
                    focusRow(Math.min(index + 1, rows.length - 1))
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    focusRow(Math.max(index - 1, 0))
                  } else if (event.key === 'Home') {
                    event.preventDefault()
                    focusRow(0)
                  } else if (event.key === 'End') {
                    event.preventDefault()
                    focusRow(rows.length - 1)
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
                      density === 'compact'
                        ? 'whitespace-nowrap px-2.5 py-1 text-xs'
                        : 'px-3 py-2',
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
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2">
          {summaries.map((summary) => (
            <div
              key={summary.label}
              className="rounded-md border bg-card px-3 py-2.5"
            >
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
          {/* Search — prominent standalone input */}
          {searchFilter ? (
            <div className="relative min-w-48 flex-1 sm:max-w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search"
                value={activeFilter(query, searchFilter.id)}
                onChange={(event) =>
                  setFilter(searchFilter.id, event.target.value)
                }
                placeholder={searchFilter.placeholder ?? 'Search…'}
                className="h-8 pl-8 text-sm"
              />
            </div>
          ) : null}

          {/* Filter pills — compact dropdown buttons for option-based filters */}
          {filterDefinitions
            .filter((filter) => filter !== searchFilter && filter.options)
            .map((filter) => {
              const active = activeFilter(query, filter.id)
              return (
                <DropdownMenu key={filter.id}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={active ? 'subtle' : 'outline'}
                      size="sm"
                      className="h-8 gap-1.5"
                    >
                      {filter.label}
                      {active ? (
                        <span className="size-1.5 rounded-full bg-primary" />
                      ) : null}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>
                      Filter by {filter.label}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setFilter(filter.id, '')}>
                      All {filter.label.toLowerCase()}
                    </DropdownMenuItem>
                    {filter.options!.map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        onSelect={() => setFilter(filter.id, option.value)}
                      >
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            })}

          {/* Text filters — compact inputs for non-option, non-search filters */}
          {filterDefinitions
            .filter((filter) => filter !== searchFilter && !filter.options)
            .map((filter) => (
              <Input
                key={filter.id}
                aria-label={`Filter by ${filter.label}`}
                value={activeFilter(query, filter.id)}
                onChange={(event) => setFilter(filter.id, event.target.value)}
                placeholder={filter.placeholder ?? filter.label}
                className="h-8 w-32 text-sm"
              />
            ))}

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
              Clear
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
                    {option.label}
                  </option>
                ))}
              </Select>
            ) : null}

            {/* Density */}
            <Select
              aria-label="Table density"
              value={density}
              onChange={(event) =>
                setDensity(event.target.value as RegistryDensity)
              }
              className="h-8 w-auto text-xs"
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </Select>

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

            {/* Saved views */}
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={saveView}
              aria-label="Save current view"
            >
              Save view
            </Button>
            {savedViews.length > 0 ? (
              <Select
                aria-label="Saved views"
                value={selectedViewId}
                onChange={(event) => applyView(event.target.value)}
                className="h-8 w-auto text-xs"
              >
                <option value="">Current view</option>
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Table + pinned inspector layout */}
      <div className="flex min-h-0 flex-1 min-w-0 gap-4">
        {/* Table — always takes full width. Inspector slides over or pins. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-card">
          <div className="min-h-0 flex-1 overflow-auto">{stateContent}</div>
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
          </span>
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
