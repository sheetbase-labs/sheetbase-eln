import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '#/copy'
import { toast } from '#/components/ui/sonner'
import { decodeAnalysisBlockDefinition } from '#/lib/analysis-definition'
import type {
  RegressionFitRow,
  ANALYSIS_KINDS,
} from '#/lib/analysis-definition'
import { chartRowSchema } from '#/lib/chart-spec'
import {
  analysisDefinitionQueryKeys,
  captureDefinitionSourceRevisions,
  deleteAnalysisDefinition,
  detectStaleSources,
  fetchAnalysisDefinitions,
  saveAnalysisDefinition,
} from '#/lib/analysis-definitions-data'
import type { AnalysisDefinitionWire } from '#/lib/analysis-definitions-data'
import { resolveDatasetRef, sciDataClient } from '#/lib/chart-data'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import type { DataClient } from '#/lib/data-client'
import { buildRegressionFitChart, buildCurveFitChart } from './analysis-charts'
import type { DefinitionPatch } from './analysis-controls'
import {
  emptyDraft,
  patchDefinitionDraft,
  startDefinitionDraft,
} from './analysis-draft'
import type { DefinitionDraft } from './analysis-draft'
import { useAnalysisExecution } from './analysis-execution'

export interface AnalysisPanelProps {
  datasets: CanonicalDatasetSource[]
  dataClient?: DataClient
  workspaceId: string
  userId: string
  /** The dataset requested by the studio, including later source changes. */
  initialDatasetId?: string | null
  /** Keep the studio's source selector in sync with this panel. */
  onDatasetChange?: (datasetId: string) => void
  /** A snapshot of that dataset to read instead of its live rows. */
  initialSnapshotId?: string | null
  /** A saved statistic to open on, e.g. from the Analysis list. */
  initialDefinitionId?: string
  /** The experiment the studio was opened from; Cite offers it first. */
  experimentId?: string
}

const noDefinitions: AnalysisDefinitionWire[] = []

