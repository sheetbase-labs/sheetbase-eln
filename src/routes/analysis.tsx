/**
 * ANALYSIS-002 — Analysis route (`/analysis`).
 *
 * Dataset Explorer owns transient one-dataset exploration. This compatibility
 * route promotes that work into a named analysis identity and immutable runs.
 * Recorded Figure, Data and Methods views read the selected run snapshots;
 * editing a draft explicitly returns to live source data. Source observations
 * capture execution-time metadata, not a claim of historical dataset replay.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Database,
  Download,
  LineChart as LineChartIcon,
  Loader2,
  Pencil,
  Save,
  Sigma,
  Trash2,
  TriangleAlert,
} from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { ChartConfigurator } from '#/components/viz/chart-configurator'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import {
  Badge,
  Button,
  Card,
  Field,
  FieldGroup,
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
import { Inspector } from '#/components/record/inspector'
import {
  InspectorSection,
  InspectorSectionStack,
  Property,
  PropertyList,
} from '#/components/record'
import { materialiseLiveChart, useLiveChartDataset } from '#/lib/chart-data'
import {
  AXIS_SCALES,
  CHART_PALETTE,
  CHART_SPEC_VERSION,
  formatScientific,
} from '#/lib/chart-spec'
import type { AxisScale, ChartSpec, FrozenChart } from '#/lib/chart-spec'
import {
  ANALYSIS_MAX_FILTERS,
  ANALYSIS_MAX_RESULT_ROWS,
  analysisStudioDataClient,
  analysisStudioQueryKeys,
  buildExportProvenance,
  canRecordAnalysis,
  captureSourceRevisions,
  createAnalysisRun,
  DEFAULT_EXPORT_SETTINGS,
  detectStaleSources,
  exportChartSvg,
  exportDataCsv,
  exportViewJson,
  fetchAnalysisViews,
  fetchAnalysisRuns,
  fetchDatasetSummaries,
  materialiseAnalysisChart,
  saveAnalysisView,
  selectRecordedRun,
  validateAnalysisSpec,
} from '#/lib/analysis-studio-data'
import type {
  AnalysisRunWire,
  AnalysisViewWire,
  ExportSettings,
} from '#/lib/analysis-studio-data'
import { buildDefaultChartSpec } from '#/lib/dataset-explorer-data'
import type { ScientificTableWire } from '#/lib/scientific-sheet-data'
import { formatCount } from '#/lib/format-numbers'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/analysis')({
  validateSearch: (search: Record<string, unknown>) => ({
    dataset: validUuid(search.dataset),
    analysis: validUuid(search.analysis),
    run: validUuid(search.run),
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: AnalysisStudioRoute,
})

function validUuid(value: unknown): string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : ''
}

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

function AnalysisStudioRoute() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const workspaceId = context.workspace?.id ?? 'no-workspace'
  const userId = context.user.id

  const summariesQuery = useQuery({
    queryKey: analysisStudioQueryKeys.datasets,
    queryFn: () => fetchDatasetSummaries(),
    staleTime: 30_000,
  })
  const datasets = summariesQuery.data ?? []

  const viewsQuery = useQuery({
    queryKey: analysisStudioQueryKeys.views,
    queryFn: () => fetchAnalysisViews(analysisStudioDataClient),
    staleTime: 10_000,
  })
  const views = viewsQuery.data ?? []

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [spec, setSpec] = useState<ChartSpec | null>(null)
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null)
  const [viewName, setViewName] = useState('')
  const [editingFigure, setEditingFigure] = useState(false)
  const loadedTarget = useRef('')
  const [exportSettings, setExportSettings] = useState<ExportSettings>(
    DEFAULT_EXPORT_SETTINGS,
  )

  // URL handoffs are authoritative. An empty route remains a library rather
  // than silently turning the first available dataset into an analysis.
  useEffect(() => {
    const target = `${search.analysis}:${search.dataset}`
    if (loadedTarget.current === target) return
    if (search.analysis) {
      const requested = views.find((view) => view.id === search.analysis)
      if (requested) {
        loadView(requested)
        loadedTarget.current = target
      } else if (!viewsQuery.isLoading) {
        setSelectedViewId(null)
        setSelectedTableId(null)
        setSpec(null)
        setViewName('')
        loadedTarget.current = target
      }
      return
    }
    if (search.dataset && datasets.some((d) => d.id === search.dataset)) {
      setSelectedTableId(search.dataset)
      setEditingFigure(true)
      loadedTarget.current = target
    }
  }, [datasets, search.analysis, search.dataset, views, viewsQuery.isLoading])

  const selectedTable = useMemo(
    () => datasets.find((d) => d.id === selectedTableId) ?? null,
    [datasets, selectedTableId],
  )

  // Build a default spec when the dataset changes (or load a saved view).
  useEffect(() => {
    if (selectedTable && !search.analysis) {
      setSpec(buildDefaultChartSpec(selectedTable))
      setSelectedViewId(null)
      setViewName('')
    }
  }, [selectedTableId, search.analysis])

  // Live preview resolution: read source data read-only (never mutate). The
  // materialised chart is lifted here so the preview and the export panel
  // share one authoritative materialisation.
  // Saved views open in recorded mode. Passing null keeps both scientific
  // source queries disabled; immutable run rendering does not re-read data.
  const { datasetQuery, calcQuery } = useLiveChartDataset(
    selectedViewId && !editingFigure ? null : spec,
  )
  const liveMaterialised = useMemo(
    () =>
      spec
        ? materialiseLiveChart(
            spec,
            datasetQuery.data ?? null,
            calcQuery.data ?? null,
          )
        : missingDatasetChart(),
    [spec, datasetQuery.data, calcQuery.data],
  )
  const analysisMaterialised = useMemo(() => {
    if (!spec || !datasetQuery.data || liveMaterialised.state.kind !== 'ok')
      return liveMaterialised
    const columns = datasetQuery.data.columns.map((c) => ({
      id: c.id,
      fieldName: c.field_name,
      label: c.label,
      logicalType: c.logical_type,
      unit: c.unit,
    }))
    return materialiseAnalysisChart(spec, columns, datasetQuery.data.rows)
  }, [spec, datasetQuery.data, liveMaterialised])

  const queryClient = useQueryClient()

  const runsQuery = useQuery({
    queryKey: analysisStudioQueryKeys.runs(selectedViewId ?? ''),
    queryFn: () => fetchAnalysisRuns(analysisStudioDataClient, selectedViewId!),
    enabled: Boolean(selectedViewId),
  })
  const selectedRun = useMemo(
    () => selectRecordedRun(runsQuery.data ?? [], search.run),
    [runsQuery.data, search.run],
  )
  const recordedMode = Boolean(
    search.analysis && selectedViewId === search.analysis && !editingFigure,
  )
  const recordedReady = Boolean(
    recordedMode &&
    selectedRun &&
    (!search.run || selectedRun.id === search.run),
  )
  const analysisTargetMatches = Boolean(
    !search.analysis || selectedViewId === search.analysis,
  )
  const recordedRequested = Boolean(search.analysis && !editingFigure)

  useEffect(() => {
    if (!selectedViewId || editingFigure || runsQuery.isLoading) return
    const runs = runsQuery.data ?? []
    if (runs.length > 0 && !search.run) {
      void navigate({
        to: '/analysis',
        search: { analysis: selectedViewId, dataset: '', run: runs[0].id },
        replace: true,
      })
    }
  }, [
    editingFigure,
    navigate,
    runsQuery.data,
    runsQuery.isLoading,
    search.run,
    selectedRun,
    selectedViewId,
  ])

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!spec || !selectedTable || !datasetQuery.data || !viewName.trim()) {
        throw new Error('The analysis is not ready to record.')
      }
      const validation = validateAnalysisSpec(
        spec,
        datasetQuery.data.rows.length,
      )
      if (!validation.ok || analysisMaterialised.state.kind !== 'ok') {
        throw new Error('Resolve the figure problems before recording a run.')
      }
      const analysis = await saveAnalysisView(
        analysisStudioDataClient,
        {
          id: selectedViewId ?? undefined,
          name: viewName.trim(),
          spec,
          source_revisions: captureSourceRevisions(datasets, spec),
          export_settings: exportSettings,
        },
        workspaceId,
        userId,
      )
      const run = await createAnalysisRun(analysisStudioDataClient, {
        analysisViewId: analysis.id,
        status: 'completed',
        specSnapshot: spec,
        resultSnapshot: analysisMaterialised,
        warnings: [],
        engineVersion: 'sheetbase-analysis/1',
      })
      return { analysis, run }
    },
    onSuccess: ({ analysis }) => {
      setSelectedViewId(analysis.id)
      setEditingFigure(false)
      void queryClient.invalidateQueries({
        queryKey: analysisStudioQueryKeys.views,
      })
      void queryClient.invalidateQueries({
        queryKey: analysisStudioQueryKeys.runs(analysis.id),
      })
      void navigate({
        to: '/analysis',
        search: { analysis: analysis.id, dataset: '', run: '' },
        replace: true,
      })
    },
  })

  function loadView(view: AnalysisViewWire) {
    setSelectedViewId(view.id)
    setViewName(view.name)
    setSpec(view.spec)
    setEditingFigure(false)
    if (view.export_settings) setExportSettings(view.export_settings)
    const tableId = view.spec.datasets[0]?.tableId ?? null
    if (tableId && datasets.some((d) => d.id === tableId)) {
      setSelectedTableId(tableId)
    }
  }

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
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Analysis' }],
    fullBleed: true,
  })

  const validation = spec
    ? validateAnalysisSpec(spec, datasetQuery.data?.rows.length ?? 0)
    : { ok: false as const, errors: ['No specification selected.'] }
  const isOwner =
    !selectedViewId ||
    views.find((view) => view.id === selectedViewId)?.owner_user_id === userId
  const canRecord = Boolean(
    selectedTable &&
    spec &&
    datasetQuery.data?.table.id === spec.datasets[0]?.tableId &&
    canRecordAnalysis({
      owner: isOwner,
      named: Boolean(viewName.trim()),
      datasetLoading: datasetQuery.isLoading,
      datasetError: Boolean(datasetQuery.error),
      calculationLoading: calcQuery.isLoading,
      calculationError: Boolean(calcQuery.error),
      validationOk: validation.ok,
      materialised: analysisMaterialised,
      pending: runMutation.isPending,
    }),
  )
  const displaySpec = !analysisTargetMatches
    ? null
    : recordedRequested
      ? recordedReady
        ? (selectedRun?.spec_snapshot ?? null)
        : null
      : spec
  const displayMaterialised = recordedReady
    ? (selectedRun?.result_snapshot ?? missingDatasetChart())
    : analysisMaterialised
  const frozen: FrozenChart | null =
    recordedMode && selectedRun
      ? {
          revisionId: null,
          frozenAt: selectedRun.created_at,
          frozenByUserId: selectedRun.actor_user_id,
          datasetProvenance: [],
          data: { columns: [], rows: [], series: [] },
        }
      : null

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
        <AnalysisStudioHeader
          loading={!recordedRequested && summariesQuery.isLoading}
          error={recordedRequested ? null : summariesQuery.error}
          sourceName={
            recordedRequested
              ? recordedReady
                ? (selectedRun?.source_observations.sourceName ?? null)
                : null
              : (selectedTable?.name ?? null)
          }
          onOpenDatasets={() =>
            void navigate({
              to: '/datasets',
              search: {
                dataset: recordedMode
                  ? (selectedRun?.source_observations.tableId ?? '')
                  : (selectedTableId ?? ''),
              },
            })
          }
        />
        {displaySpec &&
        analysisTargetMatches &&
        (recordedRequested ? recordedReady : selectedTable) ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3 border-b pb-3">
              <Field className="w-full max-w-xl min-w-64 flex-1">
                <FieldLabel htmlFor="analysis-name">Analysis name</FieldLabel>
                <Input
                  id="analysis-name"
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  disabled={recordedMode || !isOwner}
                  required
                  placeholder="Name this scientific answer"
                />
              </Field>
              <div className="flex h-9 items-center gap-2 self-end">
                <Badge variant="outline">Exploratory · unreviewed</Badge>
                {recordedMode && isOwner ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingFigure(true)
                      void navigate({
                        to: '/analysis',
                        search: {
                          analysis: selectedViewId ?? '',
                          dataset: '',
                          run: '',
                        },
                        replace: true,
                      })
                    }}
                  >
                    <Pencil /> Edit draft
                  </Button>
                ) : null}
                {!recordedMode ? (
                  <Button
                    onClick={() => runMutation.mutate()}
                    disabled={!canRecord}
                  >
                    {runMutation.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Save />
                    )}
                    Record analysis run
                  </Button>
                ) : null}
              </div>
            </div>
            {runMutation.error ? (
              <p role="alert" className="text-sm text-destructive">
                {runMutation.error.message}
              </p>
            ) : null}
            {calcQuery.error && !recordedMode ? (
              <p role="alert" className="text-sm text-destructive">
                Calculation results could not be loaded. Recording is disabled.
              </p>
            ) : null}
            <Tabs
              defaultValue="figure"
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabsList className="h-8 w-full justify-start gap-5 rounded-none border-b bg-transparent p-0">
                <TabsTrigger
                  value="figure"
                  className="h-8 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  Figure
                </TabsTrigger>
                <TabsTrigger
                  value="data"
                  className="h-8 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  Data
                </TabsTrigger>
                <TabsTrigger
                  value="methods"
                  className="h-8 rounded-none border-b-2 border-transparent px-0 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  Methods
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="figure"
                className="min-h-0 flex-1 overflow-auto"
              >
                {!recordedMode && isOwner ? (
                  <div className="mb-2 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingFigure((value) => !value)}
                    >
                      {editingFigure ? 'Close figure editor' : 'Edit figure'}
                    </Button>
                  </div>
                ) : null}
                {editingFigure && selectedTable ? (
                  <ChartConfigurator
                    table={selectedTable}
                    spec={displaySpec}
                    onSpecChange={setSpec}
                    idPrefix="analysis"
                  />
                ) : null}
                <ChartRenderer
                  title={`${displaySpec.display.axes.y.label ?? displaySpec.fields.y.fieldName} over ${displaySpec.display.axes.x.label ?? displaySpec.fields.x?.fieldName ?? 'row'}`}
                  spec={displaySpec}
                  materialised={displayMaterialised}
                  frozen={frozen}
                  loading={!recordedMode && datasetQuery.isLoading}
                  plotHeight={430}
                  className="min-h-[30rem]"
                />
              </TabsContent>
              <TabsContent
                value="data"
                className="min-h-0 flex-1 overflow-auto"
              >
                <DataTableAlternative
                  materialised={displayMaterialised}
                  loading={!recordedMode && datasetQuery.isLoading}
                />
              </TabsContent>
              <TabsContent
                value="methods"
                className="min-h-0 flex-1 overflow-auto"
              >
                <AnalysisMethods
                  spec={displaySpec}
                  table={recordedMode ? null : selectedTable}
                  rowCount={datasetQuery.data?.rows.length ?? null}
                  runs={runsQuery.data ?? []}
                  loadingRuns={runsQuery.isLoading}
                  selectedRunId={selectedRun?.id ?? null}
                  recordedObservation={
                    recordedMode
                      ? (selectedRun?.source_observations ?? null)
                      : null
                  }
                  onSelectRun={(run) => {
                    setEditingFigure(false)
                    void navigate({
                      to: '/analysis',
                      search: {
                        analysis: selectedViewId ?? '',
                        dataset: '',
                        run: run.id,
                      },
                    })
                  }}
                />
              </TabsContent>
            </Tabs>
          </div>
        ) : search.analysis || search.dataset ? (
          <p role="alert" className="m-auto text-sm text-muted-foreground">
            {recordedMode && runsQuery.isLoading
              ? 'Loading recorded analysis run…'
              : 'The requested analysis, recorded run or dataset is unavailable.'}
          </p>
        ) : (
          <AnalysisLibrary
            views={views}
            loading={viewsQuery.isLoading}
            error={viewsQuery.error ?? summariesQuery.error}
            onLoad={(view) => {
              loadView(view)
              void navigate({
                to: '/analysis',
                search: { analysis: view.id, dataset: '', run: '' },
              })
            }}
          />
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Header + dataset selector
// ---------------------------------------------------------------------------

interface AnalysisStudioHeaderProps {
  loading: boolean
  error: unknown
  sourceName: string | null
  onOpenDatasets: () => void
}

export function AnalysisStudioHeader({
  loading,
  error,
  sourceName,
  onOpenDatasets,
}: AnalysisStudioHeaderProps) {
  return (
    <header
      className="flex shrink-0 flex-wrap items-center justify-between gap-3"
      aria-labelledby="analysis-title"
    >
      <div className="flex min-w-0 items-center gap-2">
        <LineChartIcon className="size-4 text-violet-500" aria-hidden="true" />
        <h1
          id="analysis-title"
          className="text-sm font-semibold tracking-tight"
        >
          Analysis
        </h1>
        <span className="text-xs text-muted-foreground">
          Named scientific answers with immutable run history
        </span>
      </div>
      <div className="flex items-center gap-2">
        {error ? (
          <Badge variant="danger">Could not load datasets</Badge>
        ) : loading ? (
          <Skeleton className="h-7 w-48" />
        ) : sourceName ? (
          <span className="text-sm text-muted-foreground">
            Source: {sourceName}
          </span>
        ) : null}
        <Button variant="outline" size="sm" onClick={onOpenDatasets}>
          Dataset Explorer
        </Button>
      </div>
    </header>
  )
}

export function AnalysisLibrary({
  views,
  loading,
  error,
  onLoad,
}: {
  views: AnalysisViewWire[]
  loading: boolean
  error: unknown
  onLoad: (view: AnalysisViewWire) => void
}) {
  if (error) {
    return (
      <p role="alert" className="p-8 text-center text-sm text-destructive">
        Could not load analyses.
      </p>
    )
  }
  if (loading) return <Skeleton className="m-auto h-24 w-full max-w-xl" />
  return (
    <section
      className="mx-auto w-full max-w-3xl py-10"
      aria-labelledby="analysis-library-title"
    >
      <h2 id="analysis-library-title" className="text-lg font-semibold">
        Analyses
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Named exploratory analyses available in this workspace.
      </p>
      {views.length === 0 ? (
        <p className="mt-8 border-t py-8 text-sm text-muted-foreground">
          No analyses yet. Start from a dataset in Dataset Explorer.
        </p>
      ) : (
        <ul className="mt-5 divide-y border-y">
          {views.map((view) => (
            <li key={view.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-2 py-3 text-left hover:bg-muted/40"
                onClick={() => onLoad(view)}
              >
                <span className="font-medium">{view.name}</span>
                <span className="text-xs text-muted-foreground">
                  Exploratory · unreviewed
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function AnalysisMethods({
  spec,
  table,
  rowCount,
  runs,
  loadingRuns,
  selectedRunId,
  recordedObservation,
  onSelectRun,
}: {
  spec: ChartSpec
  table: ScientificTableWire | null
  rowCount: number | null
  runs: AnalysisRunWire[]
  loadingRuns: boolean
  selectedRunId: string | null
  recordedObservation: AnalysisRunWire['source_observations'] | null
  onSelectRun: (run: AnalysisRunWire) => void
}) {
  return (
    <div className="w-full divide-y border-y text-sm">
      <section className="grid grid-cols-[10rem_1fr] gap-3 py-3">
        <h2 className="font-medium">Current source</h2>
        <p className="text-muted-foreground">
          {recordedObservation?.sourceName ??
            table?.name ??
            'Unavailable source'}{' '}
          · schema v
          {recordedObservation?.schemaVersion ??
            table?.schema_version ??
            'unknown'}{' '}
          ·{' '}
          {recordedObservation
            ? `${formatCount(recordedObservation.rowCount)} rows and metadata observed at ${new Date(recordedObservation.observedAt).toLocaleString('en-GB')}`
            : rowCount === null
              ? 'row count loading'
              : `${formatCount(rowCount)} currently loaded rows`}
        </p>
      </section>
      <section className="grid grid-cols-[10rem_1fr] gap-3 py-3">
        <h2 className="font-medium">Operations</h2>
        <p className="text-muted-foreground">
          {spec.transformations.length
            ? `${spec.transformations.length} configured transformation${spec.transformations.length === 1 ? '' : 's'}`
            : 'No transformations'}{' '}
          ·{' '}
          {spec.filters.length
            ? `${spec.filters.length} filter${spec.filters.length === 1 ? '' : 's'}`
            : 'No filters'}
        </p>
      </section>
      <section className="py-3">
        <h2 className="mb-2 font-medium">Run history</h2>
        {loadingRuns ? (
          <p className="text-muted-foreground">Loading runs…</p>
        ) : runs.length === 0 ? (
          <p className="text-muted-foreground">No recorded runs.</p>
        ) : (
          <ol className="divide-y">
            <li className="grid grid-cols-[5rem_11rem_1fr_7rem] gap-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Run</span>
              <span>Recorded</span>
              <span>Source observation</span>
              <span>Evidence digest</span>
            </li>
            {runs.map((run, index) => (
              <li
                key={run.id}
                className={cn(
                  'grid grid-cols-[5rem_11rem_1fr_7rem] gap-3 py-2 text-xs',
                  run.id === selectedRunId && 'bg-muted/50',
                )}
              >
                <button
                  type="button"
                  className="text-left font-medium underline-offset-2 hover:underline"
                  aria-pressed={run.id === selectedRunId}
                  onClick={() => onSelectRun(run)}
                >
                  Run {run.sequence}
                </button>
                <time dateTime={run.created_at}>
                  {new Date(run.created_at).toLocaleString('en-GB')}
                </time>
                <span className="text-muted-foreground">
                  Recorded · source observed{' '}
                  {new Date(run.source_observations.observedAt).toLocaleString(
                    'en-GB',
                  )}{' '}
                  · {run.source_observations.rowCount} rows
                </span>
                <span className="font-mono text-muted-foreground">
                  {run.digest.slice(0, 10)}
                </span>
                {index === 0 ? (
                  <span className="sr-only">Latest run</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export function FilterControls({
  table,
  spec,
  onSpecChange,
}: {
  table: ScientificTableWire
  spec: ChartSpec
  onSpecChange: (spec: ChartSpec) => void
}) {
  function setFilter(index: number, value: string): void {
    const filters = [...spec.filters]
    if (filters[index]) {
      filters[index] = { ...filters[index], value }
      onSpecChange({ ...spec, filters })
    }
  }
  function addFilter(): void {
    if (spec.filters.length >= ANALYSIS_MAX_FILTERS) return
    const column = table.columns.find(
      (c) => !spec.filters.some((f) => f.columnId === c.id),
    )
    if (!column) return
    onSpecChange({
      ...spec,
      filters: [
        ...spec.filters,
        {
          columnId: column.id,
          fieldName: column.field_name,
          op: 'eq',
          value: '',
        },
      ],
    })
  }
  function removeFilter(index: number): void {
    onSpecChange({
      ...spec,
      filters: spec.filters.filter((_, i) => i !== index),
    })
  }
  return (
    <div className="space-y-1.5">
      {spec.filters.map((filter, i) => {
        const column = table.columns.find((c) => c.id === filter.columnId)
        return (
          <div key={filter.columnId + i} className="flex items-center gap-1.5">
            <span className="flex-1 truncate text-xs text-muted-foreground">
              {column?.label ?? filter.fieldName}
            </span>
            <Field className="w-24">
              <FieldLabel
                className="sr-only"
                htmlFor={`filter-${filter.columnId}-${i}`}
              >
                Filter value
              </FieldLabel>
              <Input
                id={`filter-${filter.columnId}-${i}`}
                aria-label={`Filter value for ${column?.label ?? filter.fieldName}`}
                value={String(filter.value ?? '')}
                onChange={(e) => setFilter(i, e.target.value)}
                placeholder="eq…"
                className="h-7 bg-background text-xs"
              />
            </Field>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove filter"
              onClick={() => removeFilter(i)}
            >
              <Trash2 />
            </Button>
          </div>
        )
      })}
      {spec.filters.length < ANALYSIS_MAX_FILTERS ? (
        <Button variant="outline" size="sm" onClick={addFilter}>
          + Add filter
        </Button>
      ) : null}
    </div>
  )
}

export function AnalysisInspector({
  table,
  spec,
  onSpecChange,
  views,
  selectedViewId,
  viewName,
  onViewNameChange,
  onLoad,
  onSave,
  onDelete,
  saving,
  exportSettings,
  onExportSettingsChange,
  datasets,
  user,
  materialised,
}: {
  table: ScientificTableWire
  spec: ChartSpec
  onSpecChange: (spec: ChartSpec) => void
  views: AnalysisViewWire[]
  selectedViewId: string | null
  viewName: string
  onViewNameChange: (name: string) => void
  onLoad: (view: AnalysisViewWire) => void
  onSave: () => void
  onDelete: (id: string) => void
  saving: boolean
  exportSettings: ExportSettings
  onExportSettingsChange: (settings: ExportSettings) => void
  datasets: ScientificTableWire[]
  user: { id: string; name: string }
  materialised: ReturnType<typeof materialiseLiveChart>
}) {
  function setScale(axis: 'x' | 'y', scale: AxisScale) {
    onSpecChange({
      ...spec,
      display: {
        ...spec.display,
        axes: {
          ...spec.display.axes,
          [axis]: { ...spec.display.axes[axis], scale },
        },
      },
    })
  }

  const settings = (
    <InspectorSectionStack>
      <InspectorSection title="Axis scaling">
        <FieldGroup>
          {(['x', 'y'] as const).map((axis) => (
            <Field key={axis}>
              <FieldLabel htmlFor={`inspector-${axis}-scale`}>
                {axis.toUpperCase()}-axis scale
              </FieldLabel>
              <Select
                id={`inspector-${axis}-scale`}
                value={spec.display.axes[axis].scale}
                onChange={(event) =>
                  setScale(axis, event.target.value as AxisScale)
                }
              >
                {AXIS_SCALES.map((scale) => (
                  <option key={scale} value={scale}>
                    {scale === 'log' ? 'Logarithmic' : 'Linear'}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </FieldGroup>
      </InspectorSection>
      <InspectorSection title="Appearance">
        <PropertyList>
          <Property label="Palette">Publication</Property>
          <Property label="Font">Instrument Sans</Property>
          <Property label="Series">{materialised.series.length}</Property>
        </PropertyList>
      </InspectorSection>
    </InspectorSectionStack>
  )

  return (
    <Inspector
      recordType="Analysis configuration"
      title="Chart settings"
      state="loaded"
      tabs={[
        { id: 'settings', label: 'Settings', content: settings },
        {
          id: 'views',
          label: 'Views',
          badge: views.length > 0 ? views.length : undefined,
          content: (
            <SavedViewsPanel
              views={views}
              selectedViewId={selectedViewId}
              viewName={viewName}
              onViewNameChange={onViewNameChange}
              onLoad={onLoad}
              onSave={onSave}
              onDelete={onDelete}
              saving={saving}
              canSave={Boolean(viewName.trim())}
            />
          ),
        },
        {
          id: 'calculations',
          label: 'Calculations',
          content: (
            <InspectorSectionStack>
              <InspectorSection title="Filters">
                <FilterControls
                  table={table}
                  spec={spec}
                  onSpecChange={onSpecChange}
                />
              </InspectorSection>
              <InspectorSection title="Summary">
                <PropertyList>
                  <Property label="Transformations">
                    {spec.transformations.length}
                  </Property>
                  <Property label="Filters">{spec.filters.length}</Property>
                </PropertyList>
              </InspectorSection>
            </InspectorSectionStack>
          ),
        },
        {
          id: 'export',
          label: 'Export',
          content: (
            <ExportPanel
              spec={spec}
              settings={exportSettings}
              onSettingsChange={onExportSettingsChange}
              table={table}
              datasets={datasets}
              viewName={viewName}
              selectedViewId={selectedViewId}
              views={views}
              user={user}
              materialised={materialised}
            />
          ),
        },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// Saved views panel
// ---------------------------------------------------------------------------

interface SavedViewsPanelProps {
  views: AnalysisViewWire[]
  selectedViewId: string | null
  viewName: string
  onViewNameChange: (name: string) => void
  onLoad: (view: AnalysisViewWire) => void
  onSave: () => void
  onDelete: (id: string) => void
  saving: boolean
  canSave: boolean
}

export function SavedViewsPanel({
  views,
  selectedViewId,
  viewName,
  onViewNameChange,
  onLoad,
  onSave,
  onDelete,
  saving,
  canSave,
}: SavedViewsPanelProps) {
  return (
    <section className="space-y-3" aria-labelledby="saved-views-title">
      <h2 id="saved-views-title" className="text-sm font-semibold">
        Saved analysis views
      </h2>
      <p className="text-xs text-muted-foreground">
        Save a named configuration with its source revisions so others can
        reproduce the chart.
      </p>
      <div className="flex items-end gap-1.5">
        <Field className="flex-1">
          <FieldLabel htmlFor="analysis-view-name">Name</FieldLabel>
          <Input
            id="analysis-view-name"
            aria-label="Analysis view name"
            value={viewName}
            onChange={(e) => onViewNameChange(e.target.value)}
            placeholder="e.g. pH vs stability"
            className="h-8 bg-background"
          />
        </Field>
        <Button
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={!canSave || saving}
          aria-label="Save analysis view"
        >
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {selectedViewId ? 'Update' : 'Save'}
        </Button>
      </div>
      {views.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          No saved views yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {views.map((view) => {
            const selected = view.id === selectedViewId
            return (
              <li
                key={view.id}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs',
                  selected &&
                    'border-violet-400 bg-violet-50 dark:bg-violet-950/30',
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col text-left"
                  onClick={() => onLoad(view)}
                  aria-label={`Load view ${view.name}`}
                >
                  <span className="truncate font-medium">{view.name}</span>
                  <span className="text-xs text-muted-foreground">
                    v{view.version} ·{' '}
                    {formatCount(view.source_revisions.length)} source
                    {view.source_revisions.length === 1 ? '' : 's'}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete view ${view.name}`}
                  onClick={() => onDelete(view.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Export panel
// ---------------------------------------------------------------------------

interface ExportPanelProps {
  spec: ChartSpec
  settings: ExportSettings
  onSettingsChange: (settings: ExportSettings) => void
  table: ScientificTableWire
  datasets: ScientificTableWire[]
  viewName: string
  selectedViewId: string | null
  views: AnalysisViewWire[]
  user: { id: string; name: string }
  materialised: ReturnType<typeof materialiseLiveChart>
}

export function ExportPanel({
  spec,
  settings,
  onSettingsChange,
  datasets,
  viewName,
  selectedViewId,
  views,
  user,
  materialised,
}: ExportPanelProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)

  function setSetting<TKey extends keyof ExportSettings>(
    key: TKey,
    value: ExportSettings[TKey],
  ): void {
    onSettingsChange({ ...settings, [key]: value })
  }

  function doExport(): void {
    const selectedView = views.find((v) => v.id === selectedViewId) ?? null
    const sourceRevisions = captureSourceRevisions(datasets, spec)
    const provenance = buildExportProvenance(
      {
        name: viewName || selectedView?.name || 'Untitled analysis',
        id: selectedViewId,
        version: selectedView?.version ?? null,
      },
      user,
      sourceRevisions,
      spec,
    )
    let content: string
    let mime: string
    let ext: string
    if (settings.format === 'json') {
      content = exportViewJson(spec, settings, provenance)
      mime = 'application/json'
      ext = 'json'
    } else if (settings.format === 'csv') {
      content = exportDataCsv(materialised)
      mime = 'text/csv'
      ext = 'csv'
    } else {
      content = exportChartSvg(svgRef.current, settings, provenance)
      mime = 'image/svg+xml'
      ext = 'svg'
    }
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(viewName || 'analysis').replace(/[^a-z0-9_-]+/gi, '_')}.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="space-y-2 p-4" aria-labelledby="export-title">
      <h2 id="export-title" className="text-sm font-semibold">
        Export
      </h2>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field>
          <FieldLabel htmlFor="analysis-export-format">Format</FieldLabel>
          <Select
            id="analysis-export-format"
            aria-label="Export format"
            value={settings.format}
            onChange={(e) =>
              setSetting('format', e.target.value as ExportSettings['format'])
            }
            className="h-8 bg-background"
          >
            <option value="json">JSON (spec + provenance)</option>
            <option value="csv">CSV (data table)</option>
            <option value="svg">SVG (chart image)</option>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="analysis-export-theme">Theme</FieldLabel>
          <Select
            id="analysis-export-theme"
            aria-label="Export theme"
            value={settings.theme}
            onChange={(e) =>
              setSetting('theme', e.target.value as ExportSettings['theme'])
            }
            className="h-8 bg-background"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="analysis-export-width">Width (px)</FieldLabel>
          <Input
            id="analysis-export-width"
            aria-label="Export width"
            type="number"
            min={320}
            max={4096}
            value={settings.width}
            onChange={(e) =>
              setSetting('width', Number(e.target.value) || settings.width)
            }
            className="h-8 bg-background"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="analysis-export-height">Height (px)</FieldLabel>
          <Input
            id="analysis-export-height"
            aria-label="Export height"
            type="number"
            min={240}
            max={4096}
            value={settings.height}
            onChange={(e) =>
              setSetting('height', Number(e.target.value) || settings.height)
            }
            className="h-8 bg-background"
          />
        </Field>
      </div>
      <Field className="flex grid-cols-[auto_1fr] items-center gap-2">
        <input
          id="analysis-export-provenance"
          type="checkbox"
          checked={settings.includeProvenance}
          onChange={(e) => setSetting('includeProvenance', e.target.checked)}
        />
        <FieldLabel htmlFor="analysis-export-provenance">
          Include provenance metadata (owner, version, sources)
        </FieldLabel>
      </Field>
      <Button size="sm" onClick={doExport} className="w-full">
        <Download /> Export {settings.format.toUpperCase()}
      </Button>
      <SvgExporterAnchor svgRef={svgRef} />
    </Card>
  )
}

/**
 * Captures a reference to the rendered chart SVG so the export panel can
 * serialise it. The preview renders the SVG inside the
 * `[data-analysis-chart]` container; this resolves it after every render.
 */
