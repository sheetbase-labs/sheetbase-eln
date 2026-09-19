/**
 * ANALYSIS-001 — Analysis Studio route (`/analysis`).
 *
 * A reproducible chart-authoring surface built from typed ChartSpec controls
 * (SCI-004 decision 0029). The studio composes a data-source, chart-type,
 * axis, grouping, normalisation, aggregation and statistical-overlay
 * controls; a live preview that reads source data through the same `/api/db`
 * boundary and RLS as the rest of the application WITHOUT mutating the source
 * datasets; saved named analysis views (owner, version, source revisions)
 * persisted in `api.analysis_views`; and export with explicit format,
 * dimensions, theme and provenance metadata.
 *
 * Every chart has an accessible data-table alternative, collapsed by default
 * so the plot can occupy most of the studio. Missing columns, stale sources,
 * invalid log values and excessive result sizes are surfaced as explicit,
 * recoverable states rather than blank axes.
 *
 * PostgreSQL and RLS remain authoritative (decisions 0019/0029/0034).
 */
import { AnalysisFigureGuide } from '#/components/assist/analysis-figure-guide'
import { CompareView } from '#/components/viz/compare-view'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Database,
  Download,
  Loader2,
  PanelLeft,
  PanelLeftClose,
  Save,
  Sigma,
  Trash2,
  TriangleAlert,
} from 'lucide-react'