export function useAnalysisSession({
  datasets,
  dataClient = sciDataClient,
  workspaceId,
  userId,
  initialDatasetId,
  onDatasetChange,
  initialSnapshotId,
  initialDefinitionId,
  experimentId,
}: AnalysisPanelProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [selectedDatasetId, setSelectedDatasetId] = useState(
    initialDatasetId && datasets.some((d) => d.datasetId === initialDatasetId)
      ? initialDatasetId
      : '',
  )

  const [snapshotId, setSnapshotId] = useState<string | null>(
    initialSnapshotId ?? null,
  )

  const [citeOpen, setCiteOpen] = useState(false)
  const [draft, setDraft] = useState<DefinitionDraft>(emptyDraft)

  // Sources can arrive after a deep link, or change in the studio header.
  // An echo of a panel selection must not discard a saved definition's pin.
  const [adoptedInitialDataset, setAdoptedInitialDataset] =
    useState(selectedDatasetId)

  if (
    initialDatasetId &&
    adoptedInitialDataset !== initialDatasetId &&
    datasets.some((dataset) => dataset.datasetId === initialDatasetId)
  ) {
    setAdoptedInitialDataset(initialDatasetId)

    if (selectedDatasetId !== initialDatasetId) {
      setSelectedDatasetId(initialDatasetId)
      setSnapshotId(initialSnapshotId ?? null)
      setDraft(emptyDraft)
    }
  }

  const definitionsQuery = useQuery({
    queryKey: analysisDefinitionQueryKeys.all,
    queryFn: () => fetchAnalysisDefinitions(dataClient),
    staleTime: 10_000,
  })

  const definitions = definitionsQuery.data ?? noDefinitions

  // Dataset rows for execution — read-only canonical rows through the same
  // /api/db boundary as every chart surface.
  const rowsQuery = useQuery({
    queryKey: [
      'analysis-definition-rows',
      selectedDatasetId,
      snapshotId,
    ] as const,
    queryFn: () =>
      resolveDatasetRef(dataClient, {
        datasetId: selectedDatasetId,
        datasetVersionId: snapshotId ?? undefined,
      }),
    enabled: Boolean(selectedDatasetId),
    staleTime: 10_000,
  })

  // Bind and label the fields of the examined version, not today's schema.
  const selectedDataset =
    rowsQuery.data?.source ??
    (snapshotId
      ? null
      : (datasets.find((d) => d.datasetId === selectedDatasetId) ?? null))

  const { validation, runnable, execution } = useAnalysisExecution({
    draft,
    selectedDatasetId,
    rowsQuery,
  })

  function updateDefinition(patch: DefinitionPatch) {
    setDraft((previous) => patchDefinitionDraft(previous, patch))
  }

  function startDraft(kind: (typeof ANALYSIS_KINDS)[number]) {
    if (!selectedDataset) return
    setDraft(
      startDefinitionDraft({ kind, source: selectedDataset, snapshotId }),
    )
  }

  const loadDefinition = useCallback(
    (saved: AnalysisDefinitionWire) => {
      const decoded = decodeAnalysisBlockDefinition(saved.definition)

      if (!decoded.ok) {
        toast(decoded.errors.map((error) => error.message).join('\n'))

        return
      }

      if (decoded.definition.kind === 'chart') {
        toast(t('data.analysisPanel.analysisChartOnlySo'))

        return
      }

      const def = decoded.definition
      setDraft({
        editingId: saved.id,
        name: saved.name,
        definition: def,
      })
      setSelectedDatasetId(def.datasets[0]?.datasetId ?? '')
      setSnapshotId(def.datasets[0]?.datasetVersionId ?? null)
      onDatasetChange?.(def.datasets[0]?.datasetId ?? '')
    },
    [onDatasetChange],
  )

  // Opened from the Analysis list: load that statistic once, when it arrives.
  const openedDefinition = useRef<string | null>(null)
  useEffect(() => {
    if (
      !initialDefinitionId ||
      openedDefinition.current === initialDefinitionId
    )
      return
    const saved = definitions.find((row) => row.id === initialDefinitionId)

    if (!saved) return
    openedDefinition.current = initialDefinitionId
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent -- Adopt an asynchronously arrived saved definition after commit; the opened-definition guard and adopted-dataset echo preserve edits and its snapshot pin.
    loadDefinition(saved)
  }, [initialDefinitionId, definitions, loadDefinition])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.definition || !draft.name.trim()) return null

      return saveAnalysisDefinition(
        dataClient,
        {
          id: draft.editingId ?? undefined,
          name: draft.name.trim(),
          definition: draft.definition,
          source_revisions: captureDefinitionSourceRevisions(
            selectedDataset ? [selectedDataset] : [],
            draft.definition,
          ),
        },
        workspaceId,
        userId,
      )
    },
    onSuccess: (saved) => {
      if (saved) loadDefinition(saved)
      void queryClient.invalidateQueries({
        queryKey: analysisDefinitionQueryKeys.all,
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAnalysisDefinition(dataClient, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: analysisDefinitionQueryKeys.all,
      })
    },
    onError: (error) =>
      toast(t('data.analysisPanel.couldDeleteSavedAnalysis'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.analysisPanel.databaseRefused'),
      }),
  })

  // Deleting a saved definition destroys it for the whole workspace with no
  // undo, so the row action asks first, like the other destructive lists.
  const [deleteTarget, setDeleteTarget] =
    useState<AnalysisDefinitionWire | null>(null)

  // SCI-02 → SCI-01 link: overlay the fitted curve on its observations.
  const fitChart = useMemo(() => {
    const resolved = rowsQuery.data

    if (
      !execution ||
      !execution.ok ||
      execution.result.kind !== 'regression' ||
      !draft.definition ||
      draft.definition.kind !== 'regression' ||
      // Grouped runs produce one fit per group; a single overlay would draw
      // one group's model over every group's points.
      draft.definition.group ||
      !resolved ||
      resolved.truncated ||
      resolved.rows.length === 0
    )
      return null

    const fit: RegressionFitRow =
      execution.result.rows.find((row) => row.group === 'all') ??
      execution.result.rows[0]

    return buildRegressionFitChart({
      definition: draft.definition,
      fit,
      rows: resolved.rows.map((row) => chartRowSchema.parse(row)),
    })
  }, [execution, draft.definition, rowsQuery.data])

  // One plot per fitted curve: the standards, the curve, and each unknown
  // placed on it at the dose it reads back as.
  const curveCharts = useMemo(() => {
    if (!execution || !execution.ok || execution.result.kind !== 'curve')
      return []

    return execution.result.rows
      .map((row) => ({ group: row.group, chart: buildCurveFitChart(row) }))
      .filter(
        (
          entry,
        ): entry is {
          group: string
          chart: NonNullable<ReturnType<typeof buildCurveFitChart>>
        } => entry.chart !== null,
      )
      .slice(0, 6)
  }, [execution])

  const staleDetail = useMemo(() => {
    if (!draft.editingId) return null
    const saved = definitions.find((d) => d.id === draft.editingId)

    if (!saved) return null

    return detectStaleSources(saved.source_revisions, datasets)
  }, [draft.editingId, definitions, datasets])

  function selectDataset(id: string) {
    setSelectedDatasetId(id)
    setSnapshotId(null)
    setDraft(emptyDraft)
    onDatasetChange?.(id)
  }

  return {
    datasets,
    dataClient,
    onDatasetChange,
    experimentId,
    navigate,
    selectedDatasetId,
    setSelectedDatasetId,
    snapshotId,
    setSnapshotId,
    draft,
    setDraft,
    citeOpen,
    setCiteOpen,
    definitions,
    definitionsQuery,
    rowsQuery,
    selectedDataset,
    validation,
    runnable,
    execution,
    updateDefinition,
    startDraft,
    loadDefinition,
    selectDataset,
    saveMutation,
    deleteMutation,
    deleteTarget,
    setDeleteTarget,
    fitChart,
    curveCharts,
    staleDetail,
  }
}

export type AnalysisPanelModel = ReturnType<typeof useAnalysisSession>
