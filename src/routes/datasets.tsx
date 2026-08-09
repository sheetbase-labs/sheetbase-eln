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
import type { ColumnDef } from '@tanstack/react-table'
import {
  Database,
  GitBranch,
  Layers,
  LineChart,
  Table as TableIcon,
  Trash2,
  Workflow,
} from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { RegistryComposition } from '#/components/registry/registry-composition'
import { Inspector } from '#/components/record/inspector'
import {
  InspectorSection,
  LinkedRecordList,
  Property,
  PropertyList,
} from '#/components/record/inspector-sections'
import { StatusBadge } from '#/components/scientific/status-badge'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import {
  Badge,
  Card,
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
  DATASET_DEFAULT_PAGE_SIZE,
  DATASET_MAX_FILTERS,
  datasetExplorerDataClient,
  datasetExplorerQueryKeys,
  fetchDatasetLineage,
  fetchDatasetRelationshipsFor,
  fetchDatasetRowPage,
  fetchDatasetSchemaDetail,
  fetchDatasetSummaries,
  validateTransformations,
} from '#/lib/dataset-explorer-data'
import type { DatasetRowQuery } from '#/lib/dataset-explorer-data'
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
  grouping: [],
  filters: [],
}

function queryIdentity(query: DatasetRowQuery): string {
  return [
    query.pageIndex,
    query.pageSize,
    query.sorting.map((s) => `${s.id}:${s.desc}`).join(','),
    query.grouping.join(','),
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

/**
 * Keep the identifier and the first scientific measurements visible in the
 * constrained data plane. Remaining fields are deliberately progressive at
 * narrower widths; they remain available through the Columns control and the
 * selected-row inspector.
 */
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
      className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-1 pb-3"
      aria-labelledby="datasets-title"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Database className="size-5 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <h1
            id="datasets-title"
            className="text-lg font-semibold tracking-tight"
          >
            Dataset Explorer
          </h1>
          <p className="max-w-[34rem] truncate text-xs text-muted-foreground">
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
  activeTab: 'data' | 'schema' | 'relationships' | 'lineage'
  onTabChange: (tab: 'data' | 'schema' | 'relationships' | 'lineage') => void
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
}

export function DatasetDataTab({
  table,
  workspaceId,
  userId,
}: DatasetDataTabProps) {
  const [query, setQuery] = useState<DatasetRowQuery>(DEFAULT_DATASET_QUERY)
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)

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
      // Ignore corrupt persisted specifications.
    }
    return buildDefaultChartSpec(table)
  })
  useEffect(() => {
    setQuery(DEFAULT_DATASET_QUERY)
    setSelectedRowId(null)
    setInspectorOpen(false)
    setChartSpec(buildDefaultChartSpec(table))
  }, [table.id])
  useEffect(() => {
    try {
      if (chartSpec)
        window.localStorage.setItem(chartStorageKey, JSON.stringify(chartSpec))
      else window.localStorage.removeItem(chartStorageKey)
    } catch {
      /* Preview remains available when storage is unavailable. */
    }
  }, [chartSpec, chartStorageKey])

  const rowsQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.rows(table.id, queryIdentity(query)),
    queryFn: () => fetchDatasetRowPage(datasetExplorerDataClient, table, query),
    placeholderData: (previous) => previous,
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
    queryFn: () => fetchLinksForRecord(notebookDataClient, recordId!),
    enabled: Boolean(selectedRowId) && Boolean(recordId),
    staleTime: 30_000,
  })
  const columns = useMemo(() => toColumnDefs(table.columns), [table.columns])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <RegistryComposition
        registryId={`dataset-${table.id}`}
        workspaceId={workspaceId}
        userId={userId}
        title={table.name}
        description="Dataset rows"
        rows={rowsQuery.data?.rows ?? []}
        totalCount={rowsQuery.data?.totalCount ?? 0}
        columns={columns}
        query={query}
        onQueryChange={setQuery}
        getRowId={(row) => row.id}
        selectedId={selectedRowId}
        onSelectedIdChange={setSelectedRowId}
        filterDefinitions={table.columns
          .slice(0, DATASET_MAX_FILTERS)
          .map((column) => ({
            id: column.field_name,
            label: column.label,
            placeholder: `Filter ${column.label}`,
          }))}
        inspectorLabel="Dataset inspector"
        inspectorOpen={inspectorOpen}
        onInspectorOpenChange={(open) => {
          setInspectorOpen(open)
          if (!open) setSelectedRowId(null)
        }}
        renderInspector={(row) => (
          <DatasetInspector
            table={table}
            row={row}
            formulas={lineageQuery.data?.formulas ?? []}
            dependencies={lineageQuery.data?.dependencies ?? []}
            links={linksQuery.data ?? []}
            lineageLoading={lineageQuery.isLoading}
            lineageError={lineageQuery.error}
            onClose={() => {
              setSelectedRowId(null)
              setInspectorOpen(false)
            }}
          />
        )}
        loading={rowsQuery.isLoading}
        error={rowsQuery.error}
        emptyTitle="No rows yet"
        noResultsTitle="No matching rows"
      />
      <div className="hidden shrink-0 xl:block">
        <ChartPreview
          table={table}
          chartSpec={chartSpec}
          onChartSpecChange={setChartSpec}
        />
      </div>
    </div>
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
  onClose?: () => void
}