import { useShell } from '#/components/app-shell'
import type { ChartSelection } from '#/components/viz/chart-plots'
import { AnalysisPanel } from '#/components/viz/analysis-panel'
import { ChartConfigurator } from '#/components/viz/chart-configurator'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { DatasetPickerDialog } from '#/components/datasets/dataset-picker-dialog'
import {
  Badge,
  Button,
  Card,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { Inspector } from '#/components/record/inspector'
import { InspectorSection, InspectorSectionStack } from '#/components/record'
import { Property, PropertyList } from '#/components/scientific'
import {
  materialiseLiveChart,
  toCanonicalDatasetSource,
  useLiveChartDataset,
} from '#/lib/chart-data'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import {
  AXIS_SCALES,
  CHART_PALETTE,
  CHART_SPEC_VERSION,
  formatScientific,
} from '#/lib/chart-spec'
import type { AxisScale, ChartSpec } from '#/lib/chart-spec'
import {
  ANALYSIS_MAX_FILTERS,
  ANALYSIS_MAX_RESULT_ROWS,
  analysisStudioDataClient,
  analysisStudioQueryKeys,
  buildExportProvenance,
  captureSourceRevisions,
  DEFAULT_EXPORT_SETTINGS,
  deleteAnalysisView,
  detectStaleSources,
  exportChartSvg,
  exportDataCsv,
  exportViewJson,
  fetchAnalysisViews,
  fetchDatasetSummaries,
  materialiseAnalysisChart,
  materialiseAnalysisFacets,
  saveAnalysisView,
  validateAnalysisSpec,
} from '#/lib/analysis-studio-data'
import type {
  AnalysisViewWire,
  FacetedResult,
  ExportSettings,
} from '#/lib/analysis-studio-data'
import { buildDefaultChartSpec } from '#/lib/dataset-explorer-data'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'
import { buildDefaultComparativeViewConfig } from '#/lib/comparative-view'
import type { ComparativeViewConfig } from '#/lib/comparative-view'
import { formatCount } from '#/lib/format-numbers'
import { cn } from '#/lib/utils'
import { rasteriseSvgToPng } from '#/lib/visualisation-export'
import { CHART_ROW_ID_KEY } from '#/lib/visualisation-pipeline'

export const Route = createFileRoute('/analysis')({
  staticData: { shellFullBleed: true },
  validateSearch: (search: Record<string, unknown>) => {
    const next: { dataset?: string; x?: string; y?: string } = {}
    if (typeof search.dataset === 'string') next.dataset = search.dataset
    if (typeof search.x === 'string') next.x = search.x
    if (typeof search.y === 'string') next.y = search.y
    return next
  },
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: AnalysisStudioRoute,
})

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

function AnalysisStudioRoute() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
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
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(
    search.dataset ?? null,
  )
  const [spec, setSpec] = useState<ChartSpec | null>(null)
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null)
  const [chartSelection, setChartSelection] = useState<ChartSelection | null>(
    null,
  )
  // SCI-02: the studio serves both chart authoring and reusable analysis
  // definitions; the mode is session state, never persisted server-side.
  // VIEW-03 adds the compare mode: grouped time-series / distribution
  // inspection over the same live rows, promoting into the chart builder.
  const [mode, setMode] = useState<'chart' | 'analyse' | 'compare'>('chart')
  const [compareConfig, setCompareConfig] =
    useState<ComparativeViewConfig | null>(null)
  // ASSIST-03: whether the live compare config was promoted through the
  // canonical hand-off (CompareView Promote or the guide accept — both feed
  // the same follow-on). Session state only; resets with the dataset.
  const [comparePromoted, setComparePromoted] = useState(false)
  const [configOpen, setConfigOpen] = useState(true)
  const [viewName, setViewName] = useState('')
  const [exportSettings, setExportSettings] = useState<ExportSettings>(
    DEFAULT_EXPORT_SETTINGS,
  )

  // Auto-select the first dataset once the list loads.
  useEffect(() => {
    if (!selectedDatasetId && datasets.length > 0) {
      setSelectedDatasetId(datasets[0].id)
    }
    if (
      selectedDatasetId &&
      datasets.length > 0 &&
      !datasets.some((d) => d.id === selectedDatasetId)
    ) {
      setSelectedDatasetId(datasets[0].id)
    }
  }, [datasets, selectedDatasetId])
  const selectedDataset = useMemo(
    () => datasets.find((d) => d.id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId],
  )
  const selectedSource = useMemo(
    () => (selectedDataset ? toCanonicalDatasetSource(selectedDataset) : null),
    [selectedDataset],
  )
  const sources = useMemo(
    () => datasets.map(toCanonicalDatasetSource),
    [datasets],
  )

  // Build a default spec when the dataset changes (or load a saved view).
  useEffect(() => {
    if (selectedDataset) {
      const next = buildDefaultChartSpec(selectedDataset)
      if (next && search.x) next.fields.x = { fieldId: search.x }
      if (next && search.y) next.fields.y = { fieldId: search.y }
      setSpec(next)
      setSelectedViewId(null)
      setViewName('')
    }
  }, [selectedDataset, search.x, search.y])
  // Build a default compare config when the dataset (or its columns) change.
  // Explicit source fields only — never label-inferred.
  useEffect(() => {
    if (selectedSource) {
      setCompareConfig(
        buildDefaultComparativeViewConfig({
          datasetId: selectedSource.datasetId,
          columns: selectedSource.columns.map((column) => ({
            id: column.id,
            logicalType: column.logicalType,
          })),
        }),
      )
    } else {
      setCompareConfig(null)
    }
    setComparePromoted(false)
  }, [selectedSource])

  // Live preview resolution: read source data read-only (never mutate). The
  // materialised chart is lifted here so the preview and the export panel
  // share one authoritative materialisation.
  const { datasetQuery } = useLiveChartDataset(spec)
  const liveMaterialised = useMemo(
    () =>
      spec
        ? materialiseLiveChart(spec, datasetQuery.data ?? null)
        : missingDatasetChart(),
    [spec, datasetQuery.data],
  )
  const analysisMaterialised = useMemo(() => {
    if (!spec || !datasetQuery.data) return liveMaterialised
    return materialiseAnalysisChart(
      spec,
      datasetQuery.data.source.columns,
      datasetQuery.data.rows,
    )
  }, [spec, datasetQuery.data, liveMaterialised])
  const analysisFacets = useMemo(() => {
    if (!spec || !datasetQuery.data || !spec.fields.facet) {
      return { panels: [], total: 0 }
    }
    return materialiseAnalysisFacets(
      spec,
      datasetQuery.data.source.columns,
      datasetQuery.data.rows,
    )
  }, [spec, datasetQuery.data])

  // Canonical hand-off shared by the CompareView Promote button and the
  // ASSIST-03 guide accept: the promoted ChartSpec becomes the chart builder
  // spec, where save/export/freeze already live.
  function promoteCompareToChart(promoted: ChartSpec) {
    setSpec(promoted)
    setSelectedViewId(null)
    setViewName('')
    setComparePromoted(true)
    setMode('chart')
  }

  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!spec || !viewName.trim()) return
      const sourceRevisions = captureSourceRevisions(sources, spec)
      return saveAnalysisView(
        analysisStudioDataClient,
        {
          id: selectedViewId ?? undefined,
          name: viewName.trim(),
          spec,
          source_revisions: sourceRevisions,
          export_settings: exportSettings,
        },
        workspaceId,
        userId,
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisStudioQueryKeys.views })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      deleteAnalysisView(analysisStudioDataClient, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisStudioQueryKeys.views })
    },
  })

  function loadView(view: AnalysisViewWire) {
    setSelectedViewId(view.id)
    setViewName(view.name)
    setSpec(view.spec)
    if (view.export_settings) setExportSettings(view.export_settings)
    const datasetId = view.spec.datasets[0]?.datasetId ?? null
    if (datasetId && datasets.some((d) => d.id === datasetId)) {
      setSelectedDatasetId(datasetId)
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

  const selectedDatasetForCrumb = selectedDatasetId
    ? datasets.find((dataset) => dataset.id === selectedDatasetId)
    : null

  useShell({
    context: shellContext,
    breadcrumbs: [
      { label: 'Home', to: '/' },
      { label: 'Analysis', to: '/analysis' },
      // NAV-02: the analysed dataset is context, resolved from the stable
      // ?dataset= ID and linked back to its canonical explorer page.
      ...(selectedDatasetForCrumb
        ? [
            {
              label: selectedDatasetForCrumb.name,
              to: `/datasets?dataset=${encodeURIComponent(selectedDatasetForCrumb.id)}`,
            },
          ]
        : []),
    ],
    inspectorCollapsible: true,
    inspectorLabel: 'Chart settings',
    inspector:
      selectedSource && spec ? (
        <AnalysisInspector
          source={selectedSource}
          spec={spec}
          onSpecChange={setSpec}
          views={views}
          selectedViewId={selectedViewId}
          viewName={viewName}
          onViewNameChange={setViewName}
          onLoad={loadView}
          onSave={() => saveMutation.mutate()}
          onDelete={(id) => deleteMutation.mutate(id)}
          saving={saveMutation.isPending}
          exportSettings={exportSettings}
          onExportSettingsChange={setExportSettings}
          sources={sources}
          user={{ id: userId, name: context.user.name }}
          materialised={analysisMaterialised}
          selection={chartSelection}
        />
      ) : undefined,
  })

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-border/60 px-4 pt-4 md:px-6 md:pt-6">
          <PageHeader
            title="Analysis Studio"
            description="Build reproducible charts from typed specifications. Preview without mutating sources; save, share and export with provenance."
            className="border-0 pb-4 md:flex-col md:items-start xl:flex-row xl:items-end"
          >
            <AnalysisStudioHeader
              datasets={datasets}
              loading={summariesQuery.isLoading}
              error={summariesQuery.error}
              selectedDatasetId={selectedDatasetId}
              onSelect={setSelectedDatasetId}
            />
          </PageHeader>
          <div className="flex flex-wrap items-center gap-2 pb-2.5">
            <div
              role="tablist"
              aria-label="Studio mode"
              className="flex items-center gap-1"
            >
              {(['chart', 'analyse', 'compare'] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={mode === value ? 'default' : 'outline'}
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => setMode(value)}
                >
                  {value === 'chart'
                    ? 'Chart builder'
                    : value === 'analyse'
                      ? 'Analyse'
                      : 'Compare'}
                </Button>
              ))}
            </div>
            {mode === 'chart' && selectedSource && spec ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-expanded={configOpen}
                aria-controls="analysis-chart-config"
                onClick={() => setConfigOpen((open) => !open)}
              >
                {configOpen ? (
                  <PanelLeftClose className="size-4" aria-hidden="true" />
                ) : (
                  <PanelLeft className="size-4" aria-hidden="true" />
                )}
                {configOpen ? 'Hide encodings' : 'Show encodings'}
              </Button>
            ) : null}
          </div>
        </div>
        {mode === 'analyse' ? (
          <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
            <AnalysisPanel
              datasets={sources}
              datasetCatalogue={datasets}
              workspaceId={workspaceId}
              userId={userId}
            />
          </div>
        ) : mode === 'compare' ? (
          <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
            {/* ASSIST-03: step-aware guidance for dataset → compare → chart
                propose → notebook embed. The guide reads the same live studio
                state as the Compare tab it sits beside; its propose accept
                runs the identical promote hand-off as the manual Promote
                button below. */}
            {selectedSource ? (
              <div className="mb-3">
                <AnalysisFigureGuide
                  datasetId={selectedSource.datasetId}
                  columnCount={selectedSource.columns.length}
                  rowCount={datasetQuery.data?.rows.length ?? 0}
                  compareConfig={compareConfig}
                  columns={
                    datasetQuery.data?.source.columns ?? selectedSource.columns
                  }
                  chartSpecReady={comparePromoted}
                  onPromoteGuide={promoteCompareToChart}
                  onNavigateGuide={(href) => {
                    window.location.assign(href)
                  }}
                />
              </div>
            ) : null}
            {selectedSource && compareConfig ? (
              <CompareView
                source={selectedSource}
                columns={
                  datasetQuery.data?.source.columns ?? selectedSource.columns
                }
                rows={datasetQuery.data?.rows ?? []}
                loading={datasetQuery.isLoading}
                error={datasetQuery.error ? String(datasetQuery.error) : null}
                config={compareConfig}
                onConfigChange={setCompareConfig}
                onPromote={promoteCompareToChart}
              />
            ) : (
              <EmptyAnalysisState
                loading={summariesQuery.isLoading}
                error={summariesQuery.error}
              />
            )}
          </div>
        ) : selectedSource && spec ? (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {configOpen ? (
              <aside
                id="analysis-chart-config"
                className="flex w-64 shrink-0 flex-col overflow-y-auto border-r"
              >
                <ChartConfigurator
                  source={selectedSource}
                  spec={spec}
                  onSpecChange={setSpec}
                  idPrefix="analysis"
                  layout="rail"
                />
              </aside>
            ) : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <AnalysisPreview
                source={selectedSource}
                spec={spec}
                sources={sources}
                selectedViewId={selectedViewId}
                views={views}
                datasetQuery={datasetQuery}
                materialised={analysisMaterialised}
                facets={
                  analysisFacets.panels.length > 0 ? analysisFacets : null
                }
                selection={chartSelection}
                onSelectionChange={setChartSelection}
              />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 p-4 md:p-6">
            <EmptyAnalysisState
              loading={summariesQuery.isLoading}
              error={summariesQuery.error}
            />
          </div>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Header + dataset selector
// ---------------------------------------------------------------------------

interface AnalysisStudioHeaderProps {
  datasets: CanonicalDatasetWire[]
  loading: boolean
  error: unknown
  selectedDatasetId: string | null
  onSelect: (id: string) => void
}

export function AnalysisStudioHeader({
  datasets,
  loading,
  error,
  selectedDatasetId,
  onSelect,
}: AnalysisStudioHeaderProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const selectedDataset =
    datasets.find((d) => d.id === selectedDatasetId) ?? null
  return (
    <div className="flex items-center gap-2">
      {error ? (
        <Badge variant="danger">Could not load datasets</Badge>
      ) : loading ? (
        <Skeleton className="h-7 w-48" />
      ) : datasets.length === 0 ? (
        <Badge variant="outline">No datasets</Badge>
      ) : (
        <Field className="flex shrink-0 items-center gap-2">
          <FieldLabel
            htmlFor="analysis-data-source"
            className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
          >
            Data source
          </FieldLabel>
          <Button
            id="analysis-data-source"
            variant="outline"
            size="sm"
            role="combobox"
            aria-label="Select data source"
            aria-expanded={pickerOpen}
            aria-haspopup="dialog"
            onClick={() => setPickerOpen(true)}
            className="h-8 w-56 justify-between bg-background px-2.5 text-xs font-normal"
          >
            <span className="truncate text-foreground">
              {selectedDataset
                ? `${selectedDataset.name}${selectedDataset.dataset_schema ? ` · ${selectedDataset.dataset_schema.slug}` : ''}`
                : 'Select dataset'}
            </span>
            <ChevronsUpDown
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </Button>
          <DatasetPickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            datasets={datasets}
            selectedId={selectedDatasetId}
            onSelect={onSelect}
          />
        </Field>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export function FilterControls({
  source,
  spec,
  onSpecChange,
}: {
  source: CanonicalDatasetSource
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
    const column = source.columns.find(
      (c) => !spec.filters.some((f) => f.fieldId === c.id),
    )
    if (!column) return
    onSpecChange({
      ...spec,
      filters: [...spec.filters, { fieldId: column.id, op: 'eq', value: '' }],
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
        const column = source.columns.find((c) => c.id === filter.fieldId)
        return (
          <div key={filter.fieldId + i} className="flex items-center gap-1.5">
            <span className="flex-1 truncate text-xs text-muted-foreground">
              {column?.label ?? filter.fieldId}
            </span>
            <Field className="w-24">
              <FieldLabel
                className="sr-only"
                htmlFor={`filter-${filter.fieldId}-${i}`}
              >
                Filter value
              </FieldLabel>
              <Input
                id={`filter-${filter.fieldId}-${i}`}
                aria-label={`Filter value for ${column?.label ?? filter.fieldId}`}
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

function SelectedPointSummary({
  materialised,
  selection,
}: {
  materialised: ReturnType<typeof materialiseLiveChart>
  selection: ChartSelection | null
}) {
  const series = selection
    ? materialised.series.find(
        (item) => item.identifier === selection.seriesIdentifier,
      )
    : undefined
  const point = series?.points[selection?.index ?? -1]
  if (!point) {
    return (
      <p className="text-xs text-muted-foreground">
        Click a point or use the arrow keys on the figure to inspect a Dataset
        row.
      </p>
    )
  }
  return (
    <PropertyList>
      <Property label="Series">{series.label}</Property>
      <Property label="X">{formatScientific(point.x)}</Property>
      <Property label="Y">{formatScientific(point.y)}</Property>
      <Property label="Dataset row">
        {point.rowId ?? 'Not attached (frozen or aggregated)'}
      </Property>
    </PropertyList>
  )
}

function AnalysisInspector({
  source,
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
  sources,
  user,
  materialised,
  selection,
}: {
  source: CanonicalDatasetSource
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
  sources: CanonicalDatasetSource[]
  user: { id: string; name: string }
  materialised: ReturnType<typeof materialiseLiveChart>
  selection: ChartSelection | null
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
                  source={source}
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
              <InspectorSection title="Selected point">
                <SelectedPointSummary
                  materialised={materialised}
                  selection={selection}
                />
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
              sources={sources}
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
  sources: CanonicalDatasetSource[]
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
  sources,
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

  async function doExport(): Promise<void> {
    const selectedView = views.find((v) => v.id === selectedViewId) ?? null
    const sourceRevisions = captureSourceRevisions(sources, spec)
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
    const filename = (viewName || 'analysis').replace(/[^a-z0-9_-]+/gi, '_')
    if (settings.format === 'png') {
      const svg = exportChartSvg(svgRef.current, settings, provenance)
      const blob = await rasteriseSvgToPng(svg, {
        format: 'png',
        width: settings.width,
        height: settings.height,
        scale: 2,
        background: settings.theme === 'dark' ? 'opaque' : 'opaque',
        includeProvenance: settings.includeProvenance,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return
    }
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
    a.download = `${filename}.${ext}`
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
            <option value="png">PNG (publication raster)</option>
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
  source: CanonicalDatasetSource
  spec: ChartSpec
  sources: CanonicalDatasetSource[]
  selectedViewId: string | null
  views: AnalysisViewWire[]
  datasetQuery: ReturnType<typeof useLiveChartDataset>['datasetQuery']
  materialised: ReturnType<typeof materialiseLiveChart>
  facets: FacetedResult | null
  selection: ChartSelection | null
  onSelectionChange: (selection: ChartSelection | null) => void
}

export function AnalysisPreview({
  source,
  spec,
  sources,
  selectedViewId,
  views,
  datasetQuery,
  materialised: analysisMaterialised,
  facets,
  selection,
  onSelectionChange,
}: AnalysisPreviewProps) {
  const [dataPreviewOpen, setDataPreviewOpen] = useState(false)
  const validation = useMemo(
    () => validateAnalysisSpec(spec, datasetQuery.data?.rows.length ?? 0),
    [spec, datasetQuery.data],
  )

  // Stale-source detection against the saved view's stored revisions.
  const staleDetail = useMemo(() => {
    if (!selectedViewId) return null
    const view = views.find((v) => v.id === selectedViewId)
    if (!view) return null
    return detectStaleSources(view.source_revisions, sources)
  }, [selectedViewId, views, sources])

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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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

        <div
          className="min-h-0 min-w-0 flex-1 overflow-hidden px-2 pb-1"
          data-analysis-chart
        >
          <ChartRenderer
            title={`${source.name} — ${spec.type} chart`}
            spec={spec}
            materialised={analysisMaterialised}
            frozen={null}
            loading={datasetQuery.isLoading}
            fillPlot
            hideTitle
            showTableAlternative={false}
            facets={facets?.panels ?? undefined}
            facetTotal={facets?.total}
            selection={selection}
            onSelectionChange={onSelectionChange}
            className="h-full rounded-none border-0 bg-transparent shadow-none"
          />
        </div>
      </div>

      <div className="shrink-0 border-t">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs font-medium"
          aria-expanded={dataPreviewOpen}
          onClick={() => setDataPreviewOpen((open) => !open)}
        >
          <span>Data preview</span>
          {dataPreviewOpen ? (
            <ChevronUp className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          )}
        </button>
        {dataPreviewOpen ? (
          <div className="max-h-40 overflow-hidden">
            <DataTableAlternative
              materialised={analysisMaterialised}
              loading={datasetQuery.isLoading}
              selection={selection}
            />
          </div>
        ) : null}
      </div>
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
  selection = null,
}: {
  materialised: ReturnType<typeof materialiseLiveChart>
  loading: boolean
  selection?: ChartSelection | null
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
        key: column.id,
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
              rows.map((row, i) => {
                const selectedRowId = selection
                  ? materialised.series.find(
                      (item) => item.identifier === selection.seriesIdentifier,
                    )?.points[selection.index]?.rowId
                  : undefined
                const isSelected =
                  selectedRowId && row[CHART_ROW_ID_KEY] === selectedRowId
                return (
                  <TableRow
                    key={i}
                    className={isSelected ? 'bg-muted' : undefined}
                  >
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
                )
              })
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
    droppedPoints: 0,
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
            Create a dataset first, then return here to build charts and compare
            results.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/datasets" search={{ dataset: '' }}>
              Open datasets
            </Link>
          </Button>
        </>
      )}
    </div>
  )
}

export { CHART_PALETTE, CHART_SPEC_VERSION }
