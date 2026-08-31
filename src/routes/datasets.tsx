/**
 * PC-02 Dataset product route (`/datasets`).
 *
 * Catalogue, Schema selection, live edit through `commit_dataset_row_batch`,
 * immutable Versions, query/filter/sort/page, dependency inspection, and
 * deep links into existing Sheet routes. PostgreSQL and RLS remain
 * authoritative; this UI does not add a second Dataset writer.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { flexRender } from '@tanstack/react-table'
import type { ColumnDef, useReactTable } from '@tanstack/react-table'
import {
  BarChart3,
  Check,
  ChevronsUpDown,
  Database,
  History,
  Layers,
  Table as TableIcon,
  Workflow,
} from 'lucide-react'

import { ExportMenu } from '#/components/export/export-menu'
import { useShell } from '#/components/app-shell'
import { PipelineDatasetTab } from '#/components/pipelines/pipeline-dataset-tab'
import {
  CollaborationRoom,
  safeBuildRoomId,
} from '#/components/collaboration/collaboration-room'
import { ThreadPanel } from '#/components/collaboration/thread-panel'
import { PresenceStack } from '#/components/collaboration/presence-avatars'
import { useCollaborationEnabled } from '#/lib/collaboration/liveblocks.config'
import { canCommentInRoom } from '#/lib/collaboration/permissions'
import { DatasetProductActions } from '#/components/datasets/dataset-product-controls'
import { ObjectHistoryTimeline } from '#/components/audit'
import { auditHistoryDataClient, fetchAuditEvents } from '#/lib/audit-history'
import { DataClientError } from '#/lib/data-client'
import { useRecentViewTracking } from '#/lib/recents'
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
import { ChartConfigurator } from '#/components/viz/chart-configurator'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import {
  Badge,
  Button,
  Input,
  Label,
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
import {
  materialiseLiveChart,
  toCanonicalDatasetSource,
  useLiveChartDataset,
} from '#/lib/chart-data'
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
  fetchDatasetSummaries,
  getNextDatasetPageParam,
  validateTransformations,
} from '#/lib/dataset-explorer-data'
import type {
  CanonicalDatasetWire,
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
import type { ChartSpec } from '#/lib/chart-spec'
import type { RegistryQuery } from '#/lib/registry'
import { cn } from '#/lib/utils'
import {
  coerceDatasetCellValue,
  columnsForPinnedSchemaVersion,
  commitDatasetRowBatch,
  datasetRevision,
  describeDatasetCommitError,
  fetchDatasetDependencies,
  listDatasetVersions,
  queryDatasetVersionRows,
  sheetLinksFromDependencies,
} from '#/lib/dataset-product'
import { listCanonicalDatasetSchemaVersionFields } from '#/lib/dataset-schema-definition-rpc'

export const Route = createFileRoute('/datasets')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    dataset: string
    archived: boolean
    tab?: 'pipelines' | 'versions'
  } => ({
    dataset: typeof search.dataset === 'string' ? search.dataset : '',
    archived: search.archived === '1' || search.archived === true,
    tab:
      search.tab === 'pipelines'
        ? 'pipelines'
        : search.tab === 'versions'
          ? 'versions'
          : undefined,
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
  const queryClient = useQueryClient()

  // FIND-01: a selected dataset counts as a "view" for the Recent surface;
  // browsing the explorer without a selection (empty search param) does not.
  useRecentViewTracking('dataset', search.dataset || null)

  const summariesQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.summaries(search.archived),
    queryFn: () =>
      fetchDatasetSummaries(datasetExplorerDataClient, {
        includeArchived: search.archived,
      }),
    staleTime: 30_000,
  })

  const datasets = summariesQuery.data ?? []
  const [activeTab, setActiveTab] = useState<
    'data' | 'chart' | 'schema' | 'versions' | 'history' | 'pipelines'
  >(
    search.tab === 'pipelines'
      ? 'pipelines'
      : search.tab === 'versions'
        ? 'versions'
        : 'data',
  )

  const requestedTableId = search.dataset || null
  const selectedTable = useMemo(
    () =>
      datasets.find((dataset) => dataset.id === requestedTableId) ||
      datasets.at(0) ||
      null,
    [datasets, requestedTableId],
  )
  const selectedTableId = selectedTable?.id ?? null

  function selectDataset(dataset: string) {
    void navigate({
      to: '/datasets',
      search: { dataset, archived: search.archived },
      replace: false,
    })
  }

  useEffect(() => {
    if (!selectedTableId || selectedTableId === requestedTableId) return
    void navigate({
      to: '/datasets',
      search: { dataset: selectedTableId, archived: search.archived },
      replace: true,
    })
  }, [navigate, requestedTableId, search.archived, selectedTableId])

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  // COLLAB-02: one dataset room per selected dataset; null when the
  // deployment has collaboration disabled or there is no workspace.
  const collaborationEnabled = useCollaborationEnabled()
  const collaborationRoomId =
    collaborationEnabled && selectedTableId
      ? safeBuildRoomId(context.workspace?.id, 'dataset', selectedTableId)
      : null

  useShell({
    context: shellContext,
    breadcrumbs: [
      { label: 'Home', to: '/' },
      { label: 'Datasets', to: '/datasets' },
      // NAV-02: the selected dataset is context, resolved from the stable
      // `?dataset=` ID — never from browser history.
      ...(selectedTable ? [{ label: selectedTable.name }] : []),
    ],
    fullBleed: true,
  })

  function refreshDatasets() {
    void queryClient.invalidateQueries({
      queryKey: ['dataset-explorer-summaries'],
    })
    if (selectedTableId) {
      void queryClient.invalidateQueries({
        queryKey: datasetExplorerQueryKeys.rows(selectedTableId, ''),
        exact: false,
      })
      void queryClient.invalidateQueries({
        queryKey: datasetExplorerQueryKeys.versions(selectedTableId),
      })
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
        <DatasetExplorerHeader
          datasets={datasets}
          loading={summariesQuery.isLoading}
          error={summariesQuery.error}
          selectedTableId={selectedTableId}
          includeArchived={search.archived}
          onToggleArchived={(archived) => {
            void navigate({
              to: '/datasets',
              search: { dataset: selectedTableId ?? '', archived },
              replace: false,
            })
          }}
          onSelect={selectDataset}
          actions={
            <DatasetProductActions
              table={selectedTable}
              client={datasetExplorerDataClient}
              archived={selectedTable?.lifecycle === 'archived'}
              workspaceId={context.workspace?.id ?? ''}
              onRefresh={refreshDatasets}
              onCreate={selectDataset}
            />
          }
        />
        {selectedTable ? (
          // COLLAB-02: the whole detail area (tabs + inspector) lives inside
          // the dataset room; CollaborationRoom renders children unchanged
          // until the provider is ready, so SSR markup is unaffected.
          <CollaborationRoom roomId={collaborationRoomId}>
            {/* COLLAB-01: who else is in this dataset's room. Renders null
                before the room mounts and when nobody else is present. */}
            <PresenceStack className="justify-end pb-1" />
            <DatasetTabs
              key={selectedTable.id}
              table={selectedTable}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onRefresh={refreshDatasets}
              collaborationWorkspaceId={
                collaborationEnabled ? (context.workspace?.id ?? null) : null
              }
              collaborationRole={context.workspace?.role ?? 'viewer'}
            />
          </CollaborationRoom>
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
  datasets: CanonicalDatasetWire[]
  loading: boolean
  error: unknown
  selectedTableId: string | null
  includeArchived: boolean
  onToggleArchived: (archived: boolean) => void
  onSelect: (id: string) => void
  actions?: ReactNode
}