export function SvgExporterAnchor({
  svgRef,
}: {
  svgRef: React.MutableRefObject<SVGSVGElement | null>
}) {
  useEffect(() => {
    const container = document.querySelector('[data-analysis-chart]')
    svgRef.current =
      (container?.querySelector('svg') as SVGSVGElement | null) ?? null
  })
  return null
}

// ---------------------------------------------------------------------------
// Preview — live chart + accessible data table + error states
// ---------------------------------------------------------------------------

interface AnalysisPreviewProps {
  table: ScientificTableWire
  spec: ChartSpec
  datasets: ScientificTableWire[]
  selectedViewId: string | null
  views: AnalysisViewWire[]
  datasetQuery: ReturnType<typeof useLiveChartDataset>['datasetQuery']
  materialised: ReturnType<typeof materialiseLiveChart>
}

export function AnalysisPreview({
  table,
  spec,
  datasets,
  selectedViewId,
  views,
  datasetQuery,
  materialised: analysisMaterialised,
}: AnalysisPreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const chartHeight = expanded ? 460 : 340
  const plotHeight = expanded ? 390 : 270
  const validation = useMemo(
    () => validateAnalysisSpec(spec, datasetQuery.data?.rows.length ?? 0),
    [spec, datasetQuery.data],
  )

  // Stale-source detection against the saved view's stored revisions.
  const staleDetail = useMemo(() => {
    if (!selectedViewId) return null
    const view = views.find((v) => v.id === selectedViewId)
    if (!view) return null
    return detectStaleSources(view.source_revisions, datasets)
  }, [selectedViewId, views, datasets])

  const resultRowCount = datasetQuery.data?.rows.length ?? 0
  const excessiveSize = resultRowCount > ANALYSIS_MAX_RESULT_ROWS
  const summaries = useMemo(
    () =>
      analysisMaterialised.series.flatMap((series) => {
        const valid = series.points.filter(
          (point): point is typeof point & { x: number; y: number } =>
            point.x !== null && point.y !== null,
        )
        if (valid.length === 0) return []
        const firstX = Math.min(...valid.map((point) => point.x))
        const lastX = Math.max(...valid.map((point) => point.x))
        const first = valid.filter((point) => point.x === firstX)
        const last = valid.filter((point) => point.x === lastX)
        const firstMean =
          first.reduce((sum, point) => sum + point.y, 0) / first.length
        const lastMean =
          last.reduce((sum, point) => sum + point.y, 0) / last.length
        return [
          {
            identifier: series.identifier,
            label: series.label,
            colour: series.color,
            lastX,
            lastMean,
            foldChange:
              firstMean > 0 && lastMean > 0
                ? Math.max(firstMean, lastMean) / Math.min(firstMean, lastMean)
                : null,
            direction: lastMean <= firstMean ? 'decrease' : 'increase',
          },
        ]
      }),
    [analysisMaterialised.series],
  )

  return (
    <div
      className="grid min-h-0 flex-1 overflow-hidden transition-[grid-template-rows]"
      style={{
        gridTemplateRows: `${chartHeight}px minmax(0, 1fr)`,
      }}
      data-preview-size={expanded ? 'expanded' : 'standard'}
      data-analysis-chart
    >
      <div className="flex min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">
              {datasetQuery.isLoading
                ? 'Loading…'
                : `${formatCount(resultRowCount)} rows`}
            </Badge>
            {spec.transformations.length > 0 ? (
              <Badge variant="outline">
                <Sigma className="size-3" aria-hidden="true" />
                {spec.transformations.length} transform
                {spec.transformations.length === 1 ? '' : 's'}
              </Badge>
            ) : null}
            {summaries.slice(0, 3).map((summary) => (
              <span
                key={summary.identifier}
                className="inline-flex items-center gap-1 text-xs"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: summary.colour }}
                />
                <span className="truncate">{summary.label}</span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatScientific(summary.lastMean)}
                </span>
              </span>
            ))}
            {summaries[0]?.foldChange ? (
              <span className="text-xs text-muted-foreground">
                Fold change: {summaries[0].foldChange.toFixed(1)}×{' '}
                {summaries[0].direction}
              </span>
            ) : null}
          </div>
        </div>

        {/* Recoverable error / warning states surfaced clearly. */}
        {!validation.ok ? (
          <div
            role="alert"
            className="mx-4 mb-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
          >
            <p className="font-semibold">Specification problems</p>
            <ul className="mt-1 list-disc pl-4">
              {validation.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {staleDetail ? (
          <div
            role="status"
            className="mx-4 mb-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs"
          >
            <TriangleAlert
              className="mt-0.5 size-4 text-warning"
              aria-hidden="true"
            />
            <span>{staleDetail}</span>
          </div>
        ) : null}
        {excessiveSize ? (
          <div
            role="status"
            className="mx-4 mb-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs"
          >
            <TriangleAlert
              className="mt-0.5 size-4 text-warning"
              aria-hidden="true"
            />
            <span>
              The source dataset has {formatCount(resultRowCount)} rows, above
              the {formatCount(ANALYSIS_MAX_RESULT_ROWS)}-row analysis limit.
              Add filters or aggregation before relying on this preview.
            </span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden px-4 pb-2">
          <ChartRenderer
            title={`${table.name} — ${spec.type} chart`}
            spec={spec}
            materialised={analysisMaterialised}
            frozen={null}
            loading={datasetQuery.isLoading}
            plotHeight={plotHeight}
            expanded={expanded}
            onExpandedChange={setExpanded}
            className="h-full rounded-none border-0 bg-transparent shadow-none"
          />
        </div>
      </div>

      {/* Accessible data table that underlies every chart. */}
      <DataTableAlternative
        materialised={analysisMaterialised}
        loading={datasetQuery.isLoading}
      />
    </div>
  )
}

/**
 * The full accessible data table that underlies every chart. Renders the
 * exact rows the chart plots so the data is reachable without the visual.
 * This is the studio-level table; the chart's own collapsed alternative
 * lives inside ChartRenderer.
 */
export function DataTableAlternative({
  materialised,
  loading,
}: {
  materialised: ReturnType<typeof materialiseLiveChart>
  loading: boolean
}) {
  if (loading) {
    return <Skeleton className="h-32 w-full" />
  }
  if (
    materialised.state.kind !== 'ok' &&
    materialised.state.kind !== 'log_scale_invalid'
  ) {
    return (
      <div className="rounded-lg border bg-card p-4 text-center text-xs text-muted-foreground">
        No plottable data table for the current state.
      </div>
    )
  }
  const chartRows = materialised.series.flatMap((s) =>
    s.points.map((p) => ({
      series: s.label,
      x: p.x,
      y: p.y,
      yError: p.yError,
    })),
  )
  const hasSourceRows =
    materialised.columns.length > 0 && materialised.rows.length > 0
  const columns = hasSourceRows
    ? materialised.columns.map((column) => ({
        key: column.fieldName,
        label: column.unit
          ? `${column.label} (${typeof column.unit === 'object' && 'symbol' in column.unit ? String((column.unit as { symbol: string }).symbol) : String(column.unit)})`
          : column.label,
      }))
    : [
        { key: 'series', label: 'Series' },
        { key: 'x', label: materialised.xLabel },
        { key: 'y', label: materialised.yLabel },
        { key: 'yError', label: 'Error' },
      ]
  const rows: Record<string, unknown>[] = hasSourceRows
    ? materialised.rows.slice(0, 50)
    : chartRows
  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden border-t"
      aria-labelledby="data-table-title"
    >
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <h2 id="data-table-title" className="text-sm font-semibold">
          Data preview
          <span className="ml-2 font-normal text-muted-foreground">
            First {Math.min(rows.length, 50)} rows
          </span>
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="link" size="sm">
            Open in data table
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Download data preview"
          >
            <Download />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table aria-label="Chart data table" data-density="compact">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-center text-xs text-muted-foreground"
                >
                  No rows.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className="scientific-nums whitespace-nowrap font-mono tabular-nums"
                    >
                      {typeof row[column.key] === 'number'
                        ? formatScientific(row[column.key] as number)
                        : String(row[column.key] ?? '—')}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function missingDatasetChart() {
  return {
    state: { kind: 'missing_dataset' as const },
    columns: [],
    rows: [],
    series: [],
    xLabel: 'x',
    yLabel: 'y',
    xUnit: undefined,
    yUnit: undefined,
  }
}

export function EmptyAnalysisState({
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
            dataset schema on the Schemas page, to start building analysis
            views.
          </p>
        </>
      )}
    </div>
  )
}

export { CHART_PALETTE, CHART_SPEC_VERSION }
