/**
 * DATA-007 — Dataset Explorer route (`/datasets`).
 *
 * A read-only browsing surface over real scientific-table metadata. Four tabs
 * — Data, Schema, Relationships, Lineage — share a dataset selector and a
 * row inspector. The Data tab uses TanStack Table (not Handsontable) for
 * paged query and review; Handsontable stays the edit surface inside
 * notebook sheets. Filters, sorting, field selection and grouping stay within
 * the safe limits defined in `dataset-explorer-data`. Named views persist
 * their query specification in local storage. A chart preview is built from
 * the same `ChartSpec` model (SCI-004) Analysis Studio will use, so a saved
 * chart stays reproducible from the same specification.
 *
 * PostgreSQL and RLS remain authoritative (decisions 0019/0034): every read
 * goes through `/api/db`, and permission-denied / partial-data states are
 * surfaced honestly rather than blanked.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type {
  ColumnDef,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Database,
  GitBranch,
  Layers,
  LineChart,
  Save,
  Search,
  Table as TableIcon,
  Trash2,
  Workflow,
} from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { StatusBadge } from '#/components/scientific/status-badge'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  Separator,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#/components/ui'
import { materialiseLiveChart, useLiveChartDataset } from '#/lib/chart-data'
import { formatCount } from '#/lib/format-numbers'
import {
  formatRelativeTime,
  fetchLinksForRecord,
  notebookDataClient,
} from '#/lib/notebook-data'
import {
  buildDefaultChartSpec,
  createDatasetSavedViewStore,
  DATASET_DEFAULT_PAGE_SIZE,
  DATASET_MAX_FILTERS,
  DATASET_PAGE_SIZES,
  DATASET_QUERY_HARD_LIMIT,
  datasetExplorerDataClient,
  datasetExplorerQueryKeys,
  fetchDatasetLineage,
  fetchDatasetRelationshipsFor,
  fetchDatasetRowPage,
  fetchDatasetSchemaDetail,
  fetchDatasetSummaries,
  sanitizeDatasetView,
  validateTransformations,
} from '#/lib/dataset-explorer-data'
import type {
  DatasetDensity,
  DatasetRowQuery,
  DatasetSavedView,
  DatasetSavedViewStore,
  DatasetViewSpec,
} from '#/lib/dataset-explorer-data'
import type {
  FormulaDefinitionWire,
  FormulaDependencyWire,
  ScientificColumnWire,
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'
import type {
  DatasetSchemaFieldWire,
  DatasetSchemaWire,
} from '#/lib/dataset-schema-data'
import type { ChartSpec, ChartType } from '#/lib/chart-spec'
import { CHART_TYPES } from '#/lib/chart-spec'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/datasets')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: DatasetExplorerRoute,
})

const DEFAULT_DATASET_QUERY: DatasetRowQuery = {
  pageIndex: 0,
  pageSize: DATASET_DEFAULT_PAGE_SIZE,
  sorting: [],
  filters: [],
}

function viewId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `view-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function queryIdentity(query: DatasetRowQuery): string {
  return [
    query.pageIndex,
    query.pageSize,
    query.sorting.map((s) => `${s.id}:${s.desc}`).join(','),
    query.filters.map((f) => `${f.id}=${f.value}`).join(','),
  ].join('|')
}

function rowCellValue(row: ScientificRowWire, column: ScientificColumnWire) {
  const value = row[column.field_name]
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return formatCount(value)
  return String(value)
}

function toColumnDefs(
  columns: ScientificColumnWire[],
): ColumnDef<ScientificRowWire, unknown>[] {
  return columns.map((column) => ({
    id: column.field_name,
    accessorKey: column.field_name,
    header: column.label,
    cell: ({ row }) => rowCellValue(row.original, column),
    enableSorting: true,
    enableHiding: true,
  }))
}

function toVisibility(
  columns: ScientificColumnWire[],
  hiddenFields: string[],
): VisibilityState {
  const hidden = new Set(hiddenFields)
  return Object.fromEntries(
    columns.map((c) => [c.field_name, !hidden.has(c.field_name)]),
  )
}

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

function DatasetExplorerRoute() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? 'no-workspace'
  const userId = context.user.id

  const summariesQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.summaries,
    queryFn: () => fetchDatasetSummaries(datasetExplorerDataClient),
    staleTime: 30_000,
  })

  const datasets = summariesQuery.data ?? []
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<
    'data' | 'schema' | 'relationships' | 'lineage'
  >('data')

  // Auto-select the first dataset once the list loads.
  useEffect(() => {
    if (!selectedTableId && datasets.length > 0) {
      setSelectedTableId(datasets[0].id)
    }
    if (
      selectedTableId &&
      datasets.length > 0 &&
      !datasets.some((d) => d.id === selectedTableId)
    ) {
      setSelectedTableId(datasets[0].id)
    }
  }, [datasets, selectedTableId])

  const selectedTable = useMemo(
    () => datasets.find((d) => d.id === selectedTableId) ?? null,
    [datasets, selectedTableId],
  )

  const viewStore = useMemo(
    () => createDatasetSavedViewStore({ workspaceId, userId }),
    [workspaceId, userId],
  )

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  useShell({
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Datasets' }],
    fullBleed: true,
  })

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
        <DatasetExplorerHeader
          datasets={datasets}
          loading={summariesQuery.isLoading}
          error={summariesQuery.error}
          selectedTableId={selectedTableId}
          onSelect={setSelectedTableId}
        />
        {selectedTable ? (
          <DatasetTabs
            table={selectedTable}
            workspaceId={workspaceId}
            userId={userId}
            viewStore={viewStore}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        ) : (
          <EmptyDatasetState
            loading={summariesQuery.isLoading}
            error={summariesQuery.error}
          />
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Header + dataset selector
// ---------------------------------------------------------------------------

interface DatasetExplorerHeaderProps {
  datasets: ScientificTableWire[]
  loading: boolean
  error: unknown
  selectedTableId: string | null
  onSelect: (id: string) => void
}

export function DatasetExplorerHeader({
  datasets,
  loading,
  error,
  selectedTableId,
  onSelect,
}: DatasetExplorerHeaderProps) {
  return (
    <header
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
      aria-labelledby="datasets-title"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Database className="size-5 text-violet-500" aria-hidden="true" />
        <div className="min-w-0">
          <h1
            id="datasets-title"
            className="text-lg font-semibold tracking-tight"
          >
            Dataset Explorer
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            Browse scientific datasets, schemas, relationships and lineage.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {error ? (
          <Badge variant="danger">Could not load datasets</Badge>
        ) : loading ? (
          <Skeleton className="h-8 w-56" />
        ) : datasets.length === 0 ? (
          <Badge variant="outline">No datasets</Badge>
        ) : (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Dataset</span>
            <Select
              aria-label="Select dataset"
              value={selectedTableId ?? ''}
              onChange={(e) => onSelect(e.target.value)}
              className="h-8 w-64 bg-background"
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.dataset_schema ? ` · ${d.dataset_schema.slug}` : ''}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

interface DatasetTabsProps {
  table: ScientificTableWire
  workspaceId: string
  userId: string
  viewStore: DatasetSavedViewStore
  activeTab: 'data' | 'schema' | 'relationships' | 'lineage'
  onTabChange: (tab: 'data' | 'schema' | 'relationships' | 'lineage') => void
}

function DatasetTabs({
  table,
  workspaceId,
  userId,
  viewStore,
  activeTab,
  onTabChange,
}: DatasetTabsProps) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) =>
        onTabChange(v as 'data' | 'schema' | 'relationships' | 'lineage')
      }
      className="relative min-h-0 flex-1 overflow-hidden"
    >
      <TabsList className="w-fit">
        <TabsTrigger value="data">
          <TableIcon className="size-3.5" aria-hidden="true" /> Data
        </TabsTrigger>
        <TabsTrigger value="schema">
          <Layers className="size-3.5" aria-hidden="true" /> Schema
        </TabsTrigger>
        <TabsTrigger value="relationships">
          <Workflow className="size-3.5" aria-hidden="true" /> Relationships
        </TabsTrigger>
        <TabsTrigger value="lineage">
          <GitBranch className="size-3.5" aria-hidden="true" /> Lineage
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="data"
        className="absolute inset-x-0 bottom-0 top-10 flex min-h-0 flex-col gap-3"
      >
        <DatasetDataTab
          table={table}
          workspaceId={workspaceId}
          userId={userId}
          viewStore={viewStore}
        />
      </TabsContent>
      <TabsContent
        value="schema"
        className="absolute inset-x-0 bottom-0 top-10 flex min-h-0 flex-col gap-3 overflow-auto"
      >
        <DatasetSchemaTab table={table} />
      </TabsContent>
      <TabsContent
        value="relationships"
        className="absolute inset-x-0 bottom-0 top-10 flex min-h-0 flex-col gap-3 overflow-auto"
      >
        <DatasetRelationshipsTab table={table} />
      </TabsContent>
      <TabsContent
        value="lineage"
        className="absolute inset-x-0 bottom-0 top-10 flex min-h-0 flex-col gap-3 overflow-auto"
      >
        <DatasetLineageTab table={table} />
      </TabsContent>
    </Tabs>
  )
}

// ---------------------------------------------------------------------------
// Data tab — TanStack Table, paged query, filters, sorting, saved views,
// inspector, chart preview.
// ---------------------------------------------------------------------------

export interface DatasetDataTabProps {
  table: ScientificTableWire
  workspaceId: string
  userId: string
  viewStore: DatasetSavedViewStore
}

export function DatasetDataTab({
  table,
  workspaceId,
  userId,
  viewStore,
}: DatasetDataTabProps) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState<DatasetRowQuery>(DEFAULT_DATASET_QUERY)
  const [hiddenFields, setHiddenFields] = useState<string[]>([])
  const [density, setDensity] = useState<DatasetDensity>('comfortable')
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [savedViewName, setSavedViewName] = useState('')
  const [selectedViewId, setSelectedViewId] = useState('')
  const [savedViews, setSavedViews] = useState<DatasetSavedView[]>([])

  // Chart preview spec, persisted per dataset in local storage.
  const chartStorageKey = useMemo(
    () =>
      ['sheetbase-dataset-chart-v1', workspaceId, userId, table.id]
        .map(encodeURIComponent)
        .join(':'),
    [workspaceId, userId, table.id],
  )
  const [chartSpec, setChartSpec] = useState<ChartSpec | null>(() => {
    if (typeof window === 'undefined') return buildDefaultChartSpec(table)
    try {
      const raw = window.localStorage.getItem(chartStorageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (
          parsed &&
          typeof parsed === 'object' &&
          'specVersion' in parsed &&
          'datasets' in parsed
        ) {
          return parsed as ChartSpec
        }
      }
    } catch {
      // ignore corrupt persisted spec
    }
    return buildDefaultChartSpec(table)
  })
  useEffect(() => {
    try {
      if (chartSpec) {
        window.localStorage.setItem(chartStorageKey, JSON.stringify(chartSpec))
      } else {
        window.localStorage.removeItem(chartStorageKey)
      }
    } catch {
      // storage unavailable; preview still works in-memory
    }
  }, [chartSpec, chartStorageKey])

  // Reset view state when the dataset changes.
  useEffect(() => {
    setQuery(DEFAULT_DATASET_QUERY)
    setHiddenFields([])
    setDensity('comfortable')
    setSelectedRowId(null)
    setSelectedViewId('')
    setSavedViews(viewStore.list(table.id))
    setChartSpec(buildDefaultChartSpec(table))
  }, [table.id, viewStore])

  const qid = queryIdentity(query)
  const rowsQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.rows(table.id, qid),
    queryFn: () => fetchDatasetRowPage(datasetExplorerDataClient, table, query),
    placeholderData: (prev) => prev,
    staleTime: 0,
  })

  const lineageQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.lineage(table.id),
    queryFn: () => fetchDatasetLineage(datasetExplorerDataClient, table.id),
    staleTime: 30_000,
  })

  const columns = useMemo(() => toColumnDefs(table.columns), [table.columns])
  const columnVisibility = useMemo(
    () => toVisibility(table.columns, hiddenFields),
    [table.columns, hiddenFields],
  )

  const sorting = query.sorting as SortingState
  const tableInstance = useReactTable({
    data: rowsQuery.data?.rows ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: rowsQuery.data?.totalCount ?? 0,
    state: {
      pagination: { pageIndex: query.pageIndex, pageSize: query.pageSize },
      sorting,
      columnVisibility,
    },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? updater({
              pageIndex: query.pageIndex,
              pageSize: query.pageSize,
            })
          : updater
      setQuery((q) => ({ ...q, ...next }))
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      setQuery((q) => ({
        ...q,
        pageIndex: 0,
        sorting: next.map((s) => ({ id: s.id, desc: s.desc })),
      }))
    },
    onColumnVisibilityChange: (updater) => {
      const next =
        typeof updater === 'function' ? updater(columnVisibility) : updater
      setHiddenFields(
        table.columns
          .filter((c) => next[c.field_name] === false)
          .map((c) => c.field_name),
      )
    },
  })

  const pageCount = Math.max(
    1,
    Math.ceil((rowsQuery.data?.totalCount ?? 0) / query.pageSize),
  )

  const selectedRow = useMemo(
    () =>
      selectedRowId
        ? ((rowsQuery.data?.rows ?? []).find((r) => r.id === selectedRowId) ??
          null)
        : null,
    [rowsQuery.data, selectedRowId],
  )

  function setFilter(id: string, value: string) {
    setQuery((q) => {
      const filters = q.filters.filter((f) => f.id !== id)
      if (value) filters.push({ id, value })
      return {
        ...q,
        pageIndex: 0,
        filters: filters.slice(0, DATASET_MAX_FILTERS),
      }
    })
  }

  function saveView() {
    const name = savedViewName.trim()
    if (!name) return
    const spec: DatasetViewSpec = { query, hiddenFields, density }
    const saved = viewStore.save({
      id: viewId(),
      name,
      tableId: table.id,
      spec,
    })
    setSavedViews(viewStore.list(table.id))
    setSavedViewName('')
    setSelectedViewId(saved.id)
  }

  function applyView(id: string) {
    setSelectedViewId(id)
    const view = savedViews.find((v) => v.id === id)
    if (!view) return
    const safe = sanitizeDatasetView(view, table.columns)
    setQuery(safe.spec.query)
    setHiddenFields(safe.spec.hiddenFields)
    setDensity(safe.spec.density)
  }

  function deleteView(id: string) {
    viewStore.remove(table.id, id)
    setSavedViews(viewStore.list(table.id))
    if (selectedViewId === id) setSelectedViewId('')
  }

  // Linked records for the selected row (via the table's record_id).
  const recordId = table.record_id ?? null
  const linksQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.links(recordId ?? 'none'),
    queryFn: () => fetchLinksForRecord(notebookDataClient, recordId as string),
    enabled: Boolean(selectedRowId) && Boolean(recordId),
    staleTime: 30_000,
  })

  const saveMutation = useMutation({
    mutationFn: async () => saveView(),
    onSuccess: () => queryClient.invalidateQueries(),
  })

  return (
    <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
        {/* Filter + view toolbar */}
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-2">
          {table.columns.slice(0, DATASET_MAX_FILTERS).map((column) => (
            <label
              key={column.id}
              className="min-w-32 text-xs text-muted-foreground"
            >
              {column.label}
              <span className="relative mt-1 block">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
                <Input
                  aria-label={`Filter by ${column.label}`}
                  value={
                    query.filters.find((f) => f.id === column.field_name)
                      ?.value ?? ''
                  }
                  onChange={(e) => setFilter(column.field_name, e.target.value)}
                  placeholder={`Filter ${column.label}`}
                  className="h-8 bg-background pl-7 text-xs"
                />
              </span>
            </label>
          ))}
          <label className="min-w-28 text-xs text-muted-foreground">
            Density
            <Select
              aria-label="Table density"
              value={density}
              onChange={(e) => setDensity(e.target.value as DatasetDensity)}
              className="mt-1 h-8 bg-background text-xs"
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </Select>
          </label>
          <ColumnVisibilityMenu table={tableInstance} columns={table.columns} />
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <label className="min-w-36 text-xs text-muted-foreground">
              Saved views
              <Select
                aria-label="Saved views"
                value={selectedViewId}
                onChange={(e) => applyView(e.target.value)}
                className="mt-1 h-8 bg-background text-xs"
              >
                <option value="">Current view</option>
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="min-w-40 text-xs text-muted-foreground">
              Saved view name
              <Input
                aria-label="Saved view name"
                value={savedViewName}
                onChange={(e) => setSavedViewName(e.target.value)}
                className="mt-1 h-8 bg-background text-xs"
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={!savedViewName.trim()}
              aria-label="Save current view"
            >
              <Save /> Save
            </Button>
            {selectedViewId ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteView(selectedViewId)}
                aria-label="Delete saved view"
              >
                <Trash2 /> Delete
              </Button>
            ) : null}
          </div>
        </div>

        {/* Data table */}
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
          <DataTableView
            table={tableInstance}
            density={density}
            loading={rowsQuery.isLoading}
            error={rowsQuery.error}
            rowCount={rowsQuery.data?.totalCount ?? 0}
            selectedRowId={selectedRowId}
            onSelectRow={setSelectedRowId}
            emptyTitle={
              query.filters.some((f) => f.value)
                ? 'No matching rows'
                : 'No rows yet'
            }
          />
        </div>

        {/* Chart preview */}
        <ChartPreview
          table={table}
          chartSpec={chartSpec}
          onChartSpecChange={setChartSpec}
        />

        {/* Pager */}
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>
            {formatCount(rowsQuery.data?.totalCount ?? 0)}{' '}
            {(rowsQuery.data?.totalCount ?? 0) === 1 ? 'row' : 'rows'}
            {(rowsQuery.data?.totalCount ?? 0) >= DATASET_QUERY_HARD_LIMIT
              ? ' (server limit reached)'
              : ''}
          </p>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              Rows
              <Select
                aria-label="Rows per page"
                value={String(query.pageSize)}
                onChange={(e) =>
                  setQuery((q) => ({
                    ...q,
                    pageIndex: 0,
                    pageSize: Number(e.target.value),
                  }))
                }
                className="h-8 w-20 bg-background text-xs"
              >
                {DATASET_PAGE_SIZES.map((size) => (
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
              disabled={query.pageIndex === 0 || rowsQuery.isFetching}
              onClick={() => tableInstance.previousPage()}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next page"
              disabled={
                query.pageIndex >= pageCount - 1 || rowsQuery.isFetching
              }
              onClick={() => tableInstance.nextPage()}
            >
              <ChevronRight />
            </Button>
          </div>
        </footer>
      </div>

      {/* Inspector */}
      <aside
        aria-label="Dataset inspector"
        className="min-h-0 overflow-auto rounded-lg border bg-card p-4"
      >
        <DatasetInspector
          table={table}
          row={selectedRow}
          formulas={lineageQuery.data?.formulas ?? []}
          dependencies={lineageQuery.data?.dependencies ?? []}
          links={linksQuery.data ?? []}
          lineageLoading={lineageQuery.isLoading}
          lineageError={lineageQuery.error}
        />
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Column visibility menu
// ---------------------------------------------------------------------------

function ColumnVisibilityMenu({
  table,
  columns,
}: {
  table: ReturnType<typeof useReactTable<ScientificRowWire>>
  columns: ScientificColumnWire[]
}) {
  return (
    <div className="relative">
      <details className="group">
        <summary className="flex h-8 cursor-pointer items-center gap-1 rounded-md border bg-background px-3 text-xs">
          <Columns3 className="size-3.5" aria-hidden="true" /> Columns
        </summary>
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border bg-card p-2 shadow-md">
          <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Visible columns
          </p>
          {columns.map((column) => {
            const col = table.getColumn(column.field_name)
            const visible = col ? col.getIsVisible() : true
            return (
              <label
                key={column.id}
                className="flex items-center gap-2 px-1 py-0.5 text-xs"
              >
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(e) => col?.toggleVisibility(e.target.checked)}
                />
                {column.label}
              </label>
            )
          })}
        </div>
      </details>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data table view
// ---------------------------------------------------------------------------

interface DataTableViewProps {
  table: ReturnType<typeof useReactTable<ScientificRowWire>>
  density: DatasetDensity
  loading: boolean
  error: unknown
  rowCount: number
  selectedRowId: string | null
  onSelectRow: (id: string | null) => void
  emptyTitle: string
}

export function DataTableView({
  table,
  density,
  loading,
  error,
  rowCount,
  selectedRowId,
  onSelectRow,
  emptyTitle,
}: DataTableViewProps) {
  if (error) {
    return (
      <div
        role="alert"
        className="flex min-h-40 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-destructive"
      >
        Could not load rows. Try again.
      </div>
    )
  }
  if (loading && rowCount === 0) {
    return (
      <div aria-busy="true" aria-label="Loading dataset rows">
        <p className="sr-only">Loading dataset rows</p>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-4 border-b px-3 py-3 last:border-0">
            {Array.from({ length: 4 }).map((__, j) => (
              <Skeleton key={j} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    )
  }
  if (rowCount === 0) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
        {emptyTitle}
      </div>
    )
  }
  return (
    <Table aria-label="Dataset rows" data-density={density}>
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
                      className="inline-flex items-center gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={header.column.getToggleSortingHandler()}
                      aria-label={`Sort by ${label} ${sorted === 'asc' ? 'descending' : 'ascending'}`}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <span aria-hidden>
                        {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}
                      </span>
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
        {table.getRowModel().rows.map((row) => {
          const id = row.original.id
          const selected = id === selectedRowId
          return (
            <TableRow
              key={id}
              data-state={selected ? 'selected' : undefined}
              aria-selected={selected}
              className="cursor-pointer"
              onClick={() => onSelectRow(selected ? null : id)}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={cn(
                    density === 'compact' && 'py-1.5',
                    typeof cell.getValue() === 'number' &&
                      'scientific-nums text-right tabular-nums',
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

// ---------------------------------------------------------------------------
// Chart preview
// ---------------------------------------------------------------------------

interface ChartPreviewProps {
  table: ScientificTableWire
  chartSpec: ChartSpec | null
  onChartSpecChange: (spec: ChartSpec | null) => void
}

function ChartPreview({
  table,
  chartSpec,
  onChartSpecChange,
}: ChartPreviewProps) {
  const numericColumns = table.columns.filter(
    (c) => c.logical_type === 'decimal' || c.logical_type === 'integer',
  )
  const transformCheck = chartSpec
    ? validateTransformations(chartSpec.transformations)
    : { ok: true as const }

  // Resolve the chart dataset + calc results via the shared SCI-004 path so
  // the preview stays reproducible from the same ChartSpec model.
  const { datasetQuery, calcQuery } = useLiveChartDataset(chartSpec)
  const materialised = useMemo(
    () =>
      chartSpec
        ? materialiseLiveChart(
            chartSpec,
            datasetQuery.data ?? null,
            calcQuery.data ?? null,
          )
        : null,
    [chartSpec, datasetQuery.data, calcQuery.data],
  )

  function setY(columnId: string) {
    const column = table.columns.find((c) => c.id === columnId)
    if (!chartSpec || !column) return
    onChartSpecChange({
      ...chartSpec,
      fields: {
        ...chartSpec.fields,
        y: { columnId, fieldName: column.field_name },
      },
      display: {
        ...chartSpec.display,
        axes: {
          ...chartSpec.display.axes,
          y: { ...chartSpec.display.axes.y, label: column.label },
        },
      },
    })
  }

  function setType(type: ChartType) {
    if (!chartSpec) return
    onChartSpecChange({ ...chartSpec, type })
  }

  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <LineChart className="size-4 text-violet-500" aria-hidden="true" />
          Chart preview
        </div>
        {chartSpec ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-1">
              Type
              <Select
                aria-label="Chart type"
                value={chartSpec.type}
                onChange={(e) => setType(e.target.value as ChartType)}
                className="h-8 bg-background"
              >
                {CHART_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-1">
              Y
              <Select
                aria-label="Y axis field"
                value={chartSpec.fields.y.columnId}
                onChange={(e) => setY(e.target.value)}
                className="h-8 bg-background"
              >
                {numericColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        ) : null}
      </div>
      {!chartSpec ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No numeric column to plot. Add a decimal or integer column to this
          dataset to see a chart preview.
        </p>
      ) : !transformCheck.ok ? (
        <p role="alert" className="py-4 text-center text-xs text-destructive">
          {transformCheck.errors.join(' ')}
        </p>
      ) : materialised ? (
        <ChartRenderer
          title={`${table.name} — preview`}
          spec={chartSpec}
          materialised={materialised}
          frozen={null}
          loading={datasetQuery.isLoading}
        />
      ) : null}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Inspector — selected row, lineage, linked records, transformations
// ---------------------------------------------------------------------------

interface DatasetInspectorProps {
  table: ScientificTableWire
  row: ScientificRowWire | null
  formulas: FormulaDefinitionWire[]
  dependencies: FormulaDependencyWire[]
  links: Array<{
    id: string
    targetKind: string
    targetIdentifier: string
    linkType: string
  }>
  lineageLoading: boolean
  lineageError: unknown
}

export function DatasetInspector({
  table,
  row,
  formulas,
  dependencies,
  links,
  lineageLoading,
  lineageError,
}: DatasetInspectorProps) {
  const rowFormulas = useMemo(
    () => (row ? formulas.filter((f) => f.target_row_id === row.id) : []),
    [formulas, row],
  )
  const rowDependencies = useMemo(
    () => (row ? dependencies.filter((d) => d.source_row_id === row.id) : []),
    [dependencies, row],
  )

  return (
    <div className="space-y-4 text-sm">
      <section aria-labelledby="inspector-row">
        <h2 id="inspector-row" className="text-sm font-semibold">
          Selected row
        </h2>
        {!row ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Select a row to inspect its values, lineage and linked records.
          </p>
        ) : (
          <dl className="mt-2 space-y-1">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Row id</dt>
              <dd className="break-all font-mono text-xs">{row.id}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="tabular-nums">{row.version}</dd>
            </div>
            <Separator className="my-2" />
            {table.columns.map((column) => (
              <div key={column.id} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{column.label}</dt>
                <dd className="text-right">{rowCellValue(row, column)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <Separator />

      <section aria-labelledby="inspector-lineage">
        <h2 id="inspector-lineage" className="text-sm font-semibold">
          Lineage & transformations
        </h2>
        {lineageError ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            Could not load lineage.
          </p>
        ) : lineageLoading ? (
          <Skeleton className="mt-2 h-16 w-full" />
        ) : rowFormulas.length === 0 && rowDependencies.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No calculated columns or cross-sheet dependencies touch this row.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {rowFormulas.map((f) => (
              <li
                key={f.id}
                className="rounded-md border bg-muted/30 p-2 text-xs"
              >
                <p className="font-medium">{f.source_expression}</p>
                <p className="text-muted-foreground">
                  status: {f.status} · engine {f.engine_version}
                </p>
              </li>
            ))}
            {rowDependencies.map((d, i) => (
              <li
                key={`${d.formula_id}-${i}`}
                className="rounded-md border bg-muted/30 p-2 text-xs"
              >
                <p className="font-medium">Cross-sheet dependency</p>
                <p className="text-muted-foreground">
                  source column {d.source_column_id.slice(0, 8)} → formula{' '}
                  {d.formula_id.slice(0, 8)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />

      <section aria-labelledby="inspector-links">
        <h2 id="inspector-links" className="text-sm font-semibold">
          Linked records
        </h2>
        {links.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No outgoing record links from this dataset.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {links.map((link) => (
              <li
                key={link.id}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="truncate font-mono">
                  {link.targetIdentifier}
                </span>
                <Badge variant="outline">{link.linkType}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Schema tab
// ---------------------------------------------------------------------------

interface DatasetSchemaTabProps {
  table: ScientificTableWire
}

export function DatasetSchemaTab({ table }: DatasetSchemaTabProps) {
  const schemaQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.schemaFields(
      table.dataset_schema_id ?? 'none',
    ),
    queryFn: () => fetchDatasetSchemaDetail(datasetExplorerDataClient, table),
    staleTime: 30_000,
  })

  const schema: DatasetSchemaWire | null = schemaQuery.data?.schema ?? null
  const fields: DatasetSchemaFieldWire[] = schemaQuery.data?.fields ?? []

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Bound dataset schema</h2>
            {schema ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className="font-mono">{schema.slug}</span> · revision{' '}
                {schema.revision} ·{' '}
                <StatusBadge
                  status={schema.status}
                  vocabulary={{
                    draft: { label: 'Draft', tone: 'warning', icon: Layers },
                    published: {
                      label: 'Published',
                      tone: 'success',
                      icon: Database,
                    },
                    retired: {
                      label: 'Retired',
                      tone: 'neutral',
                      icon: Trash2,
                    },
                  }}
                  size="sm"
                />
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {schemaQuery.isLoading
                  ? 'Loading…'
                  : 'This sheet is not bound to a dataset schema (legacy ad-hoc columns).'}
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold">
          {schema ? 'Schema fields' : 'Local columns'}
        </h3>
        {schemaQuery.isLoading ? (
          <Skeleton className="mt-2 h-24 w-full" />
        ) : (
          <div className="mt-2 overflow-x-auto">
            <Table aria-label="Dataset fields">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Label</TableHead>
                  <TableHead>Slug / field</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(schema ? fields : table.columns).map((entry) => {
                  const label =
                    'label' in entry
                      ? entry.label
                      : (entry as ScientificColumnWire).label
                  const slug = 'slug' in entry ? entry.slug : entry.field_name
                  const logicalType =
                    'logical_type' in entry
                      ? entry.logical_type
                      : (entry as ScientificColumnWire).logical_type
                  const nullable =
                    'nullable' in entry
                      ? entry.nullable
                      : (entry as ScientificColumnWire).nullable
                  const unit =
                    'unit' in entry
                      ? entry.unit
                      : (entry as ScientificColumnWire).unit
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>{label}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {slug}
                      </TableCell>
                      <TableCell>{logicalType}</TableCell>
                      <TableCell>{nullable ? 'No' : 'Yes'}</TableCell>
                      <TableCell>{describeUnit(unit)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  )
}

function describeUnit(unit: unknown) {
  if (!unit || typeof unit !== 'object') return '—'
  const value = unit as { symbol?: unknown; code?: unknown }
  const symbol = typeof value.symbol === 'string' ? value.symbol : null
  const code = typeof value.code === 'string' ? value.code : null
  return symbol && code && symbol !== code
    ? `${symbol} (${code})`
    : (symbol ?? code ?? '—')
}

// ---------------------------------------------------------------------------
// Relationships tab
// ---------------------------------------------------------------------------

interface DatasetRelationshipsTabProps {
  table: ScientificTableWire
}

export function DatasetRelationshipsTab({
  table,
}: DatasetRelationshipsTabProps) {
  const schemaId = table.dataset_schema_id ?? null
  const relationshipsQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.relationships,
    queryFn: () =>
      fetchDatasetRelationshipsFor(datasetExplorerDataClient, schemaId),
    enabled: Boolean(schemaId),
    staleTime: 30_000,
  })

  const relationships = relationshipsQuery.data ?? []

  if (!schemaId) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        This dataset is not bound to a schema, so schema relationships are not
        available. Bind it to a dataset schema on the Schemas page to define
        relationships.
      </Card>
    )
  }
  if (relationshipsQuery.isLoading) {
    return <Skeleton className="h-32 w-full" />
  }
  if (relationshipsQuery.error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
      >
        Could not load relationships.
      </div>
    )
  }
  if (relationships.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No relationships defined for this schema yet. Use the Schemas page to
        connect it to other schemas.
      </Card>
    )
  }
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">Schema relationships</h2>
      <div className="mt-2 overflow-x-auto">
        <Table aria-label="Dataset relationships">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Type</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Cardinality</TableHead>
              <TableHead>Target schema</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {relationships.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">
                  {r.relationship_type}
                </TableCell>
                <TableCell>{r.label || '—'}</TableCell>
                <TableCell>{r.cardinality}</TableCell>
                <TableCell className="font-mono text-xs">
                  {r.target_schema_id === schemaId
                    ? r.source_schema_id.slice(0, 8)
                    : r.target_schema_id.slice(0, 8)}
                </TableCell>
                <TableCell>{formatRelativeTime(r.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Lineage tab
// ---------------------------------------------------------------------------

interface DatasetLineageTabProps {
  table: ScientificTableWire
}

export function DatasetLineageTab({ table }: DatasetLineageTabProps) {
  const lineageQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.lineage(table.id),
    queryFn: () => fetchDatasetLineage(datasetExplorerDataClient, table.id),
    staleTime: 30_000,
  })

  const formulas = lineageQuery.data?.formulas ?? []
  const dependencies = lineageQuery.data?.dependencies ?? []

  if (lineageQuery.isLoading) {
    return <Skeleton className="h-32 w-full" />
  }
  if (lineageQuery.error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
      >
        Could not load lineage.
      </div>
    )
  }
  if (formulas.length === 0 && dependencies.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No calculated columns or cross-sheet dependencies recorded for this
        dataset. Formulas written in the notebook sheet appear here as
        transformations.
      </Card>
    )
  }
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <h2 className="text-sm font-semibold">
          Transformations ({formulas.length})
        </h2>
        {formulas.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No formula definitions.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {formulas.map((f) => (
              <li
                key={f.id}
                className="rounded-md border bg-muted/30 p-2 text-xs"
              >
                <p className="font-mono break-all">{f.source_expression}</p>
                <p className="mt-1 text-muted-foreground">
                  syntax {f.syntax_profile} · engine {f.engine_version} · status{' '}
                  {f.status}
                </p>
                <p className="text-muted-foreground">
                  target row {f.target_row_id.slice(0, 8)} · column{' '}
                  {f.target_column_id.slice(0, 8)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="text-sm font-semibold">
          Cross-sheet dependencies ({dependencies.length})
        </h2>
        {dependencies.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No cross-sheet dependencies.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {dependencies.map((d, i) => (
              <li
                key={`${d.formula_id}-${i}`}
                className="rounded-md border bg-muted/30 p-2"
              >
                formula {d.formula_id.slice(0, 8)} ← source row{' '}
                {d.source_row_id.slice(0, 8)} column{' '}
                {d.source_column_id.slice(0, 8)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyDatasetState({
  loading,
  error,
}: {
  loading: boolean
  error: unknown
}) {
  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center text-sm text-destructive"
      >
        Could not load datasets. Check the connection and try again.
      </div>
    )
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border bg-card p-10 text-center">
      {loading ? (
        <Skeleton className="h-8 w-48" />
      ) : (
        <>
          <Database
            className="size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="max-w-md text-sm text-muted-foreground">
            No datasets yet. Create a notebook with a sheet block, or bind a
            dataset schema on the Schemas page, to see datasets here.
          </p>
        </>
      )}
    </div>
  )
}
