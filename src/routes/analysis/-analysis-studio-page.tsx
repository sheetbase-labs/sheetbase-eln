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
import { z } from 'zod'

import { t } from '#/copy'
import { RecordPicker } from '#/components/record-picker/record-picker'
import type { PickerItem } from '#/components/record-picker/record-picker-data'
import { insertBlock } from '#/lib/notebook-mutations'
import { downloadTextFile } from '#/lib/download'
import { fetchRecord, notebookDataClient } from '#/lib/notebook-data'
import { toast } from '#/components/ui/sonner'
import { Spinner } from '#/components/ui/spinner'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { useQuery } from '@tanstack/react-query'
import {
  Link,
  getRouteApi,
  useBlocker,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type { ChartSelection } from '#/components/viz/chart-renderer'
import { ChartConfigurator } from '#/components/viz/chart-configurator'
import { Icon } from '#/components/icons'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { Inspector as InspectorPanel } from '#/components/ui/layout'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Field, Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { Select } from '#/components/ui/select'
import { PreviewGrid } from '#/components/inventory/preview-grid'
import { Inspector } from '#/components/record/inspector'
import { InspectorSection, InspectorSectionStack } from '#/components/record'
import { FigureControls } from '#/components/viz/figure-controls'
import { Property, PropertyList } from '#/components/scientific'
import { freezeChart } from '#/lib/chart-data'
import { specSourceDatasetId } from '#/lib/analysis-spec-source'
import { stableStringify } from '#/lib/notebook-submission'
import type { ComparativeViewConfig } from '#/lib/comparative-view'
import { buildDefaultChartSpec } from '#/lib/dataset-explorer-data'
import { buildDefaultComparativeViewConfig } from '#/lib/comparative-view'
import type {
  CanonicalDatasetSource,
  materialiseLiveChart,
  useLiveChartDataset,
} from '#/lib/chart-data'
import {
  composeAnalysisDefinition,
  freezeAnalysisBlock,
} from '#/lib/analysis-definitions-data'
import {
  AXIS_SCALES,
  CHART_PALETTE,
  CHART_SPEC_VERSION,
  CHART_TYPE_LABELS,
  formatScientific,
} from '#/lib/chart-spec'
import type { AxisScale, ChartRow, ChartSpec } from '#/lib/chart-spec'
import {
  ANALYSIS_MAX_FILTERS,
  ANALYSIS_MAX_RESULT_ROWS,
  analysisStudioDataClient,
  buildExportProvenance,
  DEFAULT_EXPORT_SETTINGS,
  captureSourceRevisions,
  detectStaleSources,
  captionBlockHeight,
  exportChartSvg,
  exportDataCsv,
  exportViewJson,
  recordAnalysisCitation,
  saveAnalysisView,
  validateAnalysisSpec,
} from '#/lib/analysis-studio-data'
import type {
  AnalysisSourceResolution,
  AnalysisSourceState,
  AnalysisViewCitation,
  AnalysisViewSourceStatus,
  AnalysisViewWire,
  FacetedResult,
  ExportSettings,
} from '#/lib/analysis-studio-data'
import { CitationList } from '#/components/viz/citation-list'
import { formatCount } from '#/lib/format-numbers'
import { cn } from '#/lib/utils'
import { rasteriseSvgToPng } from '#/lib/visualisation-export'
import { CHART_ROW_ID_KEY } from '#/lib/visualisation-pipeline'

import {
  AnalysisModeSection,
  AnalysisStudioHeader,
  AnalysisStudioSnapshotBanner,
  AnalysisStudioToolbar,
  CompareModeSection,
  DeleteAnalysisViewDialog,
  EmptyAnalysisState,
} from './-analysis-studio-sections'
import type { StudioMode } from './-analysis-studio-modes'
import {
  chartsToSave,
  useAnalysisStudioChartData,
  useAnalysisStudioReads,
  useAnalysisStudioSavedViews,
  useAnalysisStudioSources,
  useAnalysisStudioSourceStatus,
} from './-analysis-studio-hooks'

export { AnalysisStudioHeader, EmptyAnalysisState }

const Route = getRouteApi('/analysis/new')

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

const axisScaleSchema = z.enum(AXIS_SCALES)

const exportFormatSchema = z.enum(['json', 'csv', 'svg', 'png'])

const exportThemeSchema = z.enum(['light', 'dark'])

const filterValueSchema = z.union([z.string(), z.number(), z.boolean()])

/** A filter's value as the field shows it. */
/** A filter's value as the field shows it. */
function filterText(
  value: Parameters<typeof filterValueSchema.safeParse>[0],
): string {
  const decoded = filterValueSchema.safeParse(value)

  return decoded.success ? `${decoded.data}` : ''
}

/** The studio's state: what it reads, which dataset and snapshot are selected,
 * the chart draft and its saved views, the compare configuration, and the
 * materialised preview. The reads and writes live in the hooks beside it; the
 * state they feed, and the effects that adjust it, stay here so each effect
 * reads only values this hook owns. */
function useAnalysisStudio() {
  const instanceId = useId()
  const chartConfigId = `${instanceId}-chart-config`
  const chartRoot = useRef<HTMLDivElement | null>(null)
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const workspaceId = context.workspace?.id ?? 'no-workspace'
  const userId = context.user.id

  const reads = useAnalysisStudioReads()
  const { datasets, views } = reads

  // -- Selection ------------------------------------------------------------
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(
    search.dataset ?? null,
  )

  // The snapshot named by `?snapshot=` belongs to the dataset named by
  // `?dataset=`; choosing another dataset leaves it behind.
  const [snapshotId, setSnapshotId] = useState<string | null>(
    search.snapshot ?? null,
  )

  const activeSnapshotId =
    snapshotId && selectedDatasetId === search.dataset ? snapshotId : null

  // Read when a default spec is built, without rebuilding (and so discarding
  // the user's encodings) when they switch back to live data.
  const activeSnapshotRef = useRef(activeSnapshotId)
  useEffect(() => {
    activeSnapshotRef.current = activeSnapshotId
  }, [activeSnapshotId])

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

  const { selectedDataset, selectedSource, sources } = useAnalysisStudioSources(
    {
      datasets,
      selectedDatasetId,
    },
  )

  // The default-spec rebuild below is keyed on the dataset's id, not the
  // object: a background refetch of the list hands back new objects for the
  // same dataset, and rebuilding then would drop the saved view just opened.
  const selectedDatasetSnapshot = useRef<
    Parameters<typeof buildDefaultChartSpec>[0] | null
  >(null)

  useEffect(() => {
    selectedDatasetSnapshot.current = selectedDataset ?? null
  }, [selectedDataset])

  // -- Export settings ------------------------------------------------------
  const [exportSettings, setExportSettings] = useState<ExportSettings>(
    DEFAULT_EXPORT_SETTINGS,
  )

  // The saved-view loads below read the export settings of the moment without
  // re-running when the person edits them; this snapshot carries the latest
  // value, and the effect keeps it in step before those loads run.
  const exportSettingsSnapshot = useRef<ExportSettings>(DEFAULT_EXPORT_SETTINGS)
  useEffect(() => {
    exportSettingsSnapshot.current = exportSettings
  }, [exportSettings])

  // -- Chart draft ----------------------------------------------------------
  const [spec, setSpec] = useState<ChartSpec | null>(null)
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null)
  const [viewName, setViewName] = useState('')
  const [cleanChart, setCleanChart] = useState('')

  // What the chart looked like when it was last saved or loaded, so Discard
  // can put it back.
  const cleanSnapshot = useRef<{
    spec: ChartSpec | null
    name: string
    exportSettings: ExportSettings
  } | null>(null)

  function markClean(
    nextSpec: ChartSpec | null,
    name: string,
    nextExport: ExportSettings,
  ) {
    cleanSnapshot.current = {
      spec: nextSpec,
      name,
      exportSettings: nextExport,
    }
    chartDirtyRef.current = false
    setCleanChart(stableStringify([nextSpec, name, nextExport]))
  }

  const chartDraft = stableStringify([spec, viewName, exportSettings])
  const chartDirty = cleanChart !== '' && cleanChart !== chartDraft
  const chartDirtyRef = useRef(chartDirty)
  useEffect(() => {
    chartDirtyRef.current = chartDirty
  }, [chartDirty])
  useBlocker({
    shouldBlockFn: () => chartDirtyRef.current,
    enableBeforeUnload: false,
  })

  function discardChart() {
    const snapshot = cleanSnapshot.current

    if (!snapshot) return
    chartDirtyRef.current = false
    setSpec(snapshot.spec)
    setViewName(snapshot.name)
    setExportSettings(snapshot.exportSettings)
  }

  // A saved view whose dataset differs from the current selection is applied
  // by the dataset-change effect below; until then it waits here, so loading
  // it does not have its spec overwritten by the default rebuild.
  const pendingViewRef = useRef<AnalysisViewWire | null>(null)
  // The saved view named by `?view=` (the read-only route's "Edit in studio"
  // link); consumed once the view list resolves.
  const requestedViewRef = useRef<string | null>(search.view ?? null)
  // The dataset a `?view=` was applied on. React's dev double-run of effects
  // reruns the default-spec rebuild right after the view lands; the rebuild
  // skips once for this dataset so the opened view survives it.
  const requestedViewAppliedOnRef = useRef<string | null>(null)

  // Build a default spec when the dataset changes, or apply the saved view
  // whose dataset the user just switched to (loadView hands it over here so
  // the rebuild below cannot discard it).
  useEffect(() => {
    const dataset = selectedDatasetSnapshot.current

    if (!dataset) return
    const appliedOn = requestedViewAppliedOnRef.current
    requestedViewAppliedOnRef.current = null

    if (appliedOn === dataset.id && !pendingViewRef.current) return
    const pending = pendingViewRef.current

    if (pending) {
      pendingViewRef.current = null
      setSelectedViewId(pending.id)
      setViewName(pending.name)
      setSpec(pending.charts[0])

      if (pending.export_settings) setExportSettings(pending.export_settings)
      markClean(
        pending.charts[0],
        pending.name,
        pending.export_settings ?? exportSettingsSnapshot.current,
      )

      return
    }

    const next = buildDefaultChartSpec(dataset)

    if (next && search.x) next.fields.x = { fieldId: search.x }

    if (next && search.y) next.fields.y = { fieldId: search.y }

    if (next && activeSnapshotRef.current)
      next.datasets = [
        {
          datasetId: next.datasets[0].datasetId,
          datasetVersionId: activeSnapshotRef.current,
        },
      ]
    setSpec(next)
    setSelectedViewId(null)
    setViewName('')
    markClean(next, '', exportSettingsSnapshot.current)
    // Keyed on the dataset's id: the dataset object itself arrives again on
    // every list refetch, and the guard above is what keeps the open view.
  }, [selectedDataset?.id, search.x, search.y])

  function loadView(view: AnalysisViewWire) {
    const datasetId = specSourceDatasetId(view.charts[0]) ?? null

    const targetId =
      datasetId && datasets.some((d) => d.id === datasetId) ? datasetId : null

    if (targetId && targetId !== selectedDatasetId) {
      // Switching dataset rebuilds a default spec in the effect above and
      // would wipe the loaded view, so hand it to that effect instead.
      pendingViewRef.current = view
      setSelectedDatasetId(targetId)

      return
    }

    setSelectedViewId(view.id)
    setViewName(view.name)
    setSpec(view.charts[0])

    if (view.export_settings) setExportSettings(view.export_settings)
    markClean(
      view.charts[0],
      view.name,
      view.export_settings ?? exportSettingsSnapshot.current,
    )
  }

  // `?view=<id>` (the read-only analysis route's "Edit in studio" link): load
  // the named saved view once the list resolves, exactly as the Load button
  // does. Consumed once so a later list refresh does not reapply it.
  useEffect(() => {
    const requested = requestedViewRef.current

    // Wait for the dataset list too: until it loads, the view's dataset cannot
    // be matched, and the default-spec rebuild after auto-select would wipe it.
    if (!requested || views.length === 0 || reads.summariesQuery.isLoading)
      return
    requestedViewRef.current = null
    const view = views.find((candidate) => candidate.id === requested)

    if (!view) return
    const datasetId = specSourceDatasetId(view.charts[0]) ?? null

    const targetId =
      datasetId && datasets.some((d) => d.id === datasetId) ? datasetId : null

    if (targetId && targetId !== selectedDatasetId) {
      pendingViewRef.current = view
      setSelectedDatasetId(targetId)

      return
    }

    requestedViewAppliedOnRef.current = selectedDatasetId
    setSelectedViewId(view.id)
    setViewName(view.name)
    setSpec(view.charts[0])

    if (view.export_settings) setExportSettings(view.export_settings)
    markClean(
      view.charts[0],
      view.name,
      view.export_settings ?? exportSettingsSnapshot.current,
    )
  }, [views, datasets, selectedDatasetId, reads.summariesQuery.isLoading])

  // -- Mode and inspector ---------------------------------------------------
  // SCI-02: the studio serves both chart authoring and reusable analysis
  // definitions; the mode is session state, never persisted server-side.
  // VIEW-03 adds the compare mode: grouped time-series / distribution
  // inspection over the same live rows, promoting into the chart builder.
  const [mode, setMode] = useState<StudioMode>(
    search.mode === 'analyse' || search.mode === 'compare'
      ? search.mode
      : 'chart',
  )

  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(true)

  const [chartSelection, setChartSelection] = useState<ChartSelection | null>(
    null,
  )

  // -- Compare configuration ------------------------------------------------
  const [compareConfig, setCompareConfig] =
    useState<ComparativeViewConfig | null>(null)

  // ASSIST-03: whether the live compare config was promoted through the
  // canonical hand-off (CompareView Promote or the guide accept — both feed
  // the same follow-on). Session state only; resets with the dataset.
  const [comparePromoted, setComparePromoted] = useState(false)

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

  // -- Preview --------------------------------------------------------------
  const chart = useAnalysisStudioChartData({ spec })

  // -- Saved views ----------------------------------------------------------
  const savedViews = useAnalysisStudioSavedViews({
    search,
    workspaceId,
    userId,
    views,
    sources,
    spec,
    viewName,
    selectedDataset,
    selectedViewId,
    setSelectedViewId,
    setViewName,
    exportSettings,
    markClean,
    chartDirty,
    discardChart,
  })

  const sourceState = useAnalysisStudioSourceStatus({ selectedViewId })

  const router = useRouter()

  // Back to the live dataset: forget the snapshot and unpin the spec's sources.
  function clearSnapshot() {
    setSnapshotId(null)
    setSpec((current) =>
      current
        ? {
            ...current,
            datasets: current.datasets.map(({ datasetId }) => ({ datasetId })),
          }
        : current,
    )
  }

  return {
    instanceId,
    chartConfigId,
    chartRoot,
    search,
    workspaceId,
    userId,
    summariesQuery: reads.summariesQuery,
    datasets,
    views,
    selectedDatasetId,
    setSelectedDatasetId,
    spec,
    setSpec,
    inspectorOpen,
    setInspectorOpen,
    setSnapshotId,
    activeSnapshotId,
    selectedViewId,
    viewName,
    setViewName,
    loadView,
    exportSettings,
    setExportSettings,
    user: { id: userId, name: context.user.name },
    chartSelection,
    setChartSelection,
    mode,
    setMode,
    compareConfig,
    setCompareConfig,
    comparePromoted,
    configOpen,
    setConfigOpen,
    chartDirty,
    discardChart,
    deleteTarget: savedViews.deleteTarget,
    setDeleteTarget: savedViews.setDeleteTarget,
    selectedSource,
    sources,
    analysisMaterialised: chart.analysisMaterialised,
    analysisFacets: chart.analysisFacets,
    promoteCompareToChart,
    router,
    clearSnapshot,
    saveMutation: savedViews.saveMutation,
    saveChart: savedViews.saveChart,
    deleteMutation: savedViews.deleteMutation,
    sourceStatusQuery: sourceState.sourceStatusQuery,
    citationsQuery: sourceState.citationsQuery,
    resolveMutation: sourceState.resolveMutation,
    datasetQuery: chart.datasetQuery,
  }
}

