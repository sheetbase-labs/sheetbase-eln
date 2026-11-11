/**
 * The Analysis Studio's state that is not local to the screen: the dataset and
 * saved-view reads, the canonical sources they select, the materialised preview
 * and the saved-view writes.
 *
 * Split out of `-analysis-studio-page.tsx` so each concern is short enough to
 * read on its own. The state those concerns adjust, and the effects that adjust
 * it, stay in `useAnalysisStudio` beside it: an effect may only read values its
 * own hook owns, and moving them behind a parameter is what
 * `react-doctor/exhaustive-deps` and `no-adjust-state-on-prop-change` reject.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { toast } from '#/components/ui/sonner'
import { usePaneContext } from '#/components/workspace/workspace-navigation'
import { t } from '#/copy'
import {
  analysisStudioDataClient,
  analysisStudioQueryKeys,
  captureSourceRevisions,
  deleteAnalysisView,
  fetchAnalysisViewCitations,
  fetchAnalysisViewSourceStatus,
  fetchAnalysisViews,
  fetchDatasetSummaries,
  materialiseAnalysisChart,
  materialiseAnalysisFacets,
  resolveAnalysisViewSources,
  saveAnalysisView,
} from '#/lib/analysis-studio-data'
import type {
  AnalysisSourceResolution,
  AnalysisViewWire,
  ExportSettings,
} from '#/lib/analysis-studio-data'
import {
  materialiseLiveChart,
  toCanonicalDatasetSource,
  useLiveChartDataset,
} from '#/lib/chart-data'
import type { ChartSpec } from '#/lib/chart-spec'
import { DataClientError } from '#/lib/data-client'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'
import { usePendingEdit } from '#/lib/pending-edits'
import { returnLabel } from '#/lib/return-to'

/**
 * The studio's own search params, as `/analysis/new` decodes them. Passed in
 * rather than read from the route so the route module stays the only place
 * bound to the generated route tree.
 */
export interface AnalysisStudioSearch {
  dataset?: string
  snapshot?: string
  x?: string
  y?: string
  view?: string
  mode?: string
  definition?: string
  experiment?: string
  returnTo?: string
}

