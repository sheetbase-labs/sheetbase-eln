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
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { flexRender } from '@tanstack/react-table'
import type { ColumnDef, useReactTable } from '@tanstack/react-table'
import {
  Check,
  Columns3,
  Database,
  Download,
  Filter,
  GitBranch,
  Group,
  Layers,
  LineChart,
  Plus,
  Save,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Table as TableIcon,
  Trash2,
  Undo2,
  Workflow,
} from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { RegistryComposition } from '#/components/registry'
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
  ButtonGroup,
  Card,
  Field,
  FieldLabel,
  Input,
  Select,
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
  DATASET_QUERY_HARD_LIMIT,
  datasetExplorerDataClient,
  datasetExplorerQueryKeys,
  fetchDatasetLineage,
  fetchDatasetRelationshipsFor,
  fetchDatasetRowPage,
  fetchDatasetSchemaDetail,
  fetchDatasetSummaries,
  validateTransformations,
} from '#/lib/dataset-explorer-data'
import type {
  DatasetDensity,
  DatasetRowQuery,
  DatasetSavedViewStore,
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
import type { RegistryQuery } from '#/lib/registry'
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
            registryFormat: {
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
            Query, transform and visualise scientific dataset rows.
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
  /** Retained for compatibility with persisted DATA-007 views. */
  viewStore?: DatasetSavedViewStore
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

  useEffect(() => {
    setQuery({ ...DEFAULT_DATASET_QUERY, grouping: [] })
    setSelectedRowId(null)
    setChartSpec(buildDefaultChartSpec(table))
  }, [table])

  const rowQuery: DatasetRowQuery = {
    pageIndex: query.pageIndex,
    pageSize: query.pageSize,
    sorting: query.sorting,
    filters: query.filters,
  }
  const qid = queryIdentity(rowQuery)
  const rowsQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.rows(table.id, qid),
    queryFn: () =>
      fetchDatasetRowPage(datasetExplorerDataClient, table, rowQuery),
    placeholderData: (prev) => prev,
    staleTime: 0,
  })

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

  const relationshipsQuery = useQuery({
    queryKey: [...datasetExplorerQueryKeys.relationships, table.id],
    queryFn: () =>
      fetchDatasetRelationshipsFor(
        datasetExplorerDataClient,
        table.dataset_schema_id ?? null,
      ),
    enabled: Boolean(table.dataset_schema_id),
    staleTime: 30_000,
  })

  const columns = useMemo(() => toColumnDefs(table.columns), [table.columns])
  const filterDefinitions = table.columns
    .slice(0, DATASET_MAX_FILTERS)
    .map((column) => ({
      id: column.field_name,
      label: column.label,
      placeholder: `Filter ${column.label}`,
    }))
  const groupingOptions = table.columns
    .filter((column) =>
      ['category', 'text', 'reference'].includes(column.logical_type),
    )
    .map((column) => ({ id: column.field_name, label: column.label }))
  const formulaCount = lineageQuery.data?.formulas.length ?? 0
  const visibleFieldCount = table.columns.length
  const totalCount = rowsQuery.data?.totalCount ?? 0
  const startRow = totalCount === 0 ? 0 : query.pageIndex * query.pageSize + 1
  const endRow = Math.min((query.pageIndex + 1) * query.pageSize, totalCount)

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
      <TransformationToolbar
        table={table}
        query={query}
        onQueryChange={setQuery}
        joins={relationshipsQuery.data?.length ?? 0}
        calculations={formulaCount}
      />
      <FormulaBar table={table} />
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="min-h-0 flex-1 overflow-hidden">
            <RegistryComposition
              registryId={`dataset-${table.id}`}
              workspaceId={workspaceId}
              userId={userId}
              title={table.name}
              description="Query, transform and visualise scientific dataset rows."
              rows={rowsQuery.data?.rows ?? []}
              totalCount={totalCount}
              columns={columns}
              query={query}
              onQueryChange={setQuery}
              getRowId={(row) => row.id}
              selectedId={selectedRowId}
              onSelectedIdChange={setSelectedRowId}
              filterDefinitions={filterDefinitions}
              groupingOptions={groupingOptions}
              initialDensity="compact"
              inspectorLabel="Dataset inspector"
              loading={rowsQuery.isLoading}
              error={rowsQuery.error}
              emptyTitle="No rows yet"
              noResultsTitle="No matching rows"
              actions={
                <ButtonGroup>
                  <Button variant="outline" size="sm">
                    <Plus /> New
                  </Button>
                  <Button variant="outline" size="sm">
                    <Save /> Save view
                  </Button>
                  <Button variant="outline" size="sm">
                    <Share2 /> Share
                  </Button>
                </ButtonGroup>
              }
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
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
            <span>
              Showing {formatCount(startRow)} to {formatCount(endRow)} of{' '}
              {formatCount(totalCount)} rows
            </span>
            <span className="flex flex-wrap items-center gap-3">
              <span>{formatCount(totalCount)} rows</span>
              <span>{visibleFieldCount} columns</span>
              <span>No unsaved changes</span>
              {totalCount >= DATASET_QUERY_HARD_LIMIT ? (
                <Badge variant="warning">Server limit reached</Badge>
              ) : null}
            </span>
          </div>
        </div>
        <Tabs
          value={previewTab}
          onValueChange={setPreviewTab}
          className="min-h-0"
        >
          <Card className="flex min-h-0 flex-col overflow-hidden p-0">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3">
              <TabsList className="h-9 bg-transparent p-0">
                {['Preview', 'Summary', 'Distribution', 'Correlations'].map(
                  (label) => (
                    <TabsTrigger key={label} value={label.toLowerCase()}>
                      {label}
                    </TabsTrigger>
                  ),
                )}
              </TabsList>
              <ButtonGroup>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Export chart"
                >
                  <Download />
                </Button>
              </ButtonGroup>
            </div>
            <TabsContent
              value="preview"
              className="m-0 min-h-0 flex-1 overflow-auto p-3"
            >
              <ChartPreview
                table={table}
                chartSpec={chartSpec}
                onChartSpecChange={setChartSpec}
              />
            </TabsContent>
            <TabsContent
              value="summary"
              className="m-0 min-h-0 flex-1 overflow-auto p-6"
            >
              <PreviewExplanation
                title="Column summary"
                copy="Review completeness, central tendency and spread for each visible field."
              />
            </TabsContent>
            <TabsContent
              value="distribution"
              className="m-0 min-h-0 flex-1 overflow-auto p-6"
            >
              <PreviewExplanation
                title="Distribution"
                copy="Select a numeric field to inspect its histogram and outliers."
              />
            </TabsContent>
            <TabsContent
              value="correlations"
              className="m-0 min-h-0 flex-1 overflow-auto p-6"
            >
              <PreviewExplanation
                title="Correlations"
                copy="Compare numeric fields to identify relationships in this view."
              />
            </TabsContent>
          </Card>
        </Tabs>
      </div>
    </div>
  )
}

