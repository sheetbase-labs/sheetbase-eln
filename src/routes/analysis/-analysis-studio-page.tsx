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
import { t } from '#/copy'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { datasetOption } from '#/components/v3/record-picker/entity-options'
import { specSourceDatasetId } from '#/lib/analysis-spec-source'
import { AnalysisFigureGuide } from '#/components/assist/analysis-figure-guide'
import { RecordPicker } from '#/components/v3/record-picker/record-picker'
import type { PickerItem } from '#/components/v3/record-picker/record-picker-data'
import { insertBlock } from '#/lib/notebook-mutations'
import { stableStringify } from '#/lib/notebook-submission'
import { DataClientError } from '#/lib/data-client'
import { downloadTextFile } from '#/lib/download'
import { fetchRecord, notebookDataClient } from '#/lib/notebook-data'
import { toast } from '#/components/v3/ui/sonner'
import { Spinner } from '#/components/v3/ui/spinner'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { CompareView } from '#/components/viz/compare-view'
import { SourceComparison } from '#/components/viz/source-comparison'
import { SnapshotSourceBanner } from '#/components/viz/snapshot-source-banner'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Link,
  getRouteApi,
  useBlocker,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { PanelLeft, PanelLeftClose, Save, Sigma, Trash2 } from 'lucide-react'

import type { ChartSelection } from '#/components/viz/chart-renderer'
import { AnalysisPanel } from '#/components/viz/analysis-panel'
import { ChartConfigurator } from '#/components/viz/chart-configurator'
import { Icon } from '#/components/v3/icons'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { returnLabel } from '#/lib/return-to'
import { Notice } from '#/components/v3/ui/alert'
import { Tabs } from '#/components/v3/ui/tabs'
import { Field, Input } from '#/components/v3/ui/input'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { Inspector as InspectorPanel } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Inspector } from '#/components/record/inspector'
import { InspectorSection, InspectorSectionStack } from '#/components/record'
import { FigureControls } from '#/components/viz/figure-controls'
import { Property, PropertyList } from '#/components/scientific'
import {
  freezeChart,
  materialiseLiveChart,
  toCanonicalDatasetSource,
  useLiveChartDataset,
} from '#/lib/chart-data'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
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
  captionBlockHeight,
  exportChartSvg,
  exportDataCsv,
  exportViewJson,
  fetchAnalysisViewCitations,
  fetchAnalysisViewSourceStatus,
  fetchAnalysisViews,
  fetchDatasetSummaries,
  materialiseAnalysisChart,
  materialiseAnalysisFacets,
  recordAnalysisCitation,
  resolveAnalysisViewSources,
  saveAnalysisView,
  validateAnalysisSpec,
} from '#/lib/analysis-studio-data'
import type {
  AnalysisSourceResolution,
  AnalysisViewCitation,
  AnalysisViewSourceStatus,
  AnalysisViewWire,
  FacetedResult,
  ExportSettings,
} from '#/lib/analysis-studio-data'
import { CitationList } from '#/components/viz/citation-list'
import { buildDefaultChartSpec } from '#/lib/dataset-explorer-data'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'
import { buildDefaultComparativeViewConfig } from '#/lib/comparative-view'
import type { ComparativeViewConfig } from '#/lib/comparative-view'
import { formatCount } from '#/lib/format-numbers'
import { cn } from '#/lib/utils'
import { rasteriseSvgToPng } from '#/lib/visualisation-export'
import { CHART_ROW_ID_KEY } from '#/lib/visualisation-pipeline'

const Route = getRouteApi('/analysis/new')

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

/** The studio modes, in tab order: the strip announces these as tabs. */
const STUDIO_MODES = ['chart', 'analyse', 'compare'] as const
type StudioMode = (typeof STUDIO_MODES)[number]
const STUDIO_MODE_LABEL: Record<StudioMode, string> = {
  chart: t('data.analysisStudio.chartBuilder'),
  analyse: t('data.analysisStudio.analyse'),
  compare: t('data.analysisStudio.compare'),
}