export function DatasetExplorerHeader({
  datasets,
  loading,
  error,
  selectedTableId,
  includeArchived,
  onToggleArchived,
  onSelect,
  actions,
}: DatasetExplorerHeaderProps) {
  const selected = datasets.find((dataset) => dataset.id === selectedTableId)
  const fieldCount = selected?.columns.length ?? 0

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
          <p className="text-[0.65rem] font-semibold uppercase leading-4 tracking-wide text-muted-foreground">
            Datasets
          </p>
          <h1
            id="datasets-title"
            className="truncate text-base font-semibold leading-5 tracking-tight"
          >
            {selected?.name ?? 'Scientific datasets'}
          </h1>
          <p className="text-xs leading-4 text-muted-foreground">
            {selected
              ? `${formatCount(fieldCount)} ${fieldCount === 1 ? 'field' : 'fields'}${selected.dataset_schema ? ` · ${selected.dataset_schema.name} v${selected.schema_version}` : ''}${selected.lifecycle === 'archived' ? ' · archived' : ' · live'}`
              : 'Create, query and snapshot governed Datasets'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        <Button
          size="sm"
          variant={includeArchived ? 'secondary' : 'outline'}
          onClick={() => onToggleArchived(!includeArchived)}
        >
          {includeArchived ? 'Hiding archived' : 'Show archived'}
        </Button>
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
              Browse {formatCount(datasets.length)}{' '}
              {datasets.length === 1 ? 'dataset' : 'datasets'}
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
  table: CanonicalDatasetWire
  activeTab: 'data' | 'chart' | 'schema' | 'versions' | 'history' | 'pipelines'
  onTabChange: (
    tab: 'data' | 'chart' | 'schema' | 'versions' | 'history' | 'pipelines',
  ) => void
  onRefresh: () => void
  /** COLLAB-02: canonical workspace id; null disables dataset discussion. */
  collaborationWorkspaceId?: string | null
  /** COLLAB-02: workspace role hint for the discussion composer. */
  collaborationRole?: string
}

function DatasetTabs({
  table,
  activeTab,
  onTabChange,
  onRefresh,
  collaborationWorkspaceId,
  collaborationRole = 'viewer',
}: DatasetTabsProps) {
  const workspaceId = collaborationWorkspaceId ?? ''
  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) =>
        onTabChange(
          v as
            'data' | 'chart' | 'schema' | 'versions' | 'history' | 'pipelines',
        )
      }
      className="relative min-h-0 flex-1 overflow-hidden"
    >
      <TabsList className="h-8 w-full justify-start gap-5 rounded-none border-b bg-transparent p-0">
        <TabsTrigger
          value="data"
          className="h-8 gap-1.5 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          <TableIcon className="size-3.5" aria-hidden="true" /> Live data
        </TabsTrigger>
        <TabsTrigger
          value="versions"
          className="h-8 gap-1.5 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          <Layers className="size-3.5" aria-hidden="true" /> Versions
        </TabsTrigger>
        <TabsTrigger
          value="schema"
          className="h-8 gap-1.5 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          <Layers className="size-3.5" aria-hidden="true" /> Schema
        </TabsTrigger>
        <TabsTrigger
          value="chart"
          className="h-8 gap-1.5 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          <BarChart3 className="size-3.5" aria-hidden="true" /> Chart
        </TabsTrigger>
        <TabsTrigger
          value="history"
          className="h-8 gap-1.5 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          <History className="size-3.5" aria-hidden="true" /> History
        </TabsTrigger>
        <TabsTrigger
          value="pipelines"
          className="h-8 gap-1.5 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          <Workflow className="size-3.5" aria-hidden="true" /> Pipelines
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="data"
        className="absolute inset-x-0 bottom-0 top-8 flex min-h-0 flex-col"
      >
        <DatasetDataTab
          table={table}
          onRefresh={onRefresh}
          collaborationWorkspaceId={collaborationWorkspaceId}
          collaborationRole={collaborationRole}
        />
      </TabsContent>
      <TabsContent
        value="versions"
        className="absolute inset-x-0 bottom-0 top-8 min-h-0 overflow-auto p-3"
      >
        <DatasetVersionsTab table={table} />
      </TabsContent>
      <TabsContent
        value="schema"
        className="absolute inset-x-0 bottom-0 top-8 flex min-h-0 flex-col overflow-auto"
      >
        <DatasetSchemaTab table={table} />
      </TabsContent>
      <TabsContent
        value="chart"
        className="absolute inset-x-0 bottom-0 top-8 min-h-0 overflow-hidden p-3"
      >
        <UnsupportedCanonicalView name="Chart" />
      </TabsContent>
      <TabsContent
        value="history"
        className="absolute inset-x-0 bottom-0 top-8 min-h-0 overflow-auto p-3"
      >
        <DatasetHistoryTab datasetId={table.id} />
      </TabsContent>
      <TabsContent
        value="pipelines"
        className="absolute inset-x-0 bottom-0 top-8 min-h-0 overflow-auto p-3"
      >
        <PipelineDatasetTab
          dataClient={datasetExplorerDataClient}
          workspaceId={workspaceId}
          datasetId={table.id}
        />
      </TabsContent>
    </Tabs>
  )
}