export function AnalysisStudio() {
  const studio = useAnalysisStudio()

  return (
    <div ref={studio.chartRoot} className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AnalysisStudioToolbar
          datasets={studio.datasets}
          loading={studio.summariesQuery.isLoading}
          error={studio.summariesQuery.error}
          selectedDatasetId={studio.selectedDatasetId}
          onSelectDataset={studio.setSelectedDatasetId}
          returnTo={studio.search.returnTo}
          mode={studio.mode}
          onModeChange={studio.setMode}
          hasInspector={Boolean(studio.selectedSource && studio.spec)}
          inspectorOpen={studio.inspectorOpen}
          onOpenInspector={() => studio.setInspectorOpen(true)}
          chartDirty={studio.chartDirty}
          saving={studio.saveMutation.isPending}
          onDiscard={studio.discardChart}
          onSave={() => void studio.saveChart()}
          selectedSource={studio.selectedSource}
          spec={studio.spec}
          configOpen={studio.configOpen}
          chartConfigId={studio.chartConfigId}
          onToggleConfig={() => studio.setConfigOpen((open) => !open)}
        />
        <AnalysisStudioSnapshotBanner
          mode={studio.mode}
          spec={studio.spec}
          onUseLive={studio.clearSnapshot}
        />
        {studio.mode === 'analyse' ? (
          <AnalysisModeSection
            sources={studio.sources}
            workspaceId={studio.workspaceId}
            userId={studio.userId}
            selectedDatasetId={studio.selectedDatasetId}
            onDatasetChange={studio.setSelectedDatasetId}
            activeSnapshotId={studio.activeSnapshotId}
            definitionId={studio.search.definition}
            experimentId={studio.search.experiment}
          />
        ) : studio.mode === 'compare' ? (
          <CompareModeSection
            selectedSource={studio.selectedSource}
            datasetQuery={studio.datasetQuery}
            compareConfig={studio.compareConfig}
            comparePromoted={studio.comparePromoted}
            onPromote={studio.promoteCompareToChart}
            onCompareConfigChange={studio.setCompareConfig}
            onNavigate={(href) => {
              studio.router.history.push(href)
            }}
            sources={studio.sources}
            spec={studio.spec}
            datasetsLoading={studio.summariesQuery.isLoading}
            datasetsError={studio.summariesQuery.error}
          />
        ) : (
          <ChartModeSection studio={studio} />
        )}
      </div>
      <StudioInspector studio={studio} />
      <DeleteAnalysisViewDialog
        target={studio.deleteTarget}
        deleting={studio.deleteMutation.isPending}
        onDismiss={() => studio.setDeleteTarget(null)}
        onDelete={(id) => studio.deleteMutation.mutate(id)}
      />
    </div>
  )
}