export function DatasetInspector({
  table,
  row,
  formulas,
  dependencies,
  links,
  lineageLoading,
  lineageError,
  onClose,
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
    <Inspector
      recordType="Dataset row"
      title={row ? `Version ${row.version}` : 'Selected row'}
      onClose={onClose}
      tabs={[
        {
          id: 'values',
          label: 'Values',
          content: !row ? (
            <p className="text-xs text-muted-foreground">
              Select a row to inspect its values, lineage and linked records.
            </p>
          ) : (
            <PropertyList>
              <Property label="Row ID" mono stacked>
                {row.id}
              </Property>
              <Property label="Version">
                <span className="tabular-nums">{row.version}</span>
              </Property>
              {table.columns.map((column) => (
                <Property key={column.id} label={column.label} stacked>
                  {rowCellValue(row, column)}
                </Property>
              ))}
            </PropertyList>
          ),
        },
        {
          id: 'lineage',
          label: 'Lineage',
          content: (
            <InspectorSection title="Transformations">
              {lineageError ? (
                <p role="alert" className="text-xs text-destructive">
                  Could not load lineage.
                </p>
              ) : lineageLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : rowFormulas.length === 0 && rowDependencies.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No calculated columns or cross-sheet dependencies touch this
                  row.
                </p>
              ) : (
                <ul className="space-y-2">
                  {rowFormulas.map((formula) => (
                    <li
                      key={formula.id}
                      className="rounded-md border border-border px-2 py-1.5 text-xs"
                    >
                      <p className="break-all font-medium">
                        {formula.source_expression}
                      </p>
                      <p className="text-muted-foreground">
                        status: {formula.status} · engine{' '}
                        {formula.engine_version}
                      </p>
                    </li>
                  ))}
                  {rowDependencies.map((dependency, index) => (
                    <li
                      key={`${dependency.formula_id}-${index}`}
                      className="rounded-md border border-border px-2 py-1.5 text-xs"
                    >
                      <p className="font-medium">Cross-sheet dependency</p>
                      <p className="text-muted-foreground">
                        source column {dependency.source_column_id.slice(0, 8)}{' '}
                        → formula {dependency.formula_id.slice(0, 8)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </InspectorSection>
          ),
        },
        {
          id: 'links',
          label: 'Links',
          badge: links.length,
          content: (
            <InspectorSection title="Linked records">
              {links.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No outgoing record links from this dataset.
                </p>
              ) : (
                <LinkedRecordList
                  items={links.map((link) => ({
                    id: link.id,
                    type: link.targetKind,
                    title: link.targetIdentifier,
                    meta: link.linkType,
                  }))}
                />
              )}
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