export function AnalysisStudio() {
  const instanceId = useId()
  const chartConfigId = `${instanceId}-chart-config`
  const chartRoot = useRef<HTMLDivElement | null>(null)
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
  const [inspectorOpen, setInspectorOpen] = useState(false)
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
  activeSnapshotRef.current = activeSnapshotId
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null)
  const [chartSelection, setChartSelection] = useState<ChartSelection | null>(
    null,
  )
  // SCI-02: the studio serves both chart authoring and reusable analysis
  // definitions; the mode is session state, never persisted server-side.
  // VIEW-03 adds the compare mode: grouped time-series / distribution
  // inspection over the same live rows, promoting into the chart builder.
  const [mode, setMode] = useState<StudioMode>(
    search.mode === 'analyse' || search.mode === 'compare'
      ? search.mode
      : 'chart',
  )
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
  const [cleanChart, setCleanChart] = useState('')
  const chartDraft = stableStringify([spec, viewName, exportSettings])
  const chartDirty = cleanChart !== '' && cleanChart !== chartDraft
  useBlocker({
    shouldBlockFn: () => chartDirty,
    enableBeforeUnload: false,
  })
  useEffect(() => {
    if (!chartDirty) return
    // Memory-history blockers cannot protect a browser reload or tab close.
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [chartDirty])
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
  const [deleteTarget, setDeleteTarget] = useState<AnalysisViewWire | null>(
    null,
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

  // Build a default spec when the dataset changes, or apply the saved view
  // whose dataset the user just switched to (loadView hands it over here so
  // the rebuild below cannot discard it).
  useEffect(() => {
    if (!selectedDataset) return
    const appliedOn = requestedViewAppliedOnRef.current
    requestedViewAppliedOnRef.current = null
    if (appliedOn === selectedDataset.id && !pendingViewRef.current) return
    const pending = pendingViewRef.current
    if (pending) {
      pendingViewRef.current = null
      setSelectedViewId(pending.id)
      setViewName(pending.name)
      setSpec(pending.charts[0])
      if (pending.export_settings) setExportSettings(pending.export_settings)
      setCleanChart(
        stableStringify([
          pending.charts[0],
          pending.name,
          pending.export_settings ?? exportSettings,
        ]),
      )
      return
    }
    const next = buildDefaultChartSpec(selectedDataset)
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
    setCleanChart(stableStringify([next, '', exportSettings]))
    // Keyed on the dataset's id, not the object: a background refetch of the
    // list hands back new objects for the same dataset, and rebuilding then
    // would drop the saved view the user just opened.
  }, [selectedDataset?.id, search.x, search.y])
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
      datasetQuery.data.flags ?? [],
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
      datasetQuery.data.flags ?? [],
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
  const navigate = useNavigate({ from: '/analysis/new' })
  const router = useRouter()

  const saveMutation = useMutation({
    mutationFn: async (options?: { asNew?: boolean }) => {
      if (!spec || !viewName.trim()) return
      const sourceRevisions = captureSourceRevisions(sources, spec)
      return saveAnalysisView(
        analysisStudioDataClient,
        {
          id: options?.asNew ? undefined : (selectedViewId ?? undefined),
          name: viewName.trim(),
          charts: chartsToSave(
            views,
            options?.asNew ? null : selectedViewId,
            spec,
          ),
          source_revisions: sourceRevisions,
          export_settings: exportSettings,
        },
        workspaceId,
        userId,
      )
    },
    onSuccess: (view, options) => {
      if (view && options?.asNew) setSelectedViewId(view.id)
      // A saved view has an address: reloading or sharing the page finds it.
      if (view) {
        setCleanChart(
          stableStringify([
            view.charts[0],
            view.name,
            view.export_settings ?? exportSettings,
          ]),
        )
        void navigate({
          search: (current) => ({ ...current, view: view.id }),
          replace: true,
          ignoreBlocker: true,
        })
      }
      if (view) {
        toast(t('data.analysisStudio.analysisViewSaved'), {
          description: `${view.name} v${view.version}`,
          ...(search.returnTo
            ? {
                action: {
                  label: returnLabel(search.returnTo),
                  onClick: () => void navigate({ to: search.returnTo }),
                },
              }
            : {}),
        })
      }
      queryClient.invalidateQueries({ queryKey: analysisStudioQueryKeys.views })
    },
    onError: (error) => {
      // The view the panel is armed on can be gone (deleted here, or in
      // another tab). The panel then holds an id nothing can update, so it
      // falls back to saving a new view — with the name the user typed.
      if (
        error instanceof DataClientError &&
        error.code === 'analysis_view_missing'
      ) {
        setSelectedViewId(null)
      }
      toast(t('data.analysisStudio.couldSaveAnalysisView'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.analysisStudio.databaseRefused'),
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      deleteAnalysisView(analysisStudioDataClient, id),
    onSuccess: (_deleted, id) => {
      toast(t('data.analysisStudio.analysisViewDeleted'))
      // The deleted view is gone from the list; the panel must not stay armed
      // on it, or its Update button would write to a row that no longer exists.
      if (selectedViewId === id) {
        setSelectedViewId(null)
        setViewName('')
      }
      queryClient.invalidateQueries({ queryKey: analysisStudioQueryKeys.views })
    },
    onError: (error) => {
      toast(t('data.analysisStudio.couldDeleteAnalysisView'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.analysisStudio.databaseRefused'),
      })
    },
  })

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
    setCleanChart(
      stableStringify([
        view.charts[0],
        view.name,
        view.export_settings ?? exportSettings,
      ]),
    )
  }

  // `?view=<id>` (the read-only analysis route's "Edit in studio" link): load
  // the named saved view once the list resolves, exactly as the Load button
  // does. Consumed once so a later list refresh does not reapply it.
  useEffect(() => {
    const requested = requestedViewRef.current
    // Wait for the dataset list too: until it loads, the view's dataset cannot
    // be matched, and the default-spec rebuild after auto-select would wipe it.
    if (!requested || views.length === 0 || summariesQuery.isLoading) return
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
    setCleanChart(
      stableStringify([
        view.charts[0],
        view.name,
        view.export_settings ?? exportSettings,
      ]),
    )
  }, [views, datasets, selectedDatasetId, summariesQuery.isLoading])

  // R5-STUDIO-03: staleness and citations are answered by the canonical
  // boundary, not re-derived in the browser, so the resolution the user
  // chooses is the one the database records.
  const sourceStatusQuery = useQuery({
    queryKey: selectedViewId
      ? analysisStudioQueryKeys.sourceStatus(selectedViewId)
      : ['analysis-view', 'none', 'source-status'],
    queryFn: () =>
      fetchAnalysisViewSourceStatus(analysisStudioDataClient, selectedViewId!),
    enabled: Boolean(selectedViewId),
    staleTime: 5_000,
  })
  const citationsQuery = useQuery({
    queryKey: selectedViewId
      ? analysisStudioQueryKeys.citations(selectedViewId)
      : ['analysis-view', 'none', 'citations'],
    queryFn: () =>
      fetchAnalysisViewCitations(analysisStudioDataClient, selectedViewId!),
    enabled: Boolean(selectedViewId),
    staleTime: 5_000,
  })
  const resolveMutation = useMutation({
    mutationFn: (resolution: AnalysisSourceResolution) =>
      resolveAnalysisViewSources(analysisStudioDataClient, {
        viewId: selectedViewId as string,
        expectedVersion: sourceStatusQuery.data?.version ?? 0,
        resolution,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: analysisStudioQueryKeys.views })
      if (selectedViewId) {
        queryClient.invalidateQueries({
          queryKey: analysisStudioQueryKeys.sourceStatus(selectedViewId),
        })
        queryClient.invalidateQueries({
          queryKey: analysisStudioQueryKeys.citations(selectedViewId),
        })
      }
      toast(
        result.resolution === 'keep'
          ? t('data.analysisStudio.keepingPinnedVersions')
          : t('data.analysisStudio.updatedCurrentVersionsV', {
              version: result.version,
            }),
        {
          description:
            result.resolution === 'keep'
              ? t('data.analysisStudio.decisionRecordedAgainstAnalysis')
              : t('data.analysisStudio.viewRePinnedLive'),
        },
      )
    },
    onError: (error) => {
      toast(t('data.analysisStudio.couldResolveStaleSource'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.analysisStudio.databaseRefused'),
      })
    },
  })

  // UI port (roadmap-4/ui-app3): the studio renders inside app-3's shell, so
  // the legacy shell wrapper is replaced by a content column with the chart
  // settings inspector beside it.
  const inspector =
    selectedSource && spec ? (
      <AnalysisInspector
        chartRoot={chartRoot}
        source={selectedSource}
        spec={spec}
        mode={mode}
        onSpecChange={setSpec}
        views={views}
        selectedViewId={selectedViewId}
        viewName={viewName}
        onViewNameChange={setViewName}
        onLoad={loadView}
        onSave={(asNew) => saveMutation.mutate({ asNew })}
        onDelete={(view) => setDeleteTarget(view)}
        saving={saveMutation.isPending}
        exportSettings={exportSettings}
        onExportSettingsChange={setExportSettings}
        sources={sources}
        user={{ id: userId, name: context.user.name }}
        workspaceId={workspaceId}
        materialised={analysisMaterialised}
        selection={chartSelection}
        citations={citationsQuery.data ?? []}
        citationsLoading={citationsQuery.isLoading}
        citationsError={
          citationsQuery.error ? String(citationsQuery.error) : null
        }
        sourceStatus={sourceStatusQuery.data ?? null}
        experimentId={search.experiment}
      />
    ) : undefined

  return (
    <div ref={chartRoot} className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
          <AnalysisStudioHeader
            datasets={datasets}
            loading={summariesQuery.isLoading}
            error={summariesQuery.error}
            selectedDatasetId={selectedDatasetId}
            onSelect={setSelectedDatasetId}
            returnTo={search.returnTo}
          />
          <Tabs
            mode="state"
            variant="segment"
            label={t('data.analysisStudio.studioMode')}
            value={mode}
            onValueChange={(next) => setMode(next as StudioMode)}
            items={STUDIO_MODES.map((value) => ({
              key: value,
              label: STUDIO_MODE_LABEL[value],
            }))}
          />
          {inspector ? (
            <Button
              data-local-inspector-trigger
              type="button"
              size="sm"
              icon="info"
              className="xl:hidden"
              aria-haspopup="dialog"
              aria-expanded={inspectorOpen}
              onClick={() => setInspectorOpen(true)}
            >
              {t('data.analysisStudio.chartSettings')}
            </Button>
          ) : null}
          {mode === 'chart' && selectedSource && spec ? (
            <Button
              type="button"
              size="sm"
              variant="quiet"
              aria-expanded={configOpen}
              aria-controls={configOpen ? chartConfigId : undefined}
              onClick={() => setConfigOpen((open) => !open)}
            >
              {configOpen ? (
                <PanelLeftClose className="size-4" aria-hidden="true" />
              ) : (
                <PanelLeft className="size-4" aria-hidden="true" />
              )}
              {configOpen
                ? t('data.analysisStudio.hideEncodings')
                : t('data.analysisStudio.showEncodings')}
            </Button>
          ) : null}
        </div>
        {mode !== 'analyse' && spec?.datasets[0]?.datasetVersionId ? (
          <div className="px-3 pt-3">
            <SnapshotSourceBanner
              datasetId={spec.datasets[0].datasetId}
              datasetVersionId={spec.datasets[0].datasetVersionId}
              onUseLive={() => {
                setSnapshotId(null)
                setSpec((current) =>
                  current
                    ? {
                        ...current,
                        datasets: current.datasets.map(({ datasetId }) => ({
                          datasetId,
                        })),
                      }
                    : current,
                )
              }}
            />
          </div>
        ) : null}
        {mode === 'analyse' ? (
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <AnalysisPanel
              datasets={sources}
              workspaceId={workspaceId}
              userId={userId}
              initialDatasetId={selectedDatasetId}
              onDatasetChange={setSelectedDatasetId}
              initialSnapshotId={activeSnapshotId}
              initialDefinitionId={search.definition}
              experimentId={search.experiment}
            />
          </div>
        ) : mode === 'compare' ? (
          <div className="min-h-0 flex-1 overflow-auto p-3">
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
                    router.history.push(href)
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
                flags={datasetQuery.data?.flags ?? []}
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
            {selectedSource && datasetQuery.data ? (
              <SourceComparison
                // A new source A starts a new comparison.
                key={`${selectedSource.datasetId}:${spec?.datasets[0]?.datasetVersionId ?? ''}`}
                sourceA={selectedSource}
                rowsA={datasetQuery.data.rows}
                snapshotA={spec?.datasets[0]?.datasetVersionId ?? null}
                sources={sources}
              />
            ) : null}
          </div>
        ) : selectedSource && spec ? (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {configOpen ? (
              <aside
                id={chartConfigId}
                data-analysis-chart-config
                className="flex w-56 shrink-0 flex-col overflow-y-auto border-r"
              >
                <ChartConfigurator
                  source={selectedSource}
                  spec={spec}
                  onSpecChange={setSpec}
                  idPrefix={instanceId}
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
                sourceStatus={sourceStatusQuery.data ?? null}
                sourceStatusError={
                  sourceStatusQuery.error
                    ? String(sourceStatusQuery.error)
                    : null
                }
                resolving={resolveMutation.isPending}
                onResolve={(resolution) => resolveMutation.mutate(resolution)}
              />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 p-3">
            <EmptyAnalysisState
              loading={summariesQuery.isLoading}
              error={summariesQuery.error}
            />
          </div>
        )}
      </div>
      {inspector ? (
        <InspectorPanel
          label={t('data.analysisStudio.chartSettings')}
          open={inspectorOpen}
          onOpenChange={setInspectorOpen}
          className="w-[340px] gap-0 p-0"
        >
          <div className="flex flex-col gap-5 overflow-auto p-4">
            {inspector}
          </div>
        </InspectorPanel>
      ) : null}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('data.analysisStudio.deleteAnalysisView')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {deleteTarget
                ? t('data.analysisStudio.vRemovedEveryoneWorkspace', {
                    name: deleteTarget.name,
                    version: deleteTarget.version,
                  })
                : ''}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
              }}
            >
              {deleteMutation.isPending
                ? t('data.analysisStudio.deleting')
                : t('common.actions.delete')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
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
  /** The page that opened the studio, when it asked to be returned to. */
  returnTo?: string
}

export function AnalysisStudioHeader({
  datasets,
  loading,
  error,
  selectedDatasetId,
  onSelect,
  returnTo,
}: AnalysisStudioHeaderProps) {
  const id = useId()
  return (
    <header
      // No `shrink-0`: the header is a flex item in the studio's toolbar, and
      // refusing to shrink held it at its max-content width, so at 400 % zoom
      // the data-source select was pushed past the column and clipped by the
      // pane's `overflow-hidden` with nothing able to scroll to it. It shrinks
      // and wraps instead (QA4-zoom-studio).
      className="flex flex-wrap items-center justify-between gap-3"
      aria-labelledby={`${id}-title`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <h1 id={`${id}-title`} className="text-title">
          {t('data.analysisStudio.analysisStudio')}
        </h1>
        {returnTo ? (
          <Button
            size="sm"
            variant="quiet"
            nativeButton={false}
            render={<Link to={returnTo} />}
          >
            {returnLabel(returnTo)}
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {error ? (
          <Badge variant="del">
            {t('data.analysisStudio.couldLoadDatasets')}
          </Badge>
        ) : loading ? (
          <Skeleton className="h-7 w-48" />
        ) : datasets.length === 0 ? (
          <Badge variant="kind">{t('data.analysisStudio.noDatasets')}</Badge>
        ) : (
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`${id}-source`}>
              {t('data.analysisStudio.dataSource')}
            </label>
            <PickerSelect
              noun="dataset"
              id={`${id}-source`}
              aria-label={t('data.analysisStudio.ariaSelectDataSource')}
              value={selectedDatasetId ?? ''}
              onChange={(id) => onSelect(id)}
              size="sm"
              className="w-64 bg-surface"
              options={datasets.map((d) =>
                datasetOption({
                  id: d.id,
                  name: d.name,
                  model: d.dataset_schema?.slug,
                }),
              )}
            />
          </div>
        )}
      </div>
    </header>
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
                value={String(filter.value ?? '')}
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
              <Trash2 />
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
                onChange={(event) =>
                  setScale(axis, event.target.value as AxisScale)
                }
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
          {saving ? <Spinner size={16} /> : <Save />}
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
function chartsToSave(
  views: readonly AnalysisViewWire[],
  viewId: string | null,
  spec: ChartSpec,
): ChartSpec[] {
  const existing = viewId ? views.find((v) => v.id === viewId) : undefined
  return [spec, ...(existing?.charts.slice(1) ?? [])]
}

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
        const caption = spec.display.caption
        const svg = exportChartSvg(chartSvg, settings, provenance, caption)
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
      {mode === 'chart' ? null : (
        <Notice
          tone="info"
          title={t('data.analysisStudio.exportUsesChartBuilder')}
        >
          {t('data.analysisStudio.chartDataTableSpecification')}
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <label className="text-label text-fg-muted" htmlFor={`${id}-format`}>
            {t('data.analysisStudio.format')}
          </label>
          <Select
            id={`${id}-format`}
            aria-label={t('data.analysisStudio.ariaExportFormat')}
            value={settings.format}
            onChange={(e) =>
              setSetting('format', e.target.value as ExportSettings['format'])
            }
            className="h-8 bg-surface"
          >
            <option value="json">
              {t('data.analysisStudio.jsonSpecProvenance')}
            </option>
            <option value="csv">{t('data.analysisStudio.csvDataTable')}</option>
            <option value="svg">
              {t('data.analysisStudio.svgChartImage')}
            </option>
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
            onChange={(e) =>
              setSetting('theme', e.target.value as ExportSettings['theme'])
            }
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
              setSetting('width', Number(e.target.value) || settings.width)
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
              setSetting('height', Number(e.target.value) || settings.height)
            }
            className="h-8 bg-surface"
          />
        </div>
      </div>
      <div className="flex grid-cols-[auto_1fr] items-center gap-2">
        <input
          id={`${id}-provenance`}
          type="checkbox"
          checked={settings.includeProvenance}
          onChange={(e) => setSetting('includeProvenance', e.target.checked)}
        />
        <label
          className="text-label text-fg-muted"
          htmlFor={`${id}-provenance`}
        >
          {t('data.analysisStudio.includeOwnerVersionSources')}
        </label>
      </div>
      <Button
        size="sm"
        onClick={doExport}
        className="w-full"
        disabled={mode !== 'chart'}
      >
        <Icon name="download" size={14} />{' '}
        {t('data.analysisStudio.export', {
          toUpperCase: settings.format.toUpperCase(),
        })}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        onClick={() => setCiteOpen(true)}
      >
        {t('data.analysisStudio.citeNotebook')}
      </Button>
      {citeOpen ? (
        <Dialog open onOpenChange={(o) => (o ? undefined : setCiteOpen(false))}>
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
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder={t('data.analysisStudio.placeholderEGStepYield')}
                />
              </label>
              <div className="min-h-[220px] rounded-md border border-border">
                <RecordPicker
                  allowed={['Experiment']}
                  exclude={[]}
                  onPick={(items) => setTarget(items[0] ?? null)}
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
                onClick={() => void cite()}
              >
                {citing
                  ? t('data.analysisStudio.citing')
                  : t('data.analysisStudio.cite')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <Badge variant="kind">
              {datasetQuery.isLoading
                ? t('common.states.loading')
                : `${formatCount(resultRowCount)} rows`}
            </Badge>
            {spec.transformations.length > 0 ? (
              <Badge variant="kind">
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
              <span className="text-xs text-fg-muted">
                {t('data.analysisStudio.foldChange', {
                  toFixed: summaries[0].foldChange.toFixed(1),
                  direction: summaries[0].direction,
                })}
              </span>
            ) : null}
          </div>
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
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {staleDetail ? (
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
                  aria-describedby={`${id}-stale-update-reason`}
                  onClick={() => onResolve('update')}
                >
                  {liveTarget
                    ? t('data.analysisStudio.updateR', {
                        revision: liveTarget.live?.revision ?? '',
                      })
                    : t('data.analysisStudio.updateCurrent')}
                </Button>
                {!canUpdate ? (
                  <span
                    id={`${id}-stale-update-reason`}
                    className="max-w-[14rem] text-fg-muted"
                  >
                    {t('data.analysisStudio.updatingPlaceUnavailableWhile')}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
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
          <div className="max-h-40 overflow-hidden">
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
function previewCsv(
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[],
): string {
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value)
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
          ? `${column.label} (${typeof column.unit === 'object' && 'symbol' in column.unit ? String((column.unit as { symbol: string }).symbol) : String(column.unit)})`
          : column.label,
      }))
    : [
        { key: 'series', label: t('data.analysisStudio.series') },
        { key: 'x', label: materialised.xLabel },
        { key: 'y', label: materialised.yLabel },
        { key: 'yError', label: t('data.analysisStudio.error') },
      ]
  const rows: Record<string, unknown>[] = hasSourceRows
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
      <div className="min-h-0 flex-1 overflow-auto">
        <Table
          aria-label={t('data.analysisStudio.ariaChartDataTable')}
          data-density="compact"
        >
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
                  className="text-center text-xs text-fg-muted"
                >
                  {t('data.analysisStudio.noRows')}
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
                    className={isSelected ? 'bg-surface-muted' : undefined}
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
        className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-danger-border bg-danger-wash p-8 text-center text-sm text-danger-text"
      >
        {t('data.analysisStudio.couldLoadDatasetsCheck')}
      </div>
    )
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border bg-surface p-10 text-center">
      {loading ? (
        <Skeleton className="h-8 w-48" />
      ) : (
        <>
          <Icon
            name="database"
            size={32}
            className="text-fg-muted"
            aria-hidden="true"
          />
          <p className="max-w-md text-sm text-fg-muted">
            {t('data.analysisStudio.createDatasetFirstThen')}
          </p>
          <Button
            render={<Link to="/datasets" search={{ dataset: '' }} />}
            nativeButton={false}
            variant="secondary"
            size="sm"
          >
            {t('data.analysisStudio.openDatasets')}
          </Button>
        </>
      )}
    </div>
  )
}

export { CHART_PALETTE, CHART_SPEC_VERSION }