/** What the preview draws when no dataset is loaded: an explicit empty chart. */
export function missingDatasetChart() {
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

/**
 * The charts a save writes: the one being edited first, then the view's other
 * charts unchanged, so saving a view never drops the figures beside it.
 */
export function chartsToSave(
  views: readonly AnalysisViewWire[],
  viewId: string | null,
  spec: ChartSpec,
): ChartSpec[] {
  const existing = viewId ? views.find((v) => v.id === viewId) : undefined

  return [spec, ...(existing?.charts.slice(1) ?? [])]
}

/** The dataset list and the saved-view list, read once each. */
export function useAnalysisStudioReads() {
  const summariesQuery = useQuery({
    queryKey: analysisStudioQueryKeys.datasets,
    queryFn: () => fetchDatasetSummaries(),
    staleTime: 30_000,
  })

  const datasets = useMemo(
    () => summariesQuery.data ?? [],
    [summariesQuery.data],
  )

  const viewsQuery = useQuery({
    queryKey: analysisStudioQueryKeys.views,
    queryFn: () => fetchAnalysisViews(analysisStudioDataClient),
    staleTime: 10_000,
  })

  const views = useMemo(() => viewsQuery.data ?? [], [viewsQuery.data])

  return { summariesQuery, viewsQuery, datasets, views }
}

/**
 * The selected dataset as a canonical source, and every source the export and
 * comparison panels offer beside it.
 */
export function useAnalysisStudioSources({
  datasets,
  selectedDatasetId,
}: {
  datasets: CanonicalDatasetWire[]
  selectedDatasetId: string | null
}) {
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

  return { selectedDataset, selectedSource, sources }
}

/**
 * The preview's authoritative materialisation: one live chart shared by the
 * plot and the export panel, the analysis materialisation beside it, and its
 * facet panels.
 */
export function useAnalysisStudioChartData({
  spec,
}: {
  spec: ChartSpec | null
}) {
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

  return {
    datasetQuery,
    liveMaterialised,
    analysisMaterialised,
    analysisFacets,
  }
}

/**
 * The loaded view's staleness and citations, answered by the canonical
 * boundary rather than re-derived in the browser, and the resolution the
 * person picks.
 */
export function useAnalysisStudioSourceStatus({
  selectedViewId,
}: {
  selectedViewId: string | null
}) {
  const queryClient = useQueryClient()

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
        // SAFETY: the source panel that arms this mutation is only drawn while a view is selected.
        viewId: selectedViewId as string,
        expectedVersion: sourceStatusQuery.data?.version ?? 0,
        resolution,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: analysisStudioQueryKeys.views,
      })

      if (selectedViewId) {
        void queryClient.invalidateQueries({
          queryKey: analysisStudioQueryKeys.sourceStatus(selectedViewId),
        })
        void queryClient.invalidateQueries({
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

  return { sourceStatusQuery, citationsQuery, resolveMutation }
}

/**
 * Saving, updating and deleting saved analysis views, including the header's
 * Save (which names an unnamed chart after its dataset) and the leave prompt
 * that asks before an unsaved chart is lost.
 */
export function useAnalysisStudioSavedViews({
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
}: {
  search: AnalysisStudioSearch
  workspaceId: string
  userId: string
  views: readonly AnalysisViewWire[]
  sources: ReturnType<typeof toCanonicalDatasetSource>[]
  spec: ChartSpec | null
  viewName: string
  selectedDataset: CanonicalDatasetWire | null
  selectedViewId: string | null
  setSelectedViewId: (id: string | null) => void
  setViewName: (name: string) => void
  exportSettings: ExportSettings
  markClean: (
    spec: ChartSpec | null,
    name: string,
    exportSettings: ExportSettings,
  ) => void
  chartDirty: boolean
  discardChart: () => void
}) {
  const [deleteTarget, setDeleteTarget] = useState<AnalysisViewWire | null>(
    null,
  )

  const paneId = usePaneContext().paneId
  const saveRef = useRef<() => Promise<boolean>>(async () => false)
  usePendingEdit({
    dirty: chartDirty,
    label: t('data.analysisStudio.analysisStudio'),
    paneId,
    save: () => saveRef.current(),
    discard: discardChart,
  })

  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/analysis/new' })

  const saveMutation = useMutation({
    mutationFn: async (options?: { asNew?: boolean; name?: string }) => {
      const name = (options?.name ?? viewName).trim()

      if (!spec || !name) return
      const sourceRevisions = captureSourceRevisions(sources, spec)

      return saveAnalysisView(
        analysisStudioDataClient,
        {
          id: options?.asNew ? undefined : (selectedViewId ?? undefined),
          name,
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
    onSuccess: (view) => {
      if (view) {
        setSelectedViewId(view.id)
        setViewName(view.name)
      }

      // A saved view has an address: reloading or sharing the page finds it.
      if (view) {
        markClean(
          view.charts[0],
          view.name,
          view.export_settings ?? exportSettings,
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
          action: search.returnTo
            ? {
                label: returnLabel(search.returnTo),
                onClick: () => void navigate({ to: search.returnTo }),
              }
            : undefined,
        })
      }

      void queryClient.invalidateQueries({
        queryKey: analysisStudioQueryKeys.views,
      })
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

  // Save from the header or the leave prompt. A chart with no name yet gets
  // one from its dataset, so saving is never blocked on typing.
  async function saveChart(): Promise<boolean> {
    if (!spec) return false

    // Names take letters, digits, spaces and _ . - only, so a dataset name
    // like "ELISA standard curve, plate PR-01" is cleaned to fit.
    const generated = t('data.analysisStudio.defaultViewName', {
      name: selectedDataset?.name ?? t('data.analysisStudio.analysisStudio'),
    })
      .replace(/[^\p{L}\p{N} _.-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100)
      .replace(/[ _.-]+$/, '')

    // Names are unique per person, so a second unnamed chart becomes "… 2".
    const taken = new Set(views.map((view) => view.name))
    let generatedName = generated

    for (let n = 2; taken.has(generatedName); n += 1) {
      generatedName = `${generated} ${n}`
    }

    const name = viewName.trim() || generatedName

    try {
      return Boolean(await saveMutation.mutateAsync({ name }))
    } catch {
      return false
    }
  }

  useEffect(() => {
    saveRef.current = saveChart
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

      void queryClient.invalidateQueries({
        queryKey: analysisStudioQueryKeys.views,
      })
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

  return {
    deleteTarget,
    setDeleteTarget,
    saveMutation,
    saveChart,
    deleteMutation,
  }
}