/** What the studio's own hook returns: the state every section reads. */
type AnalysisStudioState = ReturnType<typeof useAnalysisStudio>

/**
 * The Chart builder body: the encodings rail beside the live preview, or the
 * empty state until a dataset with a spec is chosen.
 */
function ChartModeSection({ studio }: { studio: AnalysisStudioState }) {
  const { selectedSource, spec } = studio

  if (!selectedSource || !spec) {
    return (
      <div className="min-h-0 flex-1 p-3">
        <EmptyAnalysisState
          loading={studio.summariesQuery.isLoading}
          error={studio.summariesQuery.error}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {studio.configOpen ? (
        <aside
          id={studio.chartConfigId}
          data-analysis-chart-config
          className="flex w-56 shrink-0 flex-col overflow-y-auto border-r"
        >
          <ChartConfigurator
            source={selectedSource}
            spec={spec}
            onSpecChange={studio.setSpec}
            idPrefix={studio.instanceId}
            layout="rail"
          />
        </aside>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AnalysisPreview
          source={selectedSource}
          spec={spec}
          sources={studio.sources}
          selectedViewId={studio.selectedViewId}
          views={studio.views}
          datasetQuery={studio.datasetQuery}
          materialised={studio.analysisMaterialised}
          facets={
            studio.analysisFacets.panels.length > 0
              ? studio.analysisFacets
              : null
          }
          selection={studio.chartSelection}
          onSelectionChange={studio.setChartSelection}
          sourceStatus={studio.sourceStatusQuery.data ?? null}
          sourceStatusError={
            studio.sourceStatusQuery.error
              ? String(studio.sourceStatusQuery.error)
              : null
          }
          resolving={studio.resolveMutation.isPending}
          onResolve={(resolution) => studio.resolveMutation.mutate(resolution)}
        />
      </div>
    </div>
  )
}

/**
 * The chart-settings inspector beside the studio, and its narrow-screen
 * dialog: the same `AnalysisInspector` content either way, drawn only while a
 * source and a chart spec are selected.
 */
function StudioInspector({ studio }: { studio: AnalysisStudioState }) {
  const { selectedSource, spec } = studio

  if (!selectedSource || !spec) return null

  return (
    <InspectorPanel
      label={t('data.analysisStudio.chartSettings')}
      open={studio.inspectorOpen}
      onOpenChange={studio.setInspectorOpen}
      className="w-[340px] gap-0 p-0"
    >
      <div className="flex flex-col gap-5 overflow-auto p-4">
        <AnalysisInspector
          chartRoot={studio.chartRoot}
          source={selectedSource}
          spec={spec}
          mode={studio.mode}
          onSpecChange={studio.setSpec}
          views={studio.views}
          selectedViewId={studio.selectedViewId}
          viewName={studio.viewName}
          onViewNameChange={studio.setViewName}
          onLoad={studio.loadView}
          onSave={(asNew) => studio.saveMutation.mutate({ asNew })}
          onDelete={(view) => studio.setDeleteTarget(view)}
          saving={studio.saveMutation.isPending}
          exportSettings={studio.exportSettings}
          onExportSettingsChange={studio.setExportSettings}
          sources={studio.sources}
          user={studio.user}
          workspaceId={studio.workspaceId}
          materialised={studio.analysisMaterialised}
          selection={studio.chartSelection}
          citations={studio.citationsQuery.data ?? []}
          citationsLoading={studio.citationsQuery.isLoading}
          citationsError={
            studio.citationsQuery.error
              ? String(studio.citationsQuery.error)
              : null
          }
          sourceStatus={studio.sourceStatusQuery.data ?? null}
          experimentId={studio.search.experiment}
        />
      </div>
    </InspectorPanel>
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
  const id = useId()

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
            <span className="flex-1 truncate text-xs text-fg-muted">
              {column?.label ?? filter.fieldId}
            </span>
            <div className="w-24">
              <label
                className="sr-only"
                htmlFor={`${id}-filter-${filter.fieldId}-${i}`}
              >
                {t('data.analysisStudio.filterValue')}
              </label>
              <Input
                id={`${id}-filter-${filter.fieldId}-${i}`}
                aria-label={t('data.analysisStudio.ariaFilterValue', {
                  value: column?.label ?? filter.fieldId,
                })}
                value={filterText(filter.value)}
                onChange={(e) => setFilter(i, e.target.value)}
                placeholder={t('data.analysisStudio.placeholderEq')}
                className="h-7 bg-surface text-xs"
              />
            </div>
            <Button
              variant="quiet"
              size="icon"
              aria-label={t('data.analysisStudio.ariaRemoveFilter')}
              onClick={() => removeFilter(i)}
            >
              <Icon name="trash" />
            </Button>
          </div>
        )
      })}
      {spec.filters.length < ANALYSIS_MAX_FILTERS ? (
        <Button variant="secondary" size="sm" onClick={addFilter}>
          {t('data.analysisStudio.addFilter')}
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
      <p className="text-xs text-fg-muted">
        {t('data.analysisStudio.clickPointUseArrow')}
      </p>
    )
  }

  return (
    <PropertyList>
      <Property label={t('data.analysisStudio.series')}>
        {series.label}
      </Property>
      <Property label="X">{formatScientific(point.x)}</Property>
      <Property label="Y">{formatScientific(point.y)}</Property>
      <Property label={t('data.analysisStudio.datasetRow')}>
        {point.rowId ?? t('data.analysisStudio.attachedFrozenAggregated')}
      </Property>
    </PropertyList>
  )
}

