import * as React from 'react'
import {
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type {
  ColumnFiltersState,
  ExpandedState,
  SortingState,
  Updater,
  VisibilityState,
} from '@tanstack/react-table'
import {
  ChevronLeft,
  ChevronRight,
  PanelRightClose,
  Pin,
  PinOff,
} from 'lucide-react'

import {
  Button,
  Input,
  Select,
  Sheet,
  SheetContent,
  SheetTitle,
  Skeleton,
  StatStrip,
} from '#/components/ui'
import { formatCount } from '#/lib/format-numbers'
import { DEFAULT_REGISTRY_QUERY } from '#/lib/registry'
import type { RegistryQuery, RegistryScalar } from '#/lib/registry'
import type {
  DataGridField,
  DataGridIncrementalRows,
} from '#/components/data-grid/data-grid-types'
import { DataGridFilters } from '#/components/data-grid/data-grid-filters'
import { DataGridGrouping } from '#/components/data-grid/data-grid-grouping'
import { DataGridColumnSelector } from '#/components/data-grid/data-grid-column-selector'
import { DataGrid } from '#/components/data-grid/data-grid'

export interface RegistrySummary {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: 'positive' | 'warning' | 'danger' | 'neutral'
}

export interface RegistryCompositionProps<TData> {
  registryId: string
  title: string
  description?: string
  rows: TData[]
  /** Authoritative server total, never inferred from the current page. */
  totalCount: number
  fields: DataGridField<TData>[]
  query: RegistryQuery
  onQueryChange: (query: RegistryQuery) => void
  getRowId: (row: TData) => string
  selectedId: string | null
  /** A selected record loaded independently of the current server page. */
  selectedRecord?: TData | null
  onSelectedIdChange: (id: string | null) => void
  summaries?: RegistrySummary[]
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
  emptyDescription?: string
  noResultsTitle?: string
  initialColumnVisibility?: VisibilityState
  actions?: React.ReactNode
  /** Hide the built-in title/description header when the route supplies its own. */
  hideHeader?: boolean
  /** Opt into virtualised, incrementally loaded rows instead of page controls. */
  incrementalRows?: DataGridIncrementalRows
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

export function RegistryComposition<TData>({
  registryId,
  title,
  description,
  rows,
  totalCount,
  fields,
  query,
  onQueryChange,
  getRowId,
  selectedId,
  selectedRecord,
  onSelectedIdChange,
  summaries = [],
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
  emptyDescription = 'Records will appear here when they are available.',
  initialColumnVisibility = {},
  actions,
  hideHeader = false,
  incrementalRows,
  resizableColumns = false,
  searchDebounceMs = 0,
}: RegistryCompositionProps<TData>) {
  const columns = React.useMemo(
    () =>
      fields.flatMap((field) =>
        field.column ? [{ ...field.column, id: field.id }] : [],
      ),
    [fields],
  )
  const filterDefinitions = fields.filter((field) => field.filter)
  const searchField = filterDefinitions.find(
    (field) =>
      field.filter?.type === 'text' && ['q', 'search'].includes(field.id),
  )
  const groupingOptions = fields.filter((field) => field.groupable)
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(initialColumnVisibility)
  const [uncontrolledInspectorOpen, setUncontrolledInspectorOpen] =
    React.useState(false)
  const [inspectorPinned, setInspectorPinned] = React.useState(false)
  const isXl = useIsXl()

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

  // Auto-open the inspector when a selection arrives (from row click, URL, etc.)
  React.useEffect(() => {
    if (selectedId) setInspectorOpen(true)
  }, [selectedId])

  const sorting = query.sorting as SortingState
  const grouping = query.grouping
  const [expanded, setExpanded] = React.useState<ExpandedState>(
    grouping.length > 0 ? true : {},
  )
  const columnFilters: ColumnFiltersState = query.filters.map((filter) => ({
    id: filter.fieldId,
    value: filter.values,
  }))
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
          fieldId: filter.id,
          operator: 'eq',
          values: Array.isArray(filter.value)
            ? (filter.value as RegistryScalar[])
            : [String(filter.value ?? '')],
        })),
      })
    },
    onColumnVisibilityChange: setColumnVisibility,
  })
  const queryGeneration = JSON.stringify({
    pageSize: query.pageSize,
    sorting: query.sorting,
    grouping: query.grouping,
    filters: query.filters,
  })

  const pageCount = Math.max(1, Math.ceil(totalCount / query.pageSize))
  const selectedRow = selectedId
    ? (rows.find((row) => getRowId(row) === selectedId) ??
      (selectedRecord && getRowId(selectedRecord) === selectedId
        ? selectedRecord
        : null))
    : null
  const hasFilters = query.filters.some((filter) => filter.values.length > 0)
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

  const gridFallback = permissionDenied ? (
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
          ? 'Change or clear the filters to find more records.'
          : emptyDescription
      }
    />
  ) : undefined

  return (
    <section
      aria-labelledby={`${registryId}-title`}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
    >
      {!hideHeader ? (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1
              id={`${registryId}-title`}
              className="font-display text-headline font-heading tracking-tight"
            >
              {title}
            </h1>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {permissionDenied ? null : (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>
      ) : null}

      {!permissionDenied && summaries.length > 0 ? (
        <StatStrip
          aria-label="Summary"
          items={summaries.map((summary) => ({
            label: summary.label,
            value: loading ? '—' : summary.value,
            hint: summary.hint,
            tone: summary.tone,
          }))}
        />
      ) : null}

      {!permissionDenied ? (
        <div className="flex flex-wrap items-center gap-2">
          {searchField ? (
            <RegistrySearch
              key={searchField.id}
              value={String(
                query.filters.find(
                  (filter) => filter.fieldId === searchField.id,
                )?.values[0] ?? '',
              )}
              label={`Search ${title.toLowerCase()}`}
              placeholder={
                searchField.filter?.placeholder ??
                `Search ${title.toLowerCase()}…`
              }
              delay={searchDebounceMs}
              onChange={(value) =>
                onQueryChange({
                  ...query,
                  pageIndex: 0,
                  filters: [
                    ...query.filters.filter(
                      (filter) => filter.fieldId !== searchField.id,
                    ),
                    ...(value
                      ? [
                          {
                            fieldId: searchField.id,
                            operator: 'contains' as const,
                            values: [value],
                          },
                        ]
                      : []),
                  ],
                })
              }
            />
          ) : null}
          {filterDefinitions.length > 0 ? (
            <DataGridFilters
              fields={filterDefinitions.filter(
                (field) => field.id !== searchField?.id,
              )}
              filters={query.filters.filter(
                (filter) => filter.fieldId !== searchField?.id,
              )}
              onFiltersChange={(filters) =>
                onQueryChange({
                  ...query,
                  pageIndex: 0,
                  filters: [
                    ...query.filters.filter(
                      (filter) => filter.fieldId === searchField?.id,
                    ),
                    ...filters,
                  ],
                })
              }
              debounceMs={searchDebounceMs}
            />
          ) : null}

          <div className="flex items-center gap-2">
            <DataGridGrouping
              fields={groupingOptions}
              grouping={query.grouping}
              onGroupingChange={(nextGrouping) =>
                onQueryChange({
                  ...query,
                  pageIndex: 0,
                  grouping: nextGrouping,
                })
              }
            />

            <DataGridColumnSelector table={table} />
          </div>
        </div>
      ) : null}

      {/* Table + pinned inspector layout */}
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* Table — always takes full width. Inspector slides over or pins. */}
        <DataGrid
          table={table}
          title={title}
          getRowId={getRowId}
          selectedId={selectedId}
          onRowOpen={(id) => {
            onSelectedIdChange(id)
            setInspectorOpen(true)
          }}
          fallback={gridFallback}
          partialData={partialData}
          incrementalRows={incrementalRows}
          resizableColumns={resizableColumns}
          resetKey={queryGeneration}
          pageCount={pageCount}
        />

        {/* Pinned inspector — docked aside on xl+ only */}
        {renderInspector &&
        !permissionDenied &&
        inspectorPinned &&
        inspectorOpen &&
        isXl ? (
          <aside
            aria-label={inspectorLabel}
            className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-border bg-background"
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
            className="w-[min(20rem,100vw)] border-l p-0 sm:max-w-none"
            showClose={false}
          >
            <SheetTitle className="sr-only">{inspectorLabel}</SheetTitle>
            <div className="h-full">{inspectorContent}</div>
          </SheetContent>
        </Sheet>
      ) : null}

      {!permissionDenied && !loading && !error ? (
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

function RegistrySearch({
  value,
  label,
  placeholder,
  delay,
  onChange,
}: {
  value: string
  label: string
  placeholder: string
  delay: number
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = React.useState(value)
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  React.useEffect(() => {
    clearTimeout(timer.current)
    setDraft(value)
  }, [value])
  React.useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <Input
      type="search"
      aria-label={label}
      placeholder={placeholder}
      className="h-8 w-full sm:w-64"
      value={draft}
      onChange={(event) => {
        const next = event.target.value
        setDraft(next)
        clearTimeout(timer.current)
        if (delay > 0) timer.current = setTimeout(() => onChange(next), delay)
        else onChange(next)
      }}
    />
  )
}