function UnsupportedCanonicalView({ name }: { name: string }) {
  return (
    <EmptyHint>
      {name} is not yet available for canonical Datasets. The Explorer will not
      read legacy physical sheet resources as a fallback.
    </EmptyHint>
  )
}

// ---------------------------------------------------------------------------
// History tab — GOV-03. Authoritative change_events for the Dataset and its
// Versions, correlated through the RPC's object filter; frozen snapshot rows
// stay in the Versions tab.
// ---------------------------------------------------------------------------

function DatasetHistoryTab({ datasetId }: { datasetId: string }) {
  const historyQuery = useInfiniteQuery({
    queryKey: ['audit-events', 'dataset', datasetId],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      fetchAuditEvents(auditHistoryDataClient, {
        object: datasetId,
        limit: 50,
        ...(pageParam === undefined ? {} : { beforeSequence: pageParam }),
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  })

  const events = historyQuery.data?.pages.flatMap((page) => page.events) ?? []
  const denied =
    historyQuery.error instanceof DataClientError &&
    (historyQuery.error.code === 'permission_denied' ||
      historyQuery.error.code === 'unauthenticated')

  return (
    <ObjectHistoryTimeline
      events={events}
      loading={historyQuery.isLoading}
      error={
        historyQuery.isError
          ? denied
            ? 'History is not available for this dataset.'
            : 'History could not be loaded.'
          : null
      }
      hasMore={Boolean(historyQuery.hasNextPage)}
      onLoadMore={() => void historyQuery.fetchNextPage()}
      loadingMore={historyQuery.isFetchingNextPage}
      maxHeight="48rem"
    />
  )
}

// ---------------------------------------------------------------------------
// Data tab — virtualised incremental query, filters, sorting and inspector.
// ---------------------------------------------------------------------------

export interface DatasetDataTabProps {
  table: CanonicalDatasetWire
  onRefresh?: () => void
  /** COLLAB-02: canonical workspace id; null disables dataset discussion. */
  collaborationWorkspaceId?: string | null
  /** COLLAB-02: workspace role hint for the discussion composer. */
  collaborationRole?: string
}

export function DatasetDataTab({
  table,
  onRefresh,
  collaborationWorkspaceId,
  collaborationRole = 'viewer',
}: DatasetDataTabProps) {
  const [query, setQuery] = useState<RegistryQuery>({
    ...DEFAULT_DATASET_QUERY,
    grouping: [],
  })
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)

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

  useEffect(() => setSelectedRowId(null), [qid])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 justify-end px-1 py-1">
        <ExportMenu path={`/api/export/dataset/${table.id}`} />
      </div>
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
              collaborationWorkspaceId={collaborationWorkspaceId}
              collaborationRole={collaborationRole}
              onSaved={() => {
                void rowsQuery.refetch()
                onRefresh?.()
              }}
            />
          )}
        />
      </div>
    </div>
  )
}