function TransformationToolbar({
  table,
  query,
  onQueryChange,
  joins,
  calculations,
}: {
  table: ScientificTableWire
  query: RegistryQuery
  onQueryChange: (query: RegistryQuery) => void
  joins: number
  calculations: number
}) {
  const batch = table.columns.find((column) => /batch/i.test(column.label))
  const time = table.columns.find((column) => /time/i.test(column.label))
  const controls = [
    { label: 'Filters', count: query.filters.length, icon: Filter },
    {
      label: `Group by ${batch?.label ?? 'field'}`,
      count: query.grouping.length,
      icon: Group,
    },
    {
      label: `Sort ${time?.label ?? 'field'}`,
      count: query.sorting.length,
      icon: SlidersHorizontal,
    },
    { label: 'Fields', count: table.columns.length, icon: Columns3 },
    { label: 'Joins', count: joins, icon: Workflow },
    { label: 'Calculations', count: calculations, icon: Sparkles },
  ]
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-card p-2">
      {controls.map(({ label, count, icon: Icon }) => (
        <Button
          key={label}
          variant="outline"
          size="sm"
          onClick={() => {
            if (label.startsWith('Group') && batch) {
              onQueryChange({ ...query, grouping: [batch.field_name] })
            }
            if (label.startsWith('Sort') && time) {
              onQueryChange({
                ...query,
                sorting: [{ id: time.field_name, desc: false }],
              })
            }
          }}
        >
          <Icon /> {label}
          <Badge variant={count > 0 ? 'secondary' : 'outline'}>{count}</Badge>
        </Button>
      ))}
      <span className="relative ml-auto min-w-44">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search dataset"
          placeholder="Search"
          className="h-8 pl-7 text-xs"
        />
      </span>
    </div>
  )
}

function FormulaBar({ table }: { table: ScientificTableWire }) {
  const defaultFormula =
    'Titer (TU/mL) = [Vector genome (copies/mL)] / [Volume (mL)]'
  const [formula, setFormula] = useState(defaultFormula)
  const valid =
    formula.includes('=') &&
    formula.includes('/') &&
    (formula.match(/\[/g)?.length ?? 0) === (formula.match(/\]/g)?.length ?? 0)
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2"
      aria-label="Calculated column formula"
    >
      <span className="font-mono text-xs font-semibold text-violet-600">
        fx
      </span>
      <Input
        aria-label="Formula expression"
        value={formula}
        onChange={(event) => setFormula(event.target.value)}
        className="h-8 min-w-80 flex-1 font-mono text-xs"
      />
      <Badge variant={valid ? 'success' : 'danger'}>
        {valid ? <Check /> : null} {valid ? 'Valid' : 'Check formula'}
      </Badge>
      <ButtonGroup>
        <Button size="sm" disabled={!valid}>
          Apply
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFormula(defaultFormula)}
        >
          <Undo2 /> Undo
        </Button>
        <Button variant="outline" size="sm" onClick={() => setFormula('')}>
          Clear
        </Button>
      </ButtonGroup>
      <span className="sr-only">Formula applies to {table.name}</span>
    </div>
  )
}