function AnalysisInspector({
  chartRoot,
  source,
  spec,
  mode,
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
  workspaceId,
  materialised,
  selection,
  citations,
  citationsLoading,
  citationsError,
  sourceStatus,
  experimentId,
}: {
  chartRoot: React.RefObject<HTMLDivElement | null>
  source: CanonicalDatasetSource
  spec: ChartSpec
  mode: 'chart' | 'analyse' | 'compare'
  onSpecChange: (spec: ChartSpec) => void
  views: AnalysisViewWire[]
  selectedViewId: string | null
  viewName: string
  onViewNameChange: (name: string) => void
  onLoad: (view: AnalysisViewWire) => void
  onSave: (asNew?: boolean) => void
  onDelete: (view: AnalysisViewWire) => void
  saving: boolean
  exportSettings: ExportSettings
  onExportSettingsChange: (settings: ExportSettings) => void
  sources: CanonicalDatasetSource[]
  user: { id: string; name: string }
  workspaceId: string
  materialised: ReturnType<typeof materialiseLiveChart>
  selection: ChartSelection | null
  citations: AnalysisViewCitation[]
  citationsLoading: boolean
  citationsError: string | null
  sourceStatus: AnalysisViewSourceStatus | null
  /** The experiment this analysis was opened from; Cite offers it first. */
  experimentId?: string
}) {
  const id = useId()

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
      <InspectorSection title={t('data.analysisStudio.axisScaling')}>
        <div className="grid gap-3">
          {(['x', 'y'] as const).map((axis) => (
            <Field
              key={axis}
              label={t('data.analysisStudio.axisScale', {
                toUpperCase: axis.toUpperCase(),
              })}
            >
              <Select
                id={`${id}-inspector-${axis}-scale`}
                value={spec.display.axes[axis].scale}
                onChange={(event) => {
                  const decoded = axisScaleSchema.safeParse(event.target.value)

                  if (decoded.success) setScale(axis, decoded.data)
                }}
              >
                {AXIS_SCALES.map((scale) => (
                  <option key={scale} value={scale}>
                    {scale === 'log'
                      ? t('data.analysisStudio.logarithmic')
                      : t('data.analysisStudio.linear')}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
      </InspectorSection>
      <FigureControls spec={spec} onSpecChange={onSpecChange} />
      <InspectorSection title={t('data.analysisStudio.appearance')}>
        <PropertyList>
          <Property label={t('data.analysisStudio.palette')}>
            {t('data.analysisStudio.publication')}
          </Property>
          <Property label={t('data.analysisStudio.font')}>
            {t('data.analysisStudio.instrumentSans')}
          </Property>
          <Property label={t('data.analysisStudio.series')}>
            {materialised.series.length}
          </Property>
        </PropertyList>
      </InspectorSection>
    </InspectorSectionStack>
  )

  return (
    <Inspector
      recordType={t('data.analysisStudio.analysisConfiguration')}
      title={t('data.analysisStudio.chartSettings')}
      state="loaded"
      tabs={[
        {
          id: 'settings',
          label: t('data.analysisStudio.settings'),
          content: settings,
        },
        {
          id: 'views',
          label: t('data.analysisStudio.views'),
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
          id: 'citations',
          label: t('data.analysisStudio.citedBy'),
          badge: citations.length > 0 ? citations.length : undefined,
          content: (
            <InspectorSectionStack>
              <InspectorSection
                title={t('data.analysisStudio.recordsCitingAnalysis')}
              >
                <CitationList
                  citations={citations}
                  loading={citationsLoading}
                  error={citationsError}
                  emptyBody={
                    selectedViewId
                      ? t('data.analysisStudio.recordCitesAnalysisYet')
                      : t('data.analysisStudio.loadSaveAnalysisSee')
                  }
                />
              </InspectorSection>
              <InspectorSection
                title={t('data.analysisStudio.whatCitationMeans')}
              >
                <p className="text-label text-fg-muted">
                  {sourceStatus && sourceStatus.citedByCount > 0
                    ? t('data.analysisStudio.recordAnalysisLockedCited', {
                        count: sourceStatus.citedByCount,
                        locked: sourceStatus.citedByLockedCount,
                      })
                    : t('data.analysisStudio.citedAnalysisKeepsSources')}
                </p>
              </InspectorSection>
            </InspectorSectionStack>
          ),
        },
        {
          id: 'calculations',
          label: t('data.analysisStudio.calculations'),
          content: (
            <InspectorSectionStack>
              <InspectorSection title={t('data.analysisStudio.filters')}>
                <FilterControls
                  source={source}
                  spec={spec}
                  onSpecChange={onSpecChange}
                />
              </InspectorSection>
              <InspectorSection title={t('data.analysisStudio.summary')}>
                <PropertyList>
                  <Property label={t('data.analysisStudio.transformations')}>
                    {spec.transformations.length}
                  </Property>
                  <Property label={t('data.analysisStudio.filters')}>
                    {spec.filters.length}
                  </Property>
                </PropertyList>
              </InspectorSection>
              <InspectorSection title={t('data.analysisStudio.selectedPoint')}>
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
          label: t('common.actions.export'),
          content: (
            <ExportPanel
              chartRoot={chartRoot}
              spec={spec}
              mode={mode}
              settings={exportSettings}
              onSettingsChange={onExportSettingsChange}
              sources={sources}
              viewName={viewName}
              selectedViewId={selectedViewId}
              views={views}
              user={user}
              workspaceId={workspaceId}
              materialised={materialised}
              defaultExperimentId={experimentId}
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
  onSave: (asNew?: boolean) => void
  onDelete: (view: AnalysisViewWire) => void
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
  const id = useId()

  return (
    <section className="space-y-3" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-sm font-semibold">
        {t('data.analysisStudio.savedAnalysisViews')}
      </h2>
      <p className="text-xs text-fg-muted">
        {t('data.analysisStudio.saveNamedConfigurationSource')}
      </p>
      <div className="flex flex-wrap items-end gap-1.5">
        <div className="flex-1">
          <label className="text-label text-fg-muted" htmlFor={`${id}-name`}>
            {t('data.analysisStudio.name')}
          </label>
          <Input
            id={`${id}-name`}
            aria-label={t('data.analysisStudio.ariaAnalysisViewName')}
            value={viewName}
            onChange={(e) => onViewNameChange(e.target.value)}
            placeholder={t('data.analysisStudio.placeholderEGPhVs')}
            className="h-8 bg-surface"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSave(false)}
          disabled={!canSave || saving}
          aria-label={t('data.analysisStudio.ariaSaveAnalysisView')}
        >
          {saving ? <Spinner size={16} /> : <Icon name="save" />}
          {selectedViewId
            ? t('data.analysisStudio.update')
            : t('common.actions.save')}
        </Button>
        {selectedViewId ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onSave(true)}
            disabled={!canSave || saving}
            aria-label={t('data.analysisStudio.ariaSaveNewAnalysisView')}
          >
            {t('data.analysisStudio.saveNew')}
          </Button>
        ) : null}
      </div>
      {views.length === 0 ? (
        <p className="py-2 text-center text-xs text-fg-muted">
          {t('data.analysisStudio.savedViewsYet')}
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
                  selected && 'border-review bg-review-wash',
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col text-left"
                  onClick={() => onLoad(view)}
                  aria-label={t('data.analysisStudio.ariaLoadView', {
                    name: view.name,
                  })}
                >
                  <span className="truncate font-medium">{view.name}</span>
                  <span className="text-xs text-fg-muted">
                    {t('data.analysisStudio.vSource', {
                      version: view.version,
                      count: view.source_revisions.length,
                    })}
                  </span>
                </button>
                <Button
                  variant="quiet"
                  size="icon"
                  aria-label={t('data.analysisStudio.ariaDeleteView', {
                    name: view.name,
                  })}
                  onClick={() => onDelete(view)}
                >
                  <Icon name="trash" />
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
  chartRoot: React.RefObject<HTMLDivElement | null>
  spec: ChartSpec
  mode: 'chart' | 'analyse' | 'compare'
  settings: ExportSettings
  onSettingsChange: (settings: ExportSettings) => void
  sources: CanonicalDatasetSource[]
  viewName: string
  selectedViewId: string | null
  views: AnalysisViewWire[]
  user: { id: string; name: string }
  workspaceId: string
  materialised: ReturnType<typeof materialiseLiveChart>
  /** The experiment the studio was opened from, if any. */
  defaultExperimentId?: string
}

/**
 * The studio edits one chart. Saving over an existing analysis keeps the
 * charts after the first that the analysis page added.
 */
export function ExportPanel({
  chartRoot,
  spec,
  mode,
  settings,
  onSettingsChange,
  sources,
  viewName,
  selectedViewId,
  views,
  user,
  workspaceId,
  materialised,
  defaultExperimentId,
}: ExportPanelProps) {
  const id = useId()
  const navigate = useNavigate()
  const [citeOpen, setCiteOpen] = useState(false)
  const [caption, setCaption] = useState('')
  const [pickedTarget, setTarget] = useState<PickerItem | null>(null)
  const [citing, setCiting] = useState(false)

  // The experiment the studio was opened from is the first choice; picking
  // another in the dialog replaces it.
  const handedExperiment = useQuery({
    queryKey: ['analysis-studio', 'cite-target', defaultExperimentId],
    enabled: Boolean(defaultExperimentId),
    queryFn: async () =>
      (
        await notebookDataClient.list<{
          id: string
          identifier: string
          title: string
          status: string
        }>(
          'records',
          `?id=eq.${encodeURIComponent(defaultExperimentId ?? '')}&kind=eq.experiment&select=id,identifier,title,status&limit=1`,
        )
      ).at(0) ?? null,
    staleTime: 60_000,
  })

  const target: PickerItem | null =
    pickedTarget ??
    (handedExperiment.data
      ? {
          id: handedExperiment.data.id,
          identifier: handedExperiment.data.identifier,
          name: handedExperiment.data.title,
          // copy-ignore-next-line
          kind: 'Experiment',
          status: { tone: 'none', label: handedExperiment.data.status },
          project: '',
        }
      : null)

  async function cite() {
    if (!caption.trim() || !target) return
    setCiting(true)

    try {
      const view = await saveAnalysisView(
        analysisStudioDataClient,
        {
          id: selectedViewId ?? undefined,
          name: viewName.trim() || caption.trim(),
          charts: chartsToSave(views, selectedViewId, spec),
          source_revisions: captureSourceRevisions(sources, spec),
          export_settings: settings,
        },
        workspaceId,
        user.id,
      )

      // A figure is cited as a frozen analysis block that holds the view's
      // chart: the notebook shows exactly this chart, pinned to the dataset
      // version it was drawn from. One block kind holds a chart, a statistic
      // or both, so the figure can later gain a statistic beside it. A chart
      // over several datasets cannot be pinned to one Dataset Version, so it
      // is still cited as a frozen chart block, which pins each source.
      const targetRecord = await fetchRecord(notebookDataClient, target.id)

      if (view.charts[0].datasets.length === 1) {
        const definition = await composeAnalysisDefinition(notebookDataClient, {
          chartViewId: view.id,
          name: caption.trim(),
        })

        const inserted = await insertBlock(notebookDataClient, {
          recordId: target.id,
          type: 'analysis',
          payload: { title: caption.trim(), definitionId: definition.id },
          expectedStructureVersion: targetRecord?.structureVersion,
        })

        await freezeAnalysisBlock(notebookDataClient, {
          blockId: inserted.block.id,
          expectedVersion: inserted.block.version,
        })
      } else {
        const inserted = await insertBlock(notebookDataClient, {
          recordId: target.id,
          type: 'chart',
          payload: { title: caption.trim(), spec: view.charts[0] },
          expectedStructureVersion: targetRecord?.structureVersion,
        })

        await freezeChart(notebookDataClient, {
          blockId: inserted.block.id,
          expectedVersion: inserted.block.version,
        })
      }

      await recordAnalysisCitation(notebookDataClient, target.id, view)
      toast(t('data.analysisStudio.citedNotebook'), {
        description: t('data.analysisStudio.nowShowsFigure', {
          value:
            targetRecord?.identifier ?? t('data.analysisStudio.theNotebook'),
        }),
        action: {
          label: t('data.analysisStudio.openNotebook'),
          onClick: () =>
            void navigate({
              to: '/experiments/$expId/notebook',
              params: { expId: target.id },
            }),
        },
      })
      setCiteOpen(false)
      setCaption('')
      setTarget(null)
    } catch (error) {
      toast(t('data.analysisStudio.couldCite'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.analysisStudio.databaseRefused'),
      })
    } finally {
      setCiting(false)
    }
  }

  function setSetting<TKey extends keyof ExportSettings>(
    key: TKey,
    value: ExportSettings[TKey],
  ): void {
    onSettingsChange({ ...settings, [key]: value })
  }

  async function doExport(): Promise<void> {
    // The inspector may be portalled into a dialog. Its source remains the
    // owning Studio preview, never the first chart in the browser document.
    const chartSvg =
      chartRoot.current?.querySelector<SVGSVGElement>(
        '[data-analysis-chart] svg',
      ) ?? null

    // Provenance names a view that exists: the selected id is resolved against
    // the loaded list, so an id whose row is gone (deleted since the list was
    // read) is never stamped onto the file.
    const selectedView = views.find((v) => v.id === selectedViewId) ?? null
    const sourceRevisions = captureSourceRevisions(sources, spec)

    const provenance = buildExportProvenance(
      {
        name:
          viewName ||
          selectedView?.name ||
          t('data.analysisStudio.untitledAnalysis'),
        id: selectedView?.id ?? null,
        version: selectedView?.version ?? null,
      },
      user,
      sourceRevisions,
      spec,
    )

    const filename = (viewName || 'analysis').replace(/[^a-z0-9_-]+/gi, '_')
    const needsChart = settings.format === 'png' || settings.format === 'svg'

    if (needsChart && !chartSvg) {
      toast(t('data.analysisStudio.chartExport'), {
        description: t('data.analysisStudio.imageExportReadsRendered'),
      })

      return
    }

    try {
      if (settings.format === 'png') {
        const svg = exportChartSvg(
          chartSvg,
          settings,
          provenance,
          spec.display.caption,
        )

        const blob = await rasteriseSvgToPng(svg, {
          format: 'png',
          width: settings.width,
          height: settings.height + captionBlockHeight(caption, settings.width),
          scale: 2,
          // The SVG carries the themed surface, so a dark export must not be
          // painted over with white by the rasteriser.
          background: settings.theme === 'dark' ? 'transparent' : 'opaque',
          includeProvenance: settings.includeProvenance,
        })

        downloadTextFile(`${filename}.png`, blob, 'image/png')

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
        content = exportDataCsv(
          materialised,
          settings.includeProvenance ? provenance : null,
        )
        mime = 'text/csv'
        ext = 'csv'
      } else {
        content = exportChartSvg(
          chartSvg,
          settings,
          provenance,
          spec.display.caption,
        )
        mime = 'image/svg+xml'
        ext = 'svg'
      }

      downloadTextFile(`${filename}.${ext}`, content, mime)
    } catch (error) {
      toast(t('data.analysisStudio.couldExport'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.analysisStudio.exportFailed'),
      })
    }
  }

  return (
    <div
      className="rounded-lg border border-border bg-surface space-y-2 p-4"
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`} className="text-sm font-semibold">
        {t('common.actions.export')}
      </h2>
      {mode === 'chart' ? null : <ExportModeNotice />}
      <ExportSettingsGrid id={id} settings={settings} onChange={setSetting} />
      <ProvenanceToggle
        id={id}
        checked={settings.includeProvenance}
        onChange={(checked) => setSetting('includeProvenance', checked)}
      />
      <ExportActions
        format={settings.format}
        canExport={mode === 'chart'}
        onExport={() => void doExport()}
        onCite={() => setCiteOpen(true)}
      />
      {citeOpen ? (
        <CiteNotebookDialog
          caption={caption}
          onCaption={setCaption}
          target={target}
          onTarget={setTarget}
          citing={citing}
          onCite={() => void cite()}
          onClose={() => setCiteOpen(false)}
        />
      ) : null}
    </div>
  )
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
  /** Canonical staleness answer for the loaded view (R5-STUDIO-03). */
  sourceStatus: AnalysisViewSourceStatus | null
  sourceStatusError: string | null
  resolving: boolean
  onResolve: (resolution: AnalysisSourceResolution) => void
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
  sourceStatus,
  sourceStatusError,
  resolving,
  onResolve,
}: AnalysisPreviewProps) {
  const id = useId()
  const [dataPreviewOpen, setDataPreviewOpen] = useState(false)

  const validation = useMemo(
    () => validateAnalysisSpec(spec, datasetQuery.data?.rows.length ?? 0),
    [spec, datasetQuery.data],
  )

  // Local mirror of the canonical comparison, used only until the status read
  // arrives (or when it fails); the resolution actions need the server answer.
  const localStaleDetail = useMemo(() => {
    if (!selectedViewId) return null
    const view = views.find((v) => v.id === selectedViewId)

    if (!view) return null

    return detectStaleSources(view.source_revisions, sources)
  }, [selectedViewId, views, sources])

  const movedSources =
    sourceStatus?.sources.filter((item) => item.status !== 'current') ?? []

  // `.at(0)` (not `[0]`) so the type admits the empty list: nothing has moved
  // whenever the status says the sources are current.
  const firstMoved = movedSources.at(0)

  const staleDetail = sourceStatus
    ? (firstMoved?.detail ?? null)
    : localStaleDetail

  const liveTarget = movedSources.find(
    (item) => item.status === 'stale' && item.live,
  )

  const canUpdate =
    sourceStatus !== null &&
    sourceStatus.state === 'stale' &&
    sourceStatus.removedCount === 0 &&
    sourceStatus.citedByCount === 0

  const resultRowCount = datasetQuery.data?.rows.length ?? 0
  const excessiveSize = resultRowCount > ANALYSIS_MAX_RESULT_ROWS

  const summaries = useMemo<SeriesSummary[]>(
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
          <PreviewSummaryBadges
            loading={datasetQuery.isLoading}
            rowCount={resultRowCount}
            transformationCount={spec.transformations.length}
            summaries={summaries}
          />
        </div>

        {/* Recoverable error / warning states surfaced clearly. */}
        {!validation.ok ? (
          <div
            role="alert"
            className="mx-4 mb-2 rounded-md border border-danger-border bg-danger-wash p-3 text-xs text-danger-text"
          >
            <p className="font-semibold">
              {t('data.analysisStudio.specificationProblems')}
            </p>
            <ul className="mt-1 list-disc pl-4">
              {validation.errors.map((e, i) => (
                // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- A specification problem is its sentence; the list is ordered and has no other identity.
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <SourceMovedBanner
          staleDetail={staleDetail}
          movedSources={movedSources}
          sourceStatus={sourceStatus}
          sourceStatusError={sourceStatusError}
          selectedViewId={selectedViewId}
          resolving={resolving}
          canUpdate={canUpdate}
          firstMoved={firstMoved}
          liveTarget={liveTarget}
          describedById={`${id}-stale-update-reason`}
          onResolve={onResolve}
        />
        {excessiveSize ? (
          <div
            role="status"
            className="mx-4 mb-2 flex items-start gap-2 rounded-md border border-warning-border bg-warning-wash p-3 text-xs"
          >
            <Icon
              name="warn"
              size={16}
              className="mt-0.5 text-warning-text"
              aria-hidden="true"
            />
            <span>
              {t('data.analysisStudio.sourceDatasetHasRows', {
                rows: formatCount(resultRowCount),
                limit: formatCount(ANALYSIS_MAX_RESULT_ROWS),
              })}
            </span>
          </div>
        ) : null}

        <div
          className="min-h-0 min-w-0 flex-1 overflow-hidden px-2 pb-1"
          data-analysis-chart
        >
          <ChartRenderer
            title={t('data.analysisStudio.chart', {
              name: source.name,
              type: CHART_TYPE_LABELS[spec.type],
            })}
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
          <span>{t('data.analysisStudio.dataPreview')}</span>
          {dataPreviewOpen ? (
            <Icon
              name="chevronDown"
              size={14}
              className="rotate-180"
              aria-hidden="true"
            />
          ) : (
            <Icon name="chevronDown" size={14} aria-hidden="true" />
          )}
        </button>
        {dataPreviewOpen ? (
          <div className="flex max-h-48 min-h-0 flex-col">
            <DataTableAlternative
              materialised={analysisMaterialised}
              loading={datasetQuery.isLoading}
              selection={selection}
              datasetId={source.datasetId}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Serialise the rows a data preview shows, so the download matches the table
 * on screen (the exact columns and the same 50-row window).
 */
/** A materialised column, as the preview and the data table read it. */
type MaterialisedColumn = ReturnType<
  typeof materialiseLiveChart
>['columns'][number]

const unitSchema = z.union([
  z.string(),
  z.object({ symbol: z.string() }).transform((held) => held.symbol),
])

/** A column's unit as it is written after the label. */
function unitSuffix(unit: MaterialisedColumn['unit']): string {
  const decoded = unitSchema.safeParse(unit)

  if (decoded.success) return decoded.data
  const plain = z.union([z.string(), z.number(), z.boolean()]).safeParse(unit)

  return plain.success ? `${plain.data}` : ''
}

/** A preview cell as text: empty when absent, its JSON when it is a structure. */
function cellText(value: ChartRow[string]): string {
  if (value === null || value === undefined) return ''
  const scalar = z.union([z.string(), z.number(), z.boolean()]).safeParse(value)

  return scalar.success ? `${scalar.data}` : JSON.stringify(value)
}

/** A data-table cell: numbers in scientific notation, everything else as text. */
function tableCell(value: ChartRow[string]): string {
  const numeric = z.number().safeParse(value)

  if (numeric.success) return formatScientific(numeric.data)
  const text = cellText(value)

  return text === '' ? '—' : text
}

function previewCsv(
  columns: { key: string; label: string }[],
  rows: ChartRow[],
): string {
  const cell = (value: ChartRow[string]) => {
    const text = cellText(value)

    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  return [
    columns.map((column) => cell(column.label)).join(','),
    ...rows.map((row) =>
      columns.map((column) => cell(row[column.key])).join(','),
    ),
  ].join('\n')
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
  datasetId,
}: {
  materialised: ReturnType<typeof materialiseLiveChart>
  loading: boolean
  selection?: ChartSelection | null
  /** The dataset the rows came from; the full grid lives at its Rows tab. */
  datasetId: string
}) {
  const id = useId()

  if (loading) {
    return <Skeleton className="h-32 w-full" />
  }

  if (
    materialised.state.kind !== 'ok' &&
    materialised.state.kind !== 'log_scale_invalid'
  ) {
    return (
      <div className="rounded-lg border bg-surface p-4 text-center text-xs text-fg-muted">
        {t('data.analysisStudio.plottableDataTableCurrent')}
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
          ? `${column.label} (${unitSuffix(column.unit)})`
          : column.label,
      }))
    : [
        { key: 'series', label: t('data.analysisStudio.series') },
        { key: 'x', label: materialised.xLabel },
        { key: 'y', label: materialised.yLabel },
        { key: 'yError', label: t('data.analysisStudio.error') },
      ]

  const rows: ChartRow[] = hasSourceRows
    ? materialised.rows.slice(0, 50)
    : chartRows

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden border-t"
      aria-labelledby={`${id}-data-table-title`}
    >
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <h2 id={`${id}-data-table-title`} className="text-sm font-semibold">
          {t('data.analysisStudio.dataPreview')}
          <span className="ml-2 font-normal text-fg-muted">
            {t('data.analysisStudio.firstRows', {
              min: Math.min(rows.length, 50),
            })}
          </span>
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="quiet"
            size="sm"
            nativeButton={false}
            render={
              <Link to="/datasets/$datasetId/rows" params={{ datasetId }} />
            }
          >
            {t('data.analysisStudio.openDataTable')}
          </Button>
          <Button
            variant="quiet"
            size="icon"
            aria-label={t('data.analysisStudio.ariaDownloadDataPreview')}
            onClick={() => {
              downloadTextFile(
                `data-preview-${datasetId.slice(0, 8)}.csv`,
                previewCsv(columns, rows),
                'text/csv',
              )
            }}
          >
            <Icon name="download" size={16} />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {rows.length === 0 ? (
          <p role="status" className="p-3 text-center text-xs text-fg-muted">
            {t('data.analysisStudio.noRows')}
          </p>
        ) : (
          <PreviewGrid
            label={t('data.analysisStudio.ariaChartDataTable')}
            columns={columns.map((column) => column.label)}
            rows={rows.map((row) =>
              Object.fromEntries(
                columns.map((column) => [
                  column.label,
                  tableCell(row[column.key]),
                ]),
              ),
            )}
            selectedRow={rows.findIndex((row) => {
              const selectedRowId = selection
                ? materialised.series.find(
                    (item) => item.identifier === selection.seriesIdentifier,
                  )?.points[selection.index]?.rowId
                : undefined

              return Boolean(
                selectedRowId && row[CHART_ROW_ID_KEY] === selectedRowId,
              )
            })}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export { CHART_PALETTE, CHART_SPEC_VERSION }

/** The export format, theme, size and provenance controls. */
function ExportSettingsGrid({
  id,
  settings,
  onChange,
}: {
  id: string
  settings: ExportSettings
  onChange: <TKey extends keyof ExportSettings>(
    key: TKey,
    value: ExportSettings[TKey],
  ) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div>
        <label className="text-label text-fg-muted" htmlFor={`${id}-format`}>
          {t('data.analysisStudio.format')}
        </label>
        <Select
          id={`${id}-format`}
          aria-label={t('data.analysisStudio.ariaExportFormat')}
          value={settings.format}
          onChange={(e) => {
            const decoded = exportFormatSchema.safeParse(e.target.value)

            if (decoded.success) onChange('format', decoded.data)
          }}
          className="h-8 bg-surface"
        >
          <option value="json">
            {t('data.analysisStudio.jsonSpecProvenance')}
          </option>
          <option value="csv">{t('data.analysisStudio.csvDataTable')}</option>
          <option value="svg">{t('data.analysisStudio.svgChartImage')}</option>
          <option value="png">
            {t('data.analysisStudio.pngPublicationRaster')}
          </option>
        </Select>
      </div>
      <div>
        <label className="text-label text-fg-muted" htmlFor={`${id}-theme`}>
          {t('data.analysisStudio.theme')}
        </label>
        <Select
          id={`${id}-theme`}
          aria-label={t('data.analysisStudio.ariaExportTheme')}
          value={settings.theme}
          onChange={(e) => {
            const decoded = exportThemeSchema.safeParse(e.target.value)

            if (decoded.success) onChange('theme', decoded.data)
          }}
          className="h-8 bg-surface"
        >
          <option value="light">{t('data.analysisStudio.light')}</option>
          <option value="dark">{t('data.analysisStudio.dark')}</option>
        </Select>
      </div>
      <div>
        <label className="text-label text-fg-muted" htmlFor={`${id}-width`}>
          {t('data.analysisStudio.widthPx')}
        </label>
        <Input
          id={`${id}-width`}
          aria-label={t('data.analysisStudio.ariaExportWidth')}
          type="number"
          min={320}
          max={4096}
          value={settings.width}
          onChange={(e) =>
            onChange('width', Number(e.target.value) || settings.width)
          }
          className="h-8 bg-surface"
        />
      </div>
      <div>
        <label className="text-label text-fg-muted" htmlFor={`${id}-height`}>
          {t('data.analysisStudio.heightPx')}
        </label>
        <Input
          id={`${id}-height`}
          aria-label={t('data.analysisStudio.ariaExportHeight')}
          type="number"
          min={240}
          max={4096}
          value={settings.height}
          onChange={(e) =>
            onChange('height', Number(e.target.value) || settings.height)
          }
          className="h-8 bg-surface"
        />
      </div>
    </div>
  )
}

/** Saves the analysis into a notebook as a frozen figure, with its caption. */
function CiteNotebookDialog({
  caption,
  onCaption,
  target,
  onTarget,
  citing,
  onCite,
  onClose,
}: {
  caption: string
  onCaption: (caption: string) => void
  target: PickerItem | null
  onTarget: (target: PickerItem | null) => void
  citing: boolean
  onCite: () => void
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('data.analysisStudio.saveCite')}
          description={t('data.analysisStudio.savesAnalysisFrozenVersion')}
        />
        <DialogBody>
          <label className="flex flex-col gap-1 text-label">
            <span className="font-medium text-fg">
              {t('data.analysisStudio.caption')}
              <span aria-hidden="true" className="text-fg-muted">
                {' '}
                *
              </span>
            </span>
            <Input
              autoFocus
              value={caption}
              onChange={(e) => onCaption(e.target.value)}
              placeholder={t('data.analysisStudio.placeholderEGStepYield')}
            />
          </label>
          <div className="min-h-[220px] rounded-md border border-border">
            <RecordPicker
              allowed={['Experiment']}
              exclude={[]}
              onPick={(items) => onTarget(items[0] ?? null)}
            />
          </div>
          {target ? (
            <span className="text-label text-fg-muted">
              {t('data.analysisStudio.citingInto', {
                identifier: target.identifier,
                name: target.name,
              })}
            </span>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={citing || !caption.trim() || !target}
            onClick={() => onCite()}
          >
            {citing
              ? t('data.analysisStudio.citing')
              : t('data.analysisStudio.cite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Why the loaded view's pinned sources moved, and how to settle them. */
function SourceMovedBanner({
  staleDetail,
  movedSources,
  sourceStatus,
  sourceStatusError,
  selectedViewId,
  resolving,
  canUpdate,
  firstMoved,
  liveTarget,
  describedById,
  onResolve,
}: {
  staleDetail: string | null
  movedSources: AnalysisSourceState[]
  sourceStatus: AnalysisViewSourceStatus | null
  sourceStatusError: string | null
  selectedViewId: string | null
  resolving: boolean
  canUpdate: boolean
  firstMoved: AnalysisSourceState | undefined
  liveTarget: AnalysisSourceState | undefined
  describedById: string
  onResolve: (resolution: AnalysisSourceResolution) => void
}) {
  if (!staleDetail) return null

  return (
    <div
      role="status"
      className="mx-4 mb-2 flex flex-wrap items-start gap-2 rounded-md border border-warning-border bg-warning-wash p-3 text-xs"
    >
      <Icon
        name="warn"
        size={16}
        className="mt-0.5 text-warning-text"
        aria-hidden="true"
      />
      <MovedSourceNotes
        staleDetail={staleDetail}
        movedSources={movedSources}
        sourceStatus={sourceStatus}
        sourceStatusError={sourceStatusError}
      />
      {selectedViewId && sourceStatus ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={resolving}
            onClick={() => onResolve('keep')}
          >
            {firstMoved
              ? t('data.analysisStudio.keepR', {
                  revision: firstMoved.pinned.revision,
                })
              : t('data.analysisStudio.keepPinned')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={resolving || !canUpdate}
            aria-describedby={describedById}
            onClick={() => onResolve('update')}
          >
            {liveTarget
              ? t('data.analysisStudio.updateR', {
                  revision: liveTarget.live?.revision ?? '',
                })
              : t('data.analysisStudio.updateCurrent')}
          </Button>
          {!canUpdate ? (
            <span id={describedById} className="max-w-[14rem] text-fg-muted">
              {t('data.analysisStudio.updatingPlaceUnavailableWhile')}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** The moved sources' own lines: what changed, what is acknowledged, what blocks. */
function MovedSourceNotes({
  staleDetail,
  movedSources,
  sourceStatus,
  sourceStatusError,
}: {
  staleDetail: string
  movedSources: AnalysisSourceState[]
  sourceStatus: AnalysisViewSourceStatus | null
  sourceStatusError: string | null
}) {
  return (
    <div className="min-w-[12rem] flex-1 space-y-1">
      <p>{staleDetail}</p>
      {movedSources.slice(1).map((item) => (
        <p key={item.datasetId} className="text-fg-muted">
          {item.detail}
        </p>
      ))}
      {sourceStatus?.acknowledged ? (
        <p className="text-fg-muted">
          {t('data.analysisStudio.keepingPinnedVersionsAcknowledged', {
            slice: sourceStatus.acknowledged.at.slice(0, 10),
            viewVersion: sourceStatus.acknowledged.viewVersion,
          })}
        </p>
      ) : null}
      {sourceStatus && sourceStatus.citedByCount > 0 ? (
        <p className="text-fg-muted">
          {t('data.analysisStudio.citeAnalysisSoKeeps', {
            count: sourceStatus.citedByCount,
          })}
        </p>
      ) : null}
      {sourceStatus && sourceStatus.removedCount > 0 ? (
        <p className="text-fg-muted">
          {t('data.analysisStudio.sourceDatasetLongerAvailable')}
        </p>
      ) : null}
      {sourceStatusError ? (
        <p className="text-fg-muted">
          {t('data.analysisStudio.canonicalSourceCheckCould', {
            sourceStatusError,
          })}
        </p>
      ) : null}
    </div>
  )
}

/** The panel's two actions: run the export, or save the analysis to a notebook. */
function ExportActions({
  format,
  canExport,
  onExport,
  onCite,
}: {
  format: ExportSettings['format']
  canExport: boolean
  onExport: () => void
  onCite: () => void
}) {
  return (
    <>
      <Button
        size="sm"
        onClick={onExport}
        className="w-full"
        disabled={!canExport}
      >
        <Icon name="download" size={14} />{' '}
        {t('data.analysisStudio.export', { toUpperCase: format.toUpperCase() })}
      </Button>
      <Button size="sm" variant="secondary" className="w-full" onClick={onCite}>
        {t('data.analysisStudio.citeNotebook')}
      </Button>
    </>
  )
}

/** The note that only the chart mode exports the rendered figure. */
function ExportModeNotice() {
  return (
    <Notice tone="info" title={t('data.analysisStudio.exportUsesChartBuilder')}>
      {t('data.analysisStudio.chartDataTableSpecification')}
    </Notice>
  )
}

/** Whether the file records its owner, the view version and the source revisions. */
function ProvenanceToggle({
  id,
  checked,
  onChange,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex grid-cols-[auto_1fr] items-center gap-2">
      <input
        id={`${id}-provenance`}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label className="text-label text-fg-muted" htmlFor={`${id}-provenance`}>
        {t('data.analysisStudio.includeOwnerVersionSources')}
      </label>
    </div>
  )
}

/** One series' summary, as the preview row and its fold change read it. */
type SeriesSummary = {
  identifier: string
  label: string
  colour: string
  lastMean: number
  foldChange: number | null
  direction: 'increase' | 'decrease'
}

/** The preview's own summary row: rows, transformations and the leading series. */
function PreviewSummaryBadges({
  loading,
  rowCount,
  transformationCount,
  summaries,
}: {
  loading: boolean
  rowCount: number
  transformationCount: number
  summaries: SeriesSummary[]
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-fg-muted">
      <Badge variant="kind">
        {loading ? t('common.states.loading') : `${formatCount(rowCount)} rows`}
      </Badge>
      {transformationCount > 0 ? (
        <Badge variant="kind">
          <Icon name="sigma" className="size-3" aria-hidden="true" />
          {transformationCount} transform
          {transformationCount === 1 ? '' : 's'}
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
      <FoldChange summary={summaries.at(0)} />
    </div>
  )
}

/** How far the leading series moved between its first and last point. */
function FoldChange({ summary }: { summary: SeriesSummary | undefined }) {
  if (!summary?.foldChange) return null

  return (
    <span className="text-xs text-fg-muted">
      {t('data.analysisStudio.foldChange', {
        toFixed: summary.foldChange.toFixed(1),
        direction: summary.direction,
      })}
    </span>
  )
}