function DatasetRowEditor({
  table,
  row,
  onSaved,
}: {
  table: CanonicalDatasetWire
  row: ScientificRowWire
  onSaved?: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      table.columns.map((column) => [
        column.id,
        row[column.field_name] == null ? '' : String(row[column.field_name]),
      ]),
    ),
  )
  const mutation = useMutation({
    mutationFn: async () => {
      const next: Record<string, unknown> = {}
      for (const column of table.columns) {
        const raw = values[column.id] ?? ''
        next[column.id] = coerceDatasetCellValue(column, raw)
      }
      const result = await commitDatasetRowBatch(datasetExplorerDataClient, {
        datasetId: table.id,
        expectedRevision: datasetRevision(table),
        idempotencyKey: crypto.randomUUID(),
        rows: [
          {
            operation: 'update',
            rowId: row.id,
            expectedRevision: Number(row.version),
            values: next,
          },
        ],
      })
      if (!result.ok) throw new Error(describeDatasetCommitError(result))
      return result
    },
    onSuccess: () => onSaved?.(),
  })
  return (
    <div className="grid gap-2">
      {table.columns.map((column) => (
        <Label key={column.id} className="text-xs text-muted-foreground">
          {column.label}
          <Input
            className="mt-1 h-8"
            aria-label={`Edit ${column.label}`}
            value={values[column.id] ?? ''}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                [column.id]: event.target.value,
              }))
            }
          />
        </Label>
      ))}
      {mutation.error instanceof Error ? (
        <p role="alert" className="text-xs text-destructive">
          {mutation.error.message}
        </p>
      ) : null}
      <Button
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? 'Saving…' : 'Save row'}
      </Button>
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
// Chart tab
// ---------------------------------------------------------------------------