function PreviewExplanation({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center text-center">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">{copy}</p>
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

  function setX(columnId: string) {
    const column = table.columns.find((c) => c.id === columnId)
    if (!chartSpec || !column) return
    onChartSpecChange({
      ...chartSpec,
      fields: {
        ...chartSpec.fields,
        x: { columnId, fieldName: column.field_name },
      },
      display: {
        ...chartSpec.display,
        axes: {
          ...chartSpec.display.axes,
          x: { ...chartSpec.display.axes.x, label: column.label },
        },
      },
    })
  }

  function setType(type: ChartType) {
    if (!chartSpec) return
    onChartSpecChange({ ...chartSpec, type })
  }

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

  return (
    <div className="flex min-h-64 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <LineChart className="size-4 text-violet-500" aria-hidden="true" />
            {chartTitle}
          </div>
          <p className="ml-5 text-xs text-muted-foreground">Mean ± SD</p>
        </div>
        {chartSpec ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-28 gap-1">
              <FieldLabel htmlFor="dataset-chart-type">Chart type</FieldLabel>
              <Select
                id="dataset-chart-type"
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
            </Field>
            <Field className="w-36 gap-1">
              <FieldLabel htmlFor="dataset-chart-x">X axis</FieldLabel>
              <Select
                id="dataset-chart-x"
                value={chartSpec.fields.x?.columnId ?? ''}
                onChange={(e) => setX(e.target.value)}
                className="h-8 bg-background"
              >
                {table.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field className="w-36 gap-1">
              <FieldLabel htmlFor="dataset-chart-y">Y axis</FieldLabel>
              <Select
                id="dataset-chart-y"
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
            </Field>
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
          title={chartTitle}
          spec={chartSpec}
          materialised={materialised}
          frozen={null}
          loading={datasetQuery.isLoading}
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
              <InspectorSection title="Lineage">
                {lineageError ? (
                  <p role="alert" className="text-xs text-destructive">
                    Could not load lineage.
                  </p>
                ) : lineageLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : rowDependencies.length === 0 ? (
                  <EmptyHint>No upstream dependencies for this row</EmptyHint>
                ) : (
                  <PropertyList>
                    {rowDependencies.map((dependency, index) => (
                      <Property
                        key={`${dependency.formula_id}-${index}`}
                        label="Derived from"
                        mono
                        stacked
                      >
                        {`${dependency.source_table_id}/${dependency.source_row_id}/${dependency.source_column_id}`}
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
        {
          id: 'export',
          label: 'Export',
          content: (
            <div className="space-y-4">
              <InspectorSection title="Export this view">
                <div className="grid gap-2">
                  <Button className="w-full" variant="outline">
                    <Download /> Export CSV
                  </Button>
                  <Button className="w-full" variant="outline">
                    <Download /> Export Parquet
                  </Button>
                </div>
              </InspectorSection>
              <InspectorSection title="About this dataset">
                <PropertyList>
                  <Property label="Dataset" stacked>
                    {table.name}
                  </Property>
                  <Property label="Sharing">Workspace members</Property>
                </PropertyList>
              </InspectorSection>
            </div>
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
      <Card className="p-4">
        <InspectorSection title="Column relationships">
          <EmptyHint>
            This dataset has no relationships defined. Relationships are created
            when you join columns or add calculated columns that reference other
            datasets.
          </EmptyHint>
        </InspectorSection>
      </Card>
    )
  }
  return (
    <Card className="p-4">
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
              title: `Column ${dependency.source_column_id.slice(0, 8)}`,
              meta: `Dataset ${dependency.source_table_id.slice(0, 8)} · row ${dependency.source_row_id.slice(0, 8)}`,
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
      <Card className="p-4">
        <InspectorSection title="Transformation lineage">
          <EmptyHint>
            No transformations applied yet. Formula calculations and column
            transforms will appear here.
          </EmptyHint>
        </InspectorSection>
      </Card>
    )
  }
  return (
    <Card className="p-4">
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
                title: `Column ${dependency.source_column_id.slice(0, 8)}`,
                meta: `Dataset ${dependency.source_table_id.slice(0, 8)} · row ${dependency.source_row_id.slice(0, 8)}`,
              }))}
            />
          )}
        </InspectorSection>
      </div>
    </Card>
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
