/**
 * DATA-007 — Dataset Explorer route (`/datasets`).
 *
 * A read-only browsing surface over real scientific-table metadata. Data and
 * Schema tabs share a searchable dataset selector and a row inspector. The
 * Data tab uses the shared virtualised grid for incremental query and review;
 * Handsontable stays the edit surface inside notebook sheets. Filters,
 * sorting, field selection and grouping stay within the safe limits defined
 * in `dataset-explorer-data`. A resizable chart preview uses the same
 * `ChartSpec` model (SCI-004) as Analysis Studio without duplicating its
 * authoring controls.
 *
 * PostgreSQL and RLS remain authoritative (decisions 0019/0034): every read
 * goes through `/api/db`, and permission-denied / partial-data states are
 * surfaced honestly rather than blanked.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { flexRender } from '@tanstack/react-table'
import type { ColumnDef, useReactTable } from '@tanstack/react-table'
import {
  Check,
  ChevronsUpDown,
  Database,
  Layers,
  Table as TableIcon,
  Trash2,
} from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { RegistryComposition } from '#/components/registry'
import type { DataGridField } from '#/components/data-grid'
import {
  EmptyHint,
  Inspector,
  InspectorSection,
  LinkedRecordList,
  Property,
  PropertyList,
} from '#/components/record'
import { StatusBadge } from '#/components/scientific/status-badge'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import {
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
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
  fetchLinksForRecord,
  formatRelativeTime,
  notebookDataClient,
} from '#/lib/notebook-data'
import {
  buildDefaultChartSpec,
  DATASET_DEFAULT_PAGE_SIZE,
  DATASET_MAX_FILTERS,
  datasetExplorerDataClient,
  datasetExplorerQueryKeys,
  fetchDatasetLineage,
  fetchDatasetRelationshipsFor,
  fetchDatasetRowPage,
  fetchDatasetSchemaDetail,
  fetchDatasetSummaries,
  getNextDatasetPageParam,
  validateTransformations,
} from '#/lib/dataset-explorer-data'
import type {
  DatasetDensity,
  DatasetRowQuery,
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
import type { ChartSpec } from '#/lib/chart-spec'
import type { RegistryQuery } from '#/lib/registry'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/datasets')({
  validateSearch: (search: Record<string, unknown>) => ({
    dataset: typeof search.dataset === 'string' ? search.dataset : '',
  }),
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
const MINIMUM_DATASET_GRID_HEIGHT = 220
const PREFERRED_MINIMUM_PREVIEW_HEIGHT = 220
const DATASET_SPLITTER_HEIGHT = 8

export function datasetPreviewBounds(layoutHeight: number): {
  minimum: number
  maximum: number
} {
  const maximum = Math.max(
    0,
    layoutHeight - MINIMUM_DATASET_GRID_HEIGHT - DATASET_SPLITTER_HEIGHT,
  )
  return {
    minimum: Math.min(PREFERRED_MINIMUM_PREVIEW_HEIGHT, maximum),
    maximum,
  }
}

function queryIdentity(query: DatasetRowQuery): string {
  return [
    query.pageSize,
    query.sorting.map((s) => `${s.id}:${s.desc}`).join(','),
    query.filters
      .map((f) => `${f.fieldId}:${f.operator}=${f.values.join(',')}`)
      .join(','),
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
  return columns.map((column) => {
    const numeric = ['decimal', 'integer'].includes(column.logical_type)
    return {
      id: column.field_name,
      accessorKey: column.field_name,
      header: column.label,
      cell: ({ row }) => (
        <span
          className={cn(
            numeric && 'scientific-nums tabular-nums',
            /sample id/i.test(column.label) && 'font-medium text-primary',
          )}
        >
          {rowCellValue(row.original, column)}
        </span>
      ),
      meta: numeric
        ? {
            dataGridFormat: {
              kind: 'scientific' as const,
              unit: describeUnit(column.unit).replace('—', '') || undefined,
            },
          }
        : undefined,
      enableSorting: true,
      enableHiding: true,
    }
  })
}

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

function DatasetExplorerRoute() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const workspaceId = context.workspace?.id ?? 'no-workspace'
  const userId = context.user.id

  const summariesQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.summaries,
    queryFn: () => fetchDatasetSummaries(datasetExplorerDataClient),
    staleTime: 30_000,
  })

  const datasets = summariesQuery.data ?? []
  const [activeTab, setActiveTab] = useState<'data' | 'schema'>('data')

  const requestedTableId = search.dataset || null
  const selectedTable = useMemo(
    () =>
      datasets.find((dataset) => dataset.id === requestedTableId) ||
      datasets.at(0) ||
      null,
    [datasets, requestedTableId],
  )
  const selectedTableId = selectedTable?.id ?? null

  useEffect(() => {
    if (!selectedTableId || selectedTableId === requestedTableId) return
    void navigate({
      to: '/datasets',
      search: { dataset: selectedTableId },
      replace: true,
    })
  }, [navigate, requestedTableId, selectedTableId])

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
          onSelect={(dataset) => {
            void navigate({
              to: '/datasets',
              search: { dataset },
              replace: false,
            })
          }}
        />
        {selectedTable ? (
          <DatasetTabs
            key={selectedTable.id}
            table={selectedTable}
            workspaceId={workspaceId}
            userId={userId}
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
      className="flex shrink-0 flex-wrap items-center justify-between gap-3"
      aria-labelledby="datasets-title"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Database
          className="mt-0.5 size-4 shrink-0 text-violet-500"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h1
            id="datasets-title"
            className="text-base font-semibold leading-5 tracking-tight"
          >
            Dataset Explorer
          </h1>
          <p className="text-xs leading-4 text-muted-foreground">
            Browse scientific rows and preview the current dataset
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
          <DatasetPicker
            datasets={datasets}
            selectedTableId={selectedTableId}
            onSelect={onSelect}
          />
        )}
      </div>
    </header>
  )
}

interface DatasetPickerProps {
  datasets: ScientificTableWire[]
  selectedTableId: string | null
  onSelect: (id: string) => void
}

function DatasetPicker({
  datasets,
  selectedTableId,
  onSelect,
}: DatasetPickerProps) {
  const [open, setOpen] = useState(false)
  const selected = datasets.find((dataset) => dataset.id === selectedTableId)

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>Dataset</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-label="Select dataset"
            aria-expanded={open}
            className="h-7 w-56 justify-between bg-background px-2.5 text-xs font-normal"
          >
            <span className="truncate text-foreground">
              {selected?.name ?? 'Choose a dataset'}
            </span>
            <ChevronsUpDown
              className="shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <Command label="Search datasets" loop>
            <CommandInput
              aria-label="Search datasets"
              placeholder="Search datasets…"
              className="h-9 py-2 text-xs"
            />
            <CommandList className="max-h-64">
              <CommandEmpty>No datasets match your search.</CommandEmpty>
              <CommandGroup
                heading={`${formatCount(datasets.length)} ${datasets.length === 1 ? 'dataset' : 'datasets'}`}
              >
                {datasets.map((dataset) => {
                  const schema = dataset.dataset_schema
                  return (
                    <CommandItem
                      key={dataset.id}
                      value={`${dataset.name} ${schema?.name ?? ''} ${schema?.slug ?? ''}`}
                      onSelect={() => {
                        onSelect(dataset.id)
                        setOpen(false)
                      }}
                      className="py-1.5 text-xs"
                    >
                      <Check
                        className={cn(
                          'shrink-0',
                          dataset.id === selectedTableId
                            ? 'opacity-100'
                            : 'opacity-0',
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground">
                          {dataset.name}
                        </span>
                        {schema ? (
                          <span className="block truncate text-[0.65rem] text-muted-foreground">
                            {schema.name}
                          </span>
                        ) : null}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

interface DatasetTabsProps {
  table: ScientificTableWire
  workspaceId: string
  userId: string
  activeTab: 'data' | 'schema'
  onTabChange: (tab: 'data' | 'schema') => void
}

function DatasetTabs({
  table,
  workspaceId,
  userId,
  activeTab,
  onTabChange,
}: DatasetTabsProps) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => onTabChange(v as 'data' | 'schema')}
      className="relative min-h-0 flex-1 overflow-hidden"
    >
      <TabsList className="h-8 w-full justify-start gap-5 rounded-none border-b bg-transparent p-0">
        <TabsTrigger
          value="data"
          className="h-8 gap-1.5 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          <TableIcon className="size-3.5" aria-hidden="true" /> Data
        </TabsTrigger>
        <TabsTrigger
          value="schema"
          className="h-8 gap-1.5 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          <Layers className="size-3.5" aria-hidden="true" /> Schema
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="data"
        className="absolute inset-x-0 bottom-0 top-8 flex min-h-0 flex-col"
      >
        <DatasetDataTab
          table={table}
          workspaceId={workspaceId}
          userId={userId}
        />
      </TabsContent>
      <TabsContent
        value="schema"
        className="absolute inset-x-0 bottom-0 top-8 flex min-h-0 flex-col overflow-auto"
      >
        <DatasetSchemaTab table={table} />
      </TabsContent>
    </Tabs>
  )
}

// ---------------------------------------------------------------------------
// Data tab — virtualised incremental query, filters, sorting, inspector and
// a secondary resizable chart preview.
// ---------------------------------------------------------------------------

export interface DatasetDataTabProps {
  table: ScientificTableWire
  workspaceId: string
  userId: string
}

export function DatasetDataTab({
  table,
  workspaceId,
  userId,
}: DatasetDataTabProps) {
  const [query, setQuery] = useState<RegistryQuery>({
    ...DEFAULT_DATASET_QUERY,
    grouping: [],
  })
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [previewTab, setPreviewTab] = useState('preview')
  const [previewHeight, setPreviewHeight] = useState(320)
  const [layoutHeight, setLayoutHeight] = useState(640)
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const resizeRef = useRef<{
    pointerId: number
    startY: number
    startHeight: number
  } | null>(null)

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

  const rowQuery: DatasetRowQuery = {
    pageIndex: 0,
    pageSize: query.pageSize,
    sorting: query.sorting,
    filters: query.filters,
  }
  const qid = queryIdentity(rowQuery)
  const rowsQuery = useInfiniteQuery({
    queryKey: datasetExplorerQueryKeys.rows(table.id, qid),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchDatasetRowPage(
        datasetExplorerDataClient,
        table,
        { ...rowQuery, pageIndex: pageParam },
        pageParam === 0,
      ),
    getNextPageParam: (lastPage, pages) =>
      getNextDatasetPageParam(lastPage, pages, rowQuery.pageSize),
    staleTime: 0,
  })

  const rows = useMemo(() => {
    const byId = new Map<string, ScientificRowWire>()
    for (const page of rowsQuery.data?.pages ?? []) {
      for (const row of page.rows) byId.set(row.id, row)
    }
    return Array.from(byId.values())
  }, [rowsQuery.data])

  const lineageQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.lineage(table.id),
    queryFn: () => fetchDatasetLineage(datasetExplorerDataClient, table.id),
    staleTime: 30_000,
  })

  const recordId = table.record_id ?? null
  const linksQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.links(recordId ?? 'none'),
    queryFn: () => fetchLinksForRecord(notebookDataClient, recordId as string),
    enabled: Boolean(selectedRowId) && Boolean(recordId),
    staleTime: 30_000,
  })

  const fields = useMemo<DataGridField<ScientificRowWire>[]>(() => {
    const defs = toColumnDefs(table.columns)
    return table.columns.map((column, index) => ({
      id: column.field_name,
      label: column.label,
      column: defs[index],
      filter:
        index < DATASET_MAX_FILTERS
          ? {
              type: 'text',
              placeholder: 'Exact value',
              operators: [{ value: 'eq', label: 'is' }],
            }
          : undefined,
      groupable: ['category', 'text', 'reference'].includes(
        column.logical_type,
      ),
    }))
  }, [table.columns])
  const totalCount = rowsQuery.data?.pages[0]?.totalCount ?? 0
  const previewBounds = datasetPreviewBounds(layoutHeight)

  useEffect(() => setSelectedRowId(null), [qid])

  useEffect(() => {
    const layout = layoutRef.current
    if (!layout) return
    const updateLayoutHeight = () => {
      const nextHeight = layout.getBoundingClientRect().height
      if (nextHeight <= 0) return
      setLayoutHeight(nextHeight)
      const nextBounds = datasetPreviewBounds(nextHeight)
      setPreviewHeight((current) =>
        Math.min(Math.max(nextBounds.minimum, current), nextBounds.maximum),
      )
    }
    updateLayoutHeight()
    const observer = new ResizeObserver(updateLayoutHeight)
    observer.observe(layout)
    return () => observer.disconnect()
  }, [])

  function resizePreview(nextHeight: number): void {
    setPreviewHeight(
      Math.min(
        Math.max(previewBounds.minimum, nextHeight),
        previewBounds.maximum,
      ),
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={layoutRef}
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateRows: `minmax(0, 1fr) ${DATASET_SPLITTER_HEIGHT}px ${previewHeight}px`,
        }}
        data-preview-height={Math.round(previewHeight)}
      >
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <RegistryComposition
              registryId={`dataset-${table.id}`}
              title={table.name}
              hideHeader
              rows={rows}
              totalCount={totalCount}
              fields={fields}
              query={query}
              onQueryChange={setQuery}
              getRowId={(row) => row.id}
              selectedId={selectedRowId}
              onSelectedIdChange={setSelectedRowId}
              inspectorLabel="Dataset inspector"
              loading={rowsQuery.isLoading}
              error={
                rowsQuery.isLoadingError || rowsQuery.isRefetchError
                  ? rowsQuery.error
                  : null
              }
              onRetry={() => void rowsQuery.refetch()}
              incrementalRows={{
                hasMore: rowsQuery.hasNextPage,
                loadingMore: rowsQuery.isFetchingNextPage,
                onLoadMore: () =>
                  void rowsQuery.fetchNextPage({ cancelRefetch: false }),
                loadError: rowsQuery.isFetchNextPageError
                  ? rowsQuery.error
                  : undefined,
              }}
              searchDebounceMs={300}
              emptyTitle="No rows yet"
              noResultsTitle="No matching rows"
              renderInspector={(row) => (
                <DatasetInspector
                  table={table}
                  row={row}
                  formulas={lineageQuery.data?.formulas ?? []}
                  dependencies={lineageQuery.data?.dependencies ?? []}
                  links={linksQuery.data ?? []}
                  lineageLoading={lineageQuery.isLoading}
                  lineageError={lineageQuery.error}
                />
              )}
            />
          </div>
        </div>
        <div
          role="separator"
          aria-label="Resize dataset preview"
          aria-orientation="horizontal"
          aria-valuemin={Math.round(previewBounds.minimum)}
          aria-valuemax={Math.round(previewBounds.maximum)}
          aria-valuenow={Math.round(previewHeight)}
          tabIndex={0}
          className="group relative z-10 cursor-row-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onPointerDown={(event) => {
            resizeRef.current = {
              pointerId: event.pointerId,
              startY: event.clientY,
              startHeight: previewHeight,
            }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const resize = resizeRef.current
            if (!resize || resize.pointerId !== event.pointerId) return
            resizePreview(resize.startHeight + (resize.startY - event.clientY))
          }}
          onPointerUp={(event) => {
            if (resizeRef.current?.pointerId !== event.pointerId) return
            resizeRef.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => {
            resizeRef.current = null
          }}
          onDoubleClick={() => resizePreview(320)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              resizePreview(
                previewHeight + (event.key === 'ArrowUp' ? 16 : -16),
              )
            } else if (event.key === 'Home') {
              event.preventDefault()
              resizePreview(previewBounds.minimum)
            } else if (event.key === 'End') {
              event.preventDefault()
              resizePreview(previewBounds.maximum)
            }
          }}
        >
          <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
          <span className="absolute left-1/2 top-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/25 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary/60" />
        </div>
        <Tabs
          value={previewTab}
          onValueChange={setPreviewTab}
          className="h-full min-h-0"
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="flex h-9 shrink-0 items-center border-b">
              <TabsList className="h-9 gap-5 rounded-none bg-transparent p-0">
                {[
                  { value: 'preview', label: 'Chart preview' },
                  { value: 'summary', label: 'Column summary' },
                ].map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="h-9 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <TabsContent
              value="preview"
              className="m-0 min-h-0 flex-1 overflow-hidden p-3"
            >
              <ChartPreview
                table={table}
                chartSpec={chartSpec}
                onChartSpecChange={setChartSpec}
              />
            </TabsContent>
            <TabsContent
              value="summary"
              className="m-0 min-h-0 flex-1 overflow-auto p-3"
            >
              <ColumnSummary
                columns={table.columns}
                rows={rows}
                totalCount={totalCount}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  )
}

export function ColumnSummary({
  columns,
  rows,
  totalCount,
}: {
  columns: ScientificColumnWire[]
  rows: ScientificRowWire[]
  totalCount: number
}) {
  if (rows.length === 0) {
    return <EmptyHint>No rows available to summarise.</EmptyHint>
  }

  return (
    <section aria-labelledby="column-summary-title">
      <div className="mb-3">
        <h3 id="column-summary-title" className="text-sm font-semibold">
          Column summary
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Based on {formatCount(rows.length)} of {formatCount(totalCount)} rows
          in the current result.
        </p>
      </div>
      <div className="overflow-hidden rounded-md border">
        <Table aria-label="Column summary">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Field</TableHead>
              <TableHead>Complete</TableHead>
              <TableHead>Summary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {columns.map((column) => {
              const values = rows
                .map((row) => row[column.field_name])
                .filter(
                  (value) =>
                    value !== null && value !== undefined && value !== '',
                )
              const completeness = Math.round(
                (values.length / rows.length) * 100,
              )
              const numericValues = values.filter(
                (value): value is number =>
                  typeof value === 'number' && Number.isFinite(value),
              )
              let summary: string
              if (numericValues.length > 0) {
                const mean =
                  numericValues.reduce((sum, value) => sum + value, 0) /
                  numericValues.length
                summary = `Mean ${formatCount(mean)} · ${formatCount(
                  Math.min(...numericValues),
                )}–${formatCount(Math.max(...numericValues))}`
              } else {
                const unique = new Set(values.map(String)).size
                summary = `${formatCount(unique)} unique value${unique === 1 ? '' : 's'}`
              }

              return (
                <TableRow key={column.id}>
                  <TableCell className="py-1.5">
                    <span className="font-medium">{column.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {column.logical_type}
                    </span>
                  </TableCell>
                  <TableCell className="py-1.5 tabular-nums">
                    {values.length}/{rows.length} ({completeness}%)
                  </TableCell>
                  <TableCell className="py-1.5 tabular-nums">
                    {summary}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
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

function ChartPreview({ table, chartSpec }: ChartPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [plotHeight, setPlotHeight] = useState(240)
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

  const chartTitle = chartSpec
    ? `${chartSpec.display.axes.y.label} over ${chartSpec.display.axes.x.label}${
        chartSpec.fields.series
          ? ` by ${
              table.columns.find(
                (column) => column.id === chartSpec.fields.series?.columnId,
              )?.label ?? 'series'
            }`
          : ''
      }`
    : 'Chart preview'

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const updatePlotHeight = () => {
      const nextHeight = Math.max(
        100,
        container.getBoundingClientRect().height - 48,
      )
      setPlotHeight(nextHeight)
    }
    updatePlotHeight()
    const observer = new ResizeObserver(updatePlotHeight)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-col"
      data-chart-plot-height={Math.round(plotHeight)}
    >
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
          title={chartTitle}
          spec={chartSpec}
          materialised={materialised}
          frozen={null}
          loading={datasetQuery.isLoading}
          hideTitle
          plotHeight={plotHeight}
          showTableAlternative={false}
          className="h-full rounded-none border-0 bg-transparent shadow-none"
        />
      ) : null}
    </div>
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

  // Build a short label from the first text/category column, falling back to
  // a row number so the inspector title is meaningful (not a raw UUID).
  const rowTitle = useMemo(() => {
    if (!row) return 'No row selected'
    const labelCol = table.columns.find(
      (c) => c.logical_type === 'text' || c.logical_type === 'category',
    )
    if (labelCol && row[labelCol.field_name]) {
      return String(row[labelCol.field_name])
    }
    const firstCol = table.columns[0]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (firstCol && row[firstCol.field_name] != null) {
      return String(row[firstCol.field_name])
    }
    return `Row ${row.version}`
  }, [row, table.columns])

  // Show at most 3 key column values as a quick summary, not every column.
  const summaryColumns = useMemo(
    () => table.columns.slice(0, 3),
    [table.columns],
  )

  return (
    <Inspector
      recordType="Dataset row"
      title={rowTitle}
      status={
        row ? <Badge variant="success">Version {row.version}</Badge> : null
      }
      state={row ? 'loaded' : 'no-selection'}
      tabs={[
        {
          id: 'values',
          label: 'Details',
          content: row ? (
            <div className="space-y-4">
              <InspectorSection title="Row summary">
                <PropertyList>
                  {summaryColumns.map((column) => (
                    <Property
                      key={column.id}
                      label={column.label}
                      mono={['decimal', 'integer'].includes(
                        column.logical_type,
                      )}
                    >
                      {rowCellValue(row, column)}
                    </Property>
                  ))}
                </PropertyList>
              </InspectorSection>
              <InspectorSection title="Downstream uses">
                {lineageError ? (
                  <p role="alert" className="text-xs text-destructive">
                    Could not load formula usage.
                  </p>
                ) : lineageLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : rowDependencies.length === 0 ? (
                  <EmptyHint>
                    This row is not used by a calculated column
                  </EmptyHint>
                ) : (
                  <PropertyList>
                    {rowDependencies.map((dependency, index) => (
                      <Property
                        key={`${dependency.formula_id}-${index}`}
                        label={`Calculated formula ${index + 1}`}
                        stacked
                      >
                        {`Uses ${
                          table.columns.find(
                            (column) =>
                              column.id === dependency.source_column_id,
                          )?.label ?? 'a field in this dataset'
                        } as an input`}
                      </Property>
                    ))}
                  </PropertyList>
                )}
              </InspectorSection>
              <InspectorSection title="Transformations">
                {rowFormulas.length === 0 ? (
                  <EmptyHint>No calculated columns for this row</EmptyHint>
                ) : (
                  <PropertyList>
                    {rowFormulas.map((formula) => (
                      <Property
                        key={formula.id}
                        label="Calculated column"
                        mono
                        stacked
                      >
                        {formula.source_expression}
                      </Property>
                    ))}
                  </PropertyList>
                )}
              </InspectorSection>
            </div>
          ) : null,
        },
        {
          id: 'links',
          label: 'Links',
          badge: links.length,
          content: (
            <InspectorSection title="Linked records">
              <LinkedRecordList
                items={links.map((link) => ({
                  id: link.id,
                  type: link.targetKind,
                  title: link.targetIdentifier,
                  meta: link.linkType,
                }))}
              />
            </InspectorSection>
          ),
        },
      ]}
    />
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
    <div className="max-w-5xl space-y-4 py-3">
      <section aria-labelledby="dataset-structure-title">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="dataset-structure-title" className="text-sm font-semibold">
              Dataset structure
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {schemaQuery.isLoading
                ? 'Loading structure…'
                : schema
                  ? `Fields are inherited from the reusable “${schema.slug}” schema, revision ${schema.revision}.`
                  : 'Fields are defined directly in this dataset.'}
            </p>
          </div>
          {schema ? (
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
          ) : !schemaQuery.isLoading ? (
            <Badge variant="outline">Local fields</Badge>
          ) : null}
        </div>
      </section>

      <section className="border-t pt-4" aria-labelledby="dataset-fields-title">
        <h3 id="dataset-fields-title" className="text-sm font-semibold">
          Dataset fields
        </h3>
        {schemaQuery.isLoading ? (
          <Skeleton className="mt-2 h-24 w-full" />
        ) : (
          <div className="mt-2 overflow-x-auto rounded-md border">
            <Table aria-label="Dataset fields">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Label</TableHead>
                  {schema ? <TableHead>Field key</TableHead> : null}
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
                      {schema ? (
                        <TableCell className="font-mono text-xs">
                          {slug}
                        </TableCell>
                      ) : null}
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
      </section>
    </div>
  )
}

function describeUnit(unit: unknown) {
  if (!unit || typeof unit !== 'object') return '—'
  const value = unit as { symbol?: unknown; code?: unknown }
  const symbol = typeof value.symbol === 'string' ? value.symbol : null
  const code = typeof value.code === 'string' ? value.code : null
  return symbol ?? code ?? '—'
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
    queryKey: [...datasetExplorerQueryKeys.relationships, table.id],
    queryFn: () =>
      fetchDatasetRelationshipsFor(datasetExplorerDataClient, schemaId),
    enabled: Boolean(schemaId),
    staleTime: 30_000,
  })
  const lineageQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.lineage(table.id),
    queryFn: () => fetchDatasetLineage(datasetExplorerDataClient, table.id),
    staleTime: 30_000,
  })

  const relationships = relationshipsQuery.data ?? []
  const dependencies = lineageQuery.data?.dependencies ?? []
  const formulas = lineageQuery.data?.formulas ?? []

  if (relationshipsQuery.isLoading || lineageQuery.isLoading) {
    return <Skeleton className="h-32 w-full" />
  }
  if (relationshipsQuery.error || lineageQuery.error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
      >
        Could not load relationships.
      </div>
    )
  }
  if (
    relationships.length === 0 &&
    dependencies.length === 0 &&
    formulas.length === 0
  ) {
    return (
      <div className="max-w-3xl px-1 py-3">
        <InspectorSection title="Column relationships">
          <EmptyHint>
            This dataset has no relationships defined. Relationships are created
            when you join columns or add calculated columns that reference other
            datasets.
          </EmptyHint>
        </InspectorSection>
      </div>
    )
  }
  return (
    <div className="max-w-3xl space-y-4 px-1 py-3">
      <div className="space-y-4">
        <InspectorSection title="Joined datasets">
          <LinkedRecordList
            items={relationships.map((relationship) => ({
              id: relationship.id,
              type: relationship.relationship_type.replaceAll('_', ' '),
              title: relationship.label || 'Schema relationship',
              meta: `${relationship.cardinality.replaceAll('_', ' ')} · ${formatRelativeTime(relationship.created_at)}`,
            }))}
          />
        </InspectorSection>
        <InspectorSection title="Calculated column dependencies">
          <LinkedRecordList
            items={dependencies.map((dependency, index) => ({
              id: `${dependency.formula_id}-${index}`,
              type: 'Calculated column dependency',
              title: `Input ${index + 1}`,
              meta: 'Cross-dataset source',
            }))}
          />
        </InspectorSection>
        <InspectorSection title="Relationship summary">
          <PropertyList>
            <Property label="Schema joins">{relationships.length}</Property>
            <Property label="Calculated columns">{formulas.length}</Property>
            <Property label="Cross-dataset dependencies">
              {dependencies.length}
            </Property>
          </PropertyList>
        </InspectorSection>
      </div>
    </div>
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
      <div className="max-w-3xl px-1 py-3">
        <InspectorSection title="Transformation lineage">
          <EmptyHint>
            No transformations applied yet. Formula calculations and column
            transforms will appear here.
          </EmptyHint>
        </InspectorSection>
      </div>
    )
  }
  return (
    <div className="max-w-3xl space-y-4 px-1 py-3">
      <div className="space-y-4">
        <InspectorSection title={`Transformations (${formulas.length})`}>
          {formulas.length === 0 ? (
            <EmptyHint>No formula calculations</EmptyHint>
          ) : (
            <PropertyList>
              {formulas.map((f) => (
                <Property key={f.id} label="Formula calculation" mono stacked>
                  {f.source_expression}
                </Property>
              ))}
            </PropertyList>
          )}
        </InspectorSection>
        <InspectorSection
          title={`Cross-dataset dependencies (${dependencies.length})`}
        >
          {dependencies.length === 0 ? (
            <EmptyHint>No cross-dataset dependencies</EmptyHint>
          ) : (
            <LinkedRecordList
              items={dependencies.map((dependency, index) => ({
                id: `${dependency.formula_id}-${index}`,
                type: 'Formula input',
                title: `Input ${index + 1}`,
                meta: 'Cross-dataset source',
              }))}
            />
          )}
        </InspectorSection>
      </div>
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