export function DatasetChartTab({ table }: { table: ScientificTableWire }) {
  const defaultSpec = useMemo(() => {
    const spec = buildDefaultChartSpec(table)
    if (!spec) return null
    const xColumn = table.columns.find(
      (column) => column.id === spec.fields.x?.fieldId,
    )
    return /time|day|date/i.test(xColumn?.label ?? '')
      ? { ...spec, type: 'line' as const }
      : spec
  }, [table])
  const [chartSpec, setChartSpec] = useState(defaultSpec)

  useEffect(() => setChartSpec(defaultSpec), [defaultSpec])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {chartSpec ? (
        <ChartConfigurator
          source={toCanonicalDatasetSource(table)}
          spec={chartSpec}
          onSpecChange={setChartSpec}
          idPrefix="dataset-chart"
        />
      ) : null}
      <div className="min-h-0 flex-1">
        <ChartPreview table={table} chartSpec={chartSpec} />
      </div>
    </div>
  )
}

interface ChartPreviewProps {
  table: ScientificTableWire
  chartSpec: ChartSpec | null
}

function ChartPreview({ table, chartSpec }: ChartPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [plotHeight, setPlotHeight] = useState(240)
  const transformCheck = chartSpec
    ? validateTransformations(chartSpec.transformations)
    : { ok: true as const }

  // Resolve the chart dataset via the shared SCI data layer so the preview
  // stays reproducible from the same ChartSpec model.
  const { datasetQuery } = useLiveChartDataset(chartSpec)
  const materialised = useMemo(
    () =>
      chartSpec
        ? materialiseLiveChart(chartSpec, datasetQuery.data ?? null)
        : null,
    [chartSpec, datasetQuery.data],
  )

  const chartTitle = chartSpec
    ? `${chartSpec.display.axes.y.label} over ${chartSpec.display.axes.x.label}${
        chartSpec.fields.series
          ? ` by ${
              table.columns.find(
                (column) => column.id === chartSpec.fields.series?.fieldId,
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
          className="flex h-full min-h-0 flex-col rounded-none border-0 bg-transparent shadow-none [&>div:first-of-type]:min-h-0 [&>div:first-of-type]:flex-1"
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inspector — selected row, lineage, linked records, transformations
// ---------------------------------------------------------------------------

interface DatasetInspectorProps {
  table: CanonicalDatasetWire
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
  onSaved?: () => void
  /** COLLAB-02: canonical workspace id; null disables dataset discussion. */
  collaborationWorkspaceId?: string | null
  /** COLLAB-02: workspace role hint for the discussion composer. */
  collaborationRole?: string
}

export function DatasetInspector({
  table,
  row,
  formulas,
  dependencies,
  links,
  lineageLoading,
  lineageError,
  onSaved,
  collaborationWorkspaceId,
  collaborationRole = 'viewer',
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
  const objectDepsQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.dependencies(table.id),
    queryFn: () =>
      fetchDatasetDependencies(datasetExplorerDataClient, table.id),
    staleTime: 30_000,
  })
  const sheetLinks = sheetLinksFromDependencies(objectDepsQuery.data ?? [])

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
              {table.lifecycle !== 'archived' ? (
                <InspectorSection title="Live edit">
                  <DatasetRowEditor table={table} row={row} onSaved={onSaved} />
                </InspectorSection>
              ) : null}
              <InspectorSection title="Open in Sheet">
                {objectDepsQuery.isLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : sheetLinks.length === 0 ? (
                  <EmptyHint>
                    No Sheet Instance currently binds this Dataset. Open an
                    existing composed Sheet to bind it there.
                  </EmptyHint>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {sheetLinks.map((link) => (
                      <li key={link.instanceId}>
                        <Link
                          to="/sheets/$instanceId"
                          params={{ instanceId: link.instanceId }}
                          search={{ projectId: undefined }}
                          className="text-primary hover:underline"
                        >
                          {link.name}
                        </Link>
                        {link.historical ? ' · historical' : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </InspectorSection>
              <InspectorSection title="Dependencies">
                {(objectDepsQuery.data ?? []).length === 0 ? (
                  <EmptyHint>No recorded consumers</EmptyHint>
                ) : (
                  <PropertyList>
                    {(objectDepsQuery.data ?? []).map((item) => (
                      <Property
                        key={`${item.kind}-${item.id}`}
                        label={item.kind}
                        stacked
                      >
                        {item.label} · {item.relation} · {item.liveness}
                      </Property>
                    ))}
                  </PropertyList>
                )}
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
        ...(collaborationWorkspaceId
          ? [
              {
                id: 'discussion',
                label: 'Discussion',
                content: (
                  <ThreadPanel
                    anchor={{
                      anchorType: 'dataset',
                      workspaceId: collaborationWorkspaceId,
                      datasetId: table.id,
                    }}
                    currentRole={collaborationRole}
                    canComment={canCommentInRoom(collaborationRole)}
                  />
                ),
              },
            ]
          : []),
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// Schema tab
// ---------------------------------------------------------------------------

interface DatasetSchemaTabProps {
  table: CanonicalDatasetWire
}

export function DatasetSchemaTab({ table }: DatasetSchemaTabProps) {
  return (
    <div className="max-w-5xl space-y-4 py-3">
      <section aria-labelledby="dataset-structure-title">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="dataset-structure-title" className="text-sm font-semibold">
              Schema Version
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {table.dataset_schema
                ? `This live Dataset is pinned to “${table.dataset_schema.name}” v${table.schema_version}. Historical Versions keep the Schema they were snapshotted with.`
                : 'Fields on this Dataset come from the pinned Schema Version.'}
            </p>
          </div>
          <Badge variant="outline">
            {table.lifecycle === 'archived' ? 'Archived' : 'Live'}
          </Badge>
        </div>
      </section>
      <section className="border-t pt-4" aria-labelledby="dataset-fields-title">
        <h3 id="dataset-fields-title" className="text-sm font-semibold">
          Pinned fields
        </h3>
        <div className="mt-2 overflow-x-auto rounded-md border">
          <Table aria-label="Dataset fields">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.columns.map((column) => (
                <TableRow key={column.id}>
                  <TableCell>{column.label}</TableCell>
                  <TableCell>{column.logical_type}</TableCell>
                  <TableCell>{column.nullable ? 'No' : 'Yes'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

export function HistoricalDatasetVersionTable({
  columns,
  rows,
}: {
  columns: Array<{ id: string; label: string }>
  rows: Array<{ rowId: string; values: Record<string, unknown> }>
}) {
  return (
    <Table aria-label="Historical Dataset rows" className="mt-2">
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.id}>{column.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.rowId}>
            {columns.map((column) => (
              <TableCell key={column.id}>
                {row.values[column.id] == null
                  ? '—'
                  : String(row.values[column.id])}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function DatasetVersionsTab({ table }: { table: CanonicalDatasetWire }) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  )
  const versionsQuery = useQuery({
    queryKey: datasetExplorerQueryKeys.versions(table.id),
    queryFn: () => listDatasetVersions(datasetExplorerDataClient, table.id),
  })
  const versions = versionsQuery.data ?? []
  const selected =
    versions.find((item) => item.id === selectedVersionId) ?? null
  const historicalQuery = useQuery({
    queryKey: ['dataset-version-rows', selected?.id ?? 'none'],
    queryFn: () =>
      queryDatasetVersionRows(datasetExplorerDataClient, selected!.id),
    enabled: Boolean(selected),
  })
  const schemaQuery = useQuery({
    queryKey: ['dataset-version-schema', selected?.schema_version_id ?? 'none'],
    queryFn: () =>
      listCanonicalDatasetSchemaVersionFields(
        datasetExplorerDataClient,
        selected!.schema_version_id,
      ),
    enabled: Boolean(selected?.schema_version_id),
  })
  const historicalColumns = columnsForPinnedSchemaVersion(
    schemaQuery.data ?? [],
  )

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Immutable Versions</h2>
        <p className="text-xs text-muted-foreground">
          Live revision {datasetRevision(table)}. Snapshots never change after
          capture.
        </p>
        {versionsQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : versions.length === 0 ? (
          <EmptyHint>No snapshots yet</EmptyHint>
        ) : (
          <ul className="space-y-1">
            {versions.map((version) => (
              <li key={version.id}>
                <Button
                  size="sm"
                  variant={
                    version.id === selectedVersionId ? 'secondary' : 'outline'
                  }
                  className="w-full justify-start"
                  onClick={() => setSelectedVersionId(version.id)}
                >
                  {version.label} · r{String(version.source_dataset_revision)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Historical rows</h3>
          {selected ? (
            <ExportMenu
              path={`/api/export/dataset-version/${selected.id}`}
              label="Export version"
            />
          ) : null}
        </div>
        {!selected ? (
          <EmptyHint>Select a Version to inspect frozen rows</EmptyHint>
        ) : historicalQuery.isLoading || schemaQuery.isLoading ? (
          <Skeleton className="mt-2 h-32 w-full" />
        ) : (
          <HistoricalDatasetVersionTable
            columns={historicalColumns}
            rows={historicalQuery.data?.rows ?? []}
          />
        )}
      </div>
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
