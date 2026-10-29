import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { datasetOption } from '#/components/v3/record-picker/entity-options'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Save, Sigma, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
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
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Input } from '#/components/v3/ui/input'
import { RecordPicker } from '#/components/v3/record-picker/record-picker'
import type { PickerItem } from '#/components/v3/record-picker/record-picker-data'
import { Select } from '#/components/v3/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  ANALYSIS_KINDS,
  COLUMN_TRANSFORMS,
  MAX_DEGREE,
  TRANSFORM_FNS,
  analysisMethodsText,
  regressionFitCurve,
  runAnalysis,
  validateAnalysisDefinition,
} from '#/lib/analysis-definition'
import type {
  AnalysisDefinition,
  AnalysisError,
  AnalysisResult,
  AssumptionCheck,
  DescriptiveResult,
  RegressionFitRow,
  RegressionResult,
} from '#/lib/analysis-definition'
import { formatScientific } from '#/lib/chart-spec'
import type { ChartSpec, MaterialisedChart } from '#/lib/chart-spec'
import { toast } from '#/components/v3/ui/sonner'
import {
  analysisDefinitionQueryKeys,
  captureDefinitionSourceRevisions,
  deleteAnalysisDefinition,
  detectStaleSources,
  fetchAnalysisDefinitions,
  freezeAnalysisBlock,
  saveAnalysisDefinition,
} from '#/lib/analysis-definitions-data'
import type { AnalysisDefinitionWire } from '#/lib/analysis-definitions-data'
import { resolveDatasetRef, sciDataClient } from '#/lib/chart-data'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { SnapshotSourceBanner } from './snapshot-source-banner'
import { fetchRecord, notebookDataClient } from '#/lib/notebook-data'
import { insertBlock } from '#/lib/notebook-mutations'

/**
 * SCI-02 — reusable analysis definitions in the Analysis Studio;
 * R5-STUDIO-01 — every result states its method and its assumption checks.
 *
 * Define, run, save and reload grouped descriptive statistics and polynomial
 * regressions over stable dataset references. Execution is pure TypeScript
 * (`runAnalysis`) so results are deterministic and traceable to explicit
 * inputs; saved definitions record the source revisions captured at save
 * time and surface a stale-source badge when their inputs have evolved.
 *
 * The result panel always names the method (`AnalysisMethodSummary`) and
 * lists its checks (`AssumptionCheckList`), including a failed one, which is
 * shown as it stands.
 */

export interface AnalysisPanelProps {
  datasets: CanonicalDatasetSource[]
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

interface DefinitionDraft {
  editingId: string | null
  name: string
  definition: AnalysisDefinition | null
}

const emptyDraft: DefinitionDraft = {
  editingId: null,
  name: '',
  definition: null,
}

export function AnalysisPanel({
  datasets,
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
  const adoptedInitialDataset = useRef(selectedDatasetId)
  useEffect(() => {
    if (!initialDatasetId || adoptedInitialDataset.current === initialDatasetId)
      return
    if (!datasets.some((d) => d.datasetId === initialDatasetId)) return
    adoptedInitialDataset.current = initialDatasetId
    if (selectedDatasetId === initialDatasetId) return
    setSelectedDatasetId(initialDatasetId)
    setSnapshotId(initialSnapshotId ?? null)
    setDraft(emptyDraft)
  }, [datasets, initialDatasetId, initialSnapshotId, selectedDatasetId])

  const definitionsQuery = useQuery({
    queryKey: analysisDefinitionQueryKeys.all,
    queryFn: () => fetchAnalysisDefinitions(),
    staleTime: 10_000,
  })
  const definitions = definitionsQuery.data ?? []

  // Dataset rows for execution — read-only canonical rows through the same
  // /api/db boundary as every chart surface.
  const rowsQuery = useQuery({
    queryKey: [
      'analysis-definition-rows',
      selectedDatasetId,
      snapshotId,
    ] as const,
    queryFn: () =>
      resolveDatasetRef(sciDataClient, {
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

  // A definition is runnable once it validates structurally and its dataset
  // is selected; execution errors surface per-run below.
  const validation = useMemo(
    () =>
      draft.definition
        ? validateAnalysisDefinition(draft.definition)
        : [
            {
              code: 'missing_field' as const,
              message: t('data.analysisPanel.definitionYet'),
            },
          ],
    [draft.definition],
  )
  const runnable =
    draft.definition !== null &&
    validation.length === 0 &&
    Boolean(selectedDatasetId) &&
    !rowsQuery.isLoading &&
    !rowsQuery.isError

  const execution = useMemo(() => {
    const resolved = rowsQuery.data
    if (!runnable || !draft.definition || !resolved) return null
    // Over-ceiling datasets refuse execution honestly instead of computing
    // statistics over a truncated sample.
    if (resolved.truncated) return null
    return runAnalysis(
      draft.definition,
      resolved.source.columns,
      resolved.rows,
      resolved.flags,
    )
  }, [runnable, draft.definition, rowsQuery.data])

  function updateDefinition(patch: Partial<AnalysisDefinition>) {
    setDraft((prev) => {
      if (!prev.definition) return prev
      return {
        ...prev,
        definition: { ...prev.definition, ...patch } as AnalysisDefinition,
      }
    })
  }

  function startDraft(kind: (typeof ANALYSIS_KINDS)[number]) {
    if (!selectedDataset) return
    const numeric = selectedDataset.columns.filter((c) =>
      ['decimal', 'integer'].includes(c.logicalType),
    )
    const category = selectedDataset.columns.filter((c) =>
      ['category', 'text', 'boolean'].includes(c.logicalType),
    )
    const bind = (column?: { id: string }) =>
      column ? { fieldId: column.id } : null
    const first = numeric[0]
    const base = {
      definitionVersion: 1 as const,
      datasets: [
        {
          datasetId: selectedDataset.datasetId,
          ...(snapshotId ? { datasetVersionId: snapshotId } : {}),
        },
      ],
    }
    const definition: AnalysisDefinition =
      kind === 'descriptive'
        ? {
            ...base,
            kind: 'descriptive',
            value: bind(first)!,
            group: bind(category[0]),
          }
        : {
            ...base,
            kind: 'regression',
            outcome: bind(numeric[1] ?? first)!,
            predictor: bind(first)!,
            degree: 1,
          }
    setDraft({ editingId: null, name: '', definition })
  }

  function loadDefinition(saved: AnalysisDefinitionWire) {
    const def = saved.definition as AnalysisDefinition
    setDraft({
      editingId: saved.id,
      name: saved.name,
      definition: def,
    })
    setSelectedDatasetId(def.datasets[0]?.datasetId ?? '')
    setSnapshotId(def.datasets[0]?.datasetVersionId ?? null)
    onDatasetChange?.(def.datasets[0]?.datasetId ?? '')
  }

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
    loadDefinition(saved)
    // `loadDefinition` only sets state from `saved`.
  }, [initialDefinitionId, definitions])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.definition || !draft.name.trim()) return null
      return saveAnalysisDefinition(
        sciDataClient,
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
    mutationFn: (id: string) => deleteAnalysisDefinition(sciDataClient, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: analysisDefinitionQueryKeys.all,
      })
    },
    onError: (error: unknown) =>
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
      rows: resolved.rows,
    })
  }, [execution, draft.definition, rowsQuery.data])

  const staleDetail = useMemo(() => {
    if (!draft.editingId) return null
    const saved = definitions.find((d) => d.id === draft.editingId)
    if (!saved) return null
    return detectStaleSources(saved.source_revisions, datasets)
  }, [draft.editingId, definitions, datasets])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {snapshotId && selectedDatasetId ? (
        <SnapshotSourceBanner
          datasetId={selectedDatasetId}
          datasetVersionId={snapshotId}
          onUseLive={() => {
            setSnapshotId(null)
            setDraft((prev) =>
              prev.definition
                ? {
                    ...prev,
                    definition: {
                      ...prev.definition,
                      datasets: prev.definition.datasets.map(
                        ({ datasetId }) => ({ datasetId }),
                      ),
                    },
                  }
                : prev,
            )
          }}
        />
      ) : null}
      <div className="rounded-lg border border-border bg-surface space-y-3 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-44 flex-1 flex-col gap-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="analysis-definition-dataset"
            >
              {t('data.analysisPanel.dataset')}
            </label>
            <PickerSelect
              noun="dataset"
              id="analysis-definition-dataset"
              aria-label={t('data.analysisPanel.ariaAnalysisDataset')}
              size="sm"
              value={selectedDatasetId}
              onChange={(id) => {
                setSelectedDatasetId(id)
                // Pins and field bindings belong to the previous dataset.
                setSnapshotId(null)
                setDraft(emptyDraft)
                onDatasetChange?.(id)
              }}
              placeholder="Select a dataset"
              clearLabel={onDatasetChange ? undefined : 'Select a dataset'}
              options={datasets.map((d) =>
                datasetOption({ id: d.datasetId, name: d.name }),
              )}
              className="bg-surface"
            />
          </div>
          <div className="flex min-w-40 flex-1 flex-col gap-1">
            <label className="text-label text-fg-muted" htmlFor="analysis-kind">
              {t('data.analysisPanel.analysis')}
            </label>
            <div className="flex items-center gap-1">
              {ANALYSIS_KINDS.map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={
                    draft.definition?.kind === kind ? 'primary' : 'secondary'
                  }
                  disabled={!selectedDataset}
                  aria-pressed={draft.definition?.kind === kind}
                  onClick={() => startDraft(kind)}
                >
                  <Sigma className="size-3.5" aria-hidden />
                  {kind === 'descriptive'
                    ? t('data.analysisPanel.descriptiveAnova')
                    : t('data.analysisPanel.regressionFit')}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {draft.definition && selectedDataset ? (
          <AnalysisDefinitionControls
            definition={draft.definition}
            table={selectedDataset}
            onChange={updateDefinition}
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!runnable}
            onClick={() => rowsQuery.refetch()}
          >
            <Icon name="play" /> {t('data.analysisPanel.run')}
          </Button>
          <Input
            aria-label={t('data.analysisPanel.ariaAnalysisName')}
            placeholder={t('data.analysisPanel.placeholderNameAnalysis')}
            value={draft.name}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, name: event.target.value }))
            }
            className="h-[26px] w-48 bg-surface text-label max-md:h-8"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={
              !draft.definition ||
              validation.length > 0 ||
              draft.name.trim() === '' ||
              saveMutation.isPending
            }
            onClick={() => saveMutation.mutate()}
          >
            <Save className="size-3.5" aria-hidden />{' '}
            {draft.editingId
              ? t('data.analysisPanel.update')
              : t('common.actions.save')}
          </Button>
          {draft.editingId ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setCiteOpen(true)}
            >
              {t('data.analysisPanel.citeNotebook')}
            </Button>
          ) : null}
          {staleDetail ? (
            <Badge variant="chg">
              <Icon name="warn" className="size-3" aria-hidden />
              {t('data.analysisPanel.staleSource')}
            </Badge>
          ) : null}
        </div>
        {staleDetail ? (
          <p role="status" className="text-xs text-fg-muted">
            {staleDetail}
          </p>
        ) : null}
      </div>

      {rowsQuery.error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-xs text-danger-text"
        >
          {rowsQuery.error.message}
        </div>
      ) : execution && execution.ok ? (
        <AnalysisResultTable result={execution.result} />
      ) : execution ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-xs text-danger-text"
        >
          {describeExecutionError(execution.error)}
        </div>
      ) : (
        <div
          role="status"
          className="rounded-md border border-dashed border-border bg-surface-muted/20 p-6 text-sm text-fg-muted"
        >
          {t('data.analysisPanel.pickDatasetChooseAnalysis')}
        </div>
      )}

      {fitChart ? (
        <div className="rounded-md border p-2">
          <p className="mb-1 text-xs font-medium text-fg-muted">
            {t('data.analysisPanel.fittedCurveOverObservations')}
          </p>
          <ChartRenderer
            title={t('data.analysisPanel.fitPreview')}
            hideTitle
            spec={fitChart.spec}
            materialised={fitChart.materialised}
            frozen={null}
            showTableAlternative={false}
            plotHeight={220}
          />
        </div>
      ) : execution &&
        execution.ok &&
        draft.definition?.kind === 'regression' &&
        draft.definition.group ? (
        <p className="rounded-md border border-dashed border-border bg-surface-muted/20 p-3 text-xs text-fg-muted">
          {t('data.analysisPanel.groupedFitsProduceOne')}
        </p>
      ) : null}

      {citeOpen && draft.editingId ? (
        <CiteDefinitionDialog
          definitionId={draft.editingId}
          defaultTitle={draft.name}
          defaultExperimentId={experimentId}
          onClose={() => setCiteOpen(false)}
          onCited={(experiment) => {
            setCiteOpen(false)
            toast(t('data.analysisPanel.citedNotebook'), {
              description: t('data.analysisPanel.nowShowsAnalysis', {
                identifier: experiment.identifier,
              }),
              action: {
                label: t('data.analysisPanel.openNotebook'),
                onClick: () =>
                  void navigate({
                    to: '/experiments/$expId/notebook',
                    params: { expId: experiment.id },
                  }),
              },
            })
          }}
        />
      ) : null}

      <SavedDefinitionsList
        definitions={definitions}
        loading={definitionsQuery.isLoading}
        activeId={draft.editingId}
        onLoad={loadDefinition}
        onDelete={setDeleteTarget}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('data.analysisPanel.deleteSavedAnalysis')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('data.analysisPanel.sourceRevisionsRecordedDeleted', {
                name: deleteTarget?.name ?? '',
              })}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={deleteMutation.isPending}>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!deleteTarget) return
                deleteMutation.mutate(deleteTarget.id)
                setDeleteTarget(null)
              }}
            >
              {deleteMutation.isPending
                ? t('data.analysisPanel.deleting')
                : t('common.actions.delete')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Definition controls
// ---------------------------------------------------------------------------

type NumericColumn = { id: string; label: string }

function columnOptions(columns: NumericColumn[]) {
  return columns.map((column) => (
    <option key={column.id} value={column.id}>
      {column.label}
    </option>
  ))
}

function bindingValue(binding: { fieldId: string } | null | undefined): string {
  return binding?.fieldId ?? ''
}

function AnalysisDefinitionControls({
  definition,
  table,
  onChange,
}: {
  definition: AnalysisDefinition
  table: CanonicalDatasetSource
  onChange: (patch: Partial<AnalysisDefinition>) => void
}) {
  const numeric = table.columns.filter((c) =>
    ['decimal', 'integer'].includes(c.logicalType),
  )
  const category = table.columns.filter((c) =>
    ['category', 'text', 'boolean'].includes(c.logicalType),
  )

  function setBinding(key: string, fieldId: string, required: boolean) {
    const column = [...numeric, ...category].find((c) => c.id === fieldId)
    const value =
      column === undefined && !required
        ? null
        : column
          ? { fieldId: column.id }
          : undefined
    onChange({ [key]: value })
  }

  function setTransform(
    key: 'outcomeTransform' | 'predictorTransform',
    value: string,
  ) {
    const transform =
      value === '' || !(COLUMN_TRANSFORMS as readonly string[]).includes(value)
        ? undefined
        : (value as (typeof COLUMN_TRANSFORMS)[number])
    onChange({ [key]: transform })
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      {definition.kind === 'descriptive' ? (
        <>
          <div className="flex min-w-36 flex-1 flex-col gap-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="analysis-value"
            >
              {t('data.analysisPanel.measuredValue')}
            </label>
            <Select
              id="analysis-value"
              aria-label={t('data.analysisPanel.ariaMeasuredValueColumn')}
              size="sm"
              value={bindingValue(definition.value)}
              onChange={(e) => setBinding('value', e.target.value, true)}
              className="bg-surface"
            >
              {columnOptions(numeric)}
            </Select>
          </div>
          <div className="flex min-w-36 flex-1 flex-col gap-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="analysis-group"
            >
              {t('data.analysisPanel.groupOptional')}
            </label>
            <Select
              id="analysis-group"
              aria-label={t('data.analysisPanel.ariaGroupColumn')}
              size="sm"
              value={bindingValue(definition.group)}
              onChange={(e) => setBinding('group', e.target.value, false)}
              className="bg-surface"
            >
              <option value="">{t('data.analysisPanel.oneGroup')}</option>
              {columnOptions(category)}
            </Select>
          </div>
        </>
      ) : (
        <>
          <div className="flex min-w-36 flex-1 flex-col gap-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="analysis-outcome"
            >
              {t('data.analysisPanel.outcomeY')}
            </label>
            <Select
              id="analysis-outcome"
              aria-label={t('data.analysisPanel.ariaOutcomeColumn')}
              size="sm"
              value={bindingValue(definition.outcome)}
              onChange={(e) => setBinding('outcome', e.target.value, true)}
              className="bg-surface"
            >
              {columnOptions(numeric)}
            </Select>
          </div>
          <div className="flex min-w-36 flex-1 flex-col gap-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="analysis-predictor"
            >
              {t('data.analysisPanel.predictorX')}
            </label>
            <Select
              id="analysis-predictor"
              aria-label={t('data.analysisPanel.ariaPredictorColumn')}
              size="sm"
              value={bindingValue(definition.predictor)}
              onChange={(e) => setBinding('predictor', e.target.value, true)}
              className="bg-surface"
            >
              {columnOptions(numeric)}
            </Select>
          </div>
          <div className="flex min-w-24 flex-col gap-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="analysis-degree"
            >
              {t('data.analysisPanel.degree')}
            </label>
            <Select
              id="analysis-degree"
              aria-label={t('data.analysisPanel.ariaPolynomialDegree')}
              size="sm"
              value={String(definition.degree ?? 1)}
              onChange={(e) =>
                onChange({
                  degree: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="bg-surface"
            >
              {Array.from({ length: MAX_DEGREE }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex min-w-32 flex-col gap-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="analysis-y-transform"
            >
              {t('data.analysisPanel.yTransform')}
            </label>
            <Select
              id="analysis-y-transform"
              aria-label={t('data.analysisPanel.ariaOutcomeTransform')}
              size="sm"
              value={definition.outcomeTransform ?? ''}
              onChange={(e) => setTransform('outcomeTransform', e.target.value)}
              className="bg-surface"
            >
              <option value="">{t('common.states.none')}</option>
              <option value="log10">{t('data.analysisPanel.log')}</option>
              <option value="ln">ln</option>
            </Select>
          </div>
          <div className="flex min-w-32 flex-col gap-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="analysis-x-transform"
            >
              {t('data.analysisPanel.xTransform')}
            </label>
            <Select
              id="analysis-x-transform"
              aria-label={t('data.analysisPanel.ariaPredictorTransform')}
              size="sm"
              value={definition.predictorTransform ?? ''}
              onChange={(e) =>
                setTransform('predictorTransform', e.target.value)
              }
              className="bg-surface"
            >
              <option value="">{t('common.states.none')}</option>
              <option value="log10">{t('data.analysisPanel.log')}</option>
              <option value="ln">ln</option>
            </Select>
          </div>
          <div className="flex min-w-36 flex-1 flex-col gap-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="analysis-regression-group"
            >
              {t('data.analysisPanel.groupFitsOptional')}
            </label>
            <Select
              id="analysis-regression-group"
              aria-label={t('data.analysisPanel.ariaRegressionGroupingColumn')}
              size="sm"
              value={bindingValue(definition.group)}
              onChange={(e) => setBinding('group', e.target.value, false)}
              className="bg-surface"
            >
              <option value="">{t('data.analysisPanel.oneFit')}</option>
              {columnOptions(category)}
            </Select>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export function describeExecutionError(error: AnalysisError): string {
  switch (error.code) {
    case 'missing_field':
      return t('data.analysisPanel.definitionMissingInputColumn', {
        count: error.fields.length,
        fields: error.fields.join(', '),
      })
    case 'empty_dataset':
      return t('data.analysisPanel.datasetHasRowsAnalyse')
    case 'no_statistic':
      return t('data.analysisPanel.analysisChartOnlySo')
    case 'insufficient_data':
      return t('data.analysisPanel.groupHasTooFew', {
        group: error.group,
        needed: error.needed,
      })
    case 'singular_fit':
      return t('data.analysisPanel.groupHasConstantPredictor', {
        group: error.group,
      })
    case 'nonpositive_transform':
      return t('data.analysisPanel.nonpositiveTransform', {
        count: error.count,
        field: error.field,
      })
    case 'no_numeric_values':
      return t('data.analysisPanel.columnHasNumericValues', {
        field: error.field,
      })
    case 'method_mismatch':
      return t('data.analysisPanel.methodMismatchEvidenceRecords', {
        recorded: error.recorded,
        current: error.current,
      })
  }
}

const CHECK_STATUS_LABEL: Record<AssumptionCheck['status'], string> = {
  pass: t('data.analysisPanel.passes'),
  warn: t('data.analysisPanel.warning'),
  fail: t('data.analysisPanel.fails'),
  not_checked: t('data.analysisPanel.notChecked'),
}

const CHECK_STATUS_CLASS: Record<AssumptionCheck['status'], string> = {
  pass: 'text-fg-muted',
  warn: 'text-warning-text',
  fail: 'font-medium text-danger-text',
  not_checked: 'text-fg-muted',
}

function formatP(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—'
  return value < 0.001 ? '< 0.001' : formatScientific(value)
}

async function copyMethodsText(result: AnalysisResult): Promise<void> {
  try {
    await navigator.clipboard.writeText(analysisMethodsText(result))
    toast(t('data.analysisPanel.methodsTextCopied'), {
      description: t('data.analysisPanel.pasteIntoNotebookS'),
    })
  } catch {
    toast(t('common.errors.couldNotCopy'), {
      description: t('data.analysisPanel.clipboardRejectedWrite'),
    })
  }
}

/**
 * The method panel: what ran, under which method-definition version and
 * runner, and the statement of what it assumes. A result is never shown
 * without it.
 */
function AnalysisMethodSummary({ result }: { result: AnalysisResult }) {
  return (
    <div className="rounded-md border bg-surface-muted/20 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{result.method.label}</span>
        <Badge variant="kind">
          {t('data.analysisPanel.methodV')}
          {result.method.version}
        </Badge>
        <span className="font-mono text-xs text-fg-muted">
          {result.method.runner}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void copyMethodsText(result)}
        >
          {t('data.analysisPanel.copyMethodsText')}
        </Button>
      </div>
      <p className="mt-1 text-xs leading-5 text-fg-muted">
        {result.method.statement}
      </p>
    </div>
  )
}

/**
 * Assumption and design checks, in the order the kernel ran them. A failed
 * check is rendered exactly as it came back — never softened, hidden or
 * corrected — and a check that could not be run says `Not checked` rather
 * than claiming a pass.
 */
function AssumptionCheckList({ checks }: { checks: AssumptionCheck[] }) {
  if (checks.length === 0)
    return (
      <p className="text-xs text-fg-muted">
        {t('data.analysisPanel.assumptionsCheckedModelFitted')}
      </p>
    )
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs font-medium text-fg-muted">
        {t('data.analysisPanel.assumptionChecks')}
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {checks.map((check) => (
          <li
            key={`${check.group ?? ''}:${check.id}`}
            className="text-xs leading-5"
          >
            <span className={CHECK_STATUS_CLASS[check.status]}>
              {CHECK_STATUS_LABEL[check.status]} ·{' '}
              {check.group
                ? t('data.analysisPanel.group', { group: check.group })
                : ''}
              {check.label}
            </span>
            <span className="block text-fg-muted">{check.detail}</span>
            {check.remedy && check.status !== 'pass' ? (
              <span className="block text-fg-muted">{check.remedy}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DescriptiveResultTables({ result }: { result: DescriptiveResult }) {
  const stats = [
    ['n', (r: (typeof result.rows)[number]) => String(r.stats.n)],
    ['missing', (r: (typeof result.rows)[number]) => String(r.missing)],
    [
      'mean',
      (r: (typeof result.rows)[number]) => formatScientific(r.stats.mean),
    ],
    ['sd', (r: (typeof result.rows)[number]) => formatScientific(r.stats.sd)],
    ['se', (r: (typeof result.rows)[number]) => formatScientific(r.stats.se)],
    ['min', (r: (typeof result.rows)[number]) => formatScientific(r.stats.min)],
    ['q1', (r: (typeof result.rows)[number]) => formatScientific(r.stats.q1)],
    [
      'median',
      (r: (typeof result.rows)[number]) => formatScientific(r.stats.median),
    ],
    ['q3', (r: (typeof result.rows)[number]) => formatScientific(r.stats.q3)],
    ['max', (r: (typeof result.rows)[number]) => formatScientific(r.stats.max)],
  ] as const
  const intervalByGroup = new Map(
    (result.anova?.groups ?? []).map((group) => [group.group, group.ci95]),
  )
  const anova = result.anova
  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded-md border">
        <Table>
          <caption className="sr-only">
            {t('data.analysisPanel.descriptiveStatisticsPerGroup')}
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                {t('data.analysisPanel.group2')}
              </TableHead>
              {stats.map(([label]) => (
                <TableHead key={label} scope="col">
                  {label}
                </TableHead>
              ))}
              {anova ? (
                <TableHead scope="col">
                  {t('data.analysisPanel.n95CiMean')}
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => {
              const interval = intervalByGroup.get(row.group)
              return (
                <TableRow key={row.group}>
                  <TableCell className="font-medium">{row.group}</TableCell>
                  {stats.map(([label, get]) => (
                    <TableCell key={label} className="font-mono tabular-nums">
                      {get(row)}
                    </TableCell>
                  ))}
                  {anova ? (
                    <TableCell className="font-mono tabular-nums">
                      {interval
                        ? `${formatScientific(interval.lo)} – ${formatScientific(interval.hi)}`
                        : '—'}
                    </TableCell>
                  ) : null}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {anova ? (
        <div className="overflow-auto rounded-md border">
          <Table>
            <caption className="sr-only">
              {t('data.analysisPanel.oneWayAnovaGroup', {
                value: formatScientific(anova.etaSquared),
              })}
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">
                  {t('data.analysisPanel.source')}
                </TableHead>
                <TableHead scope="col">{t('data.analysisPanel.ss')}</TableHead>
                <TableHead scope="col">df</TableHead>
                <TableHead scope="col">{t('data.analysisPanel.ms')}</TableHead>
                <TableHead scope="col">F</TableHead>
                <TableHead scope="col">p</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">
                  {t('data.analysisPanel.betweenGroups')}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(anova.ssBetween)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {anova.dfBetween}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(anova.msBetween)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(anova.f)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatP(anova.p)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">
                  {t('data.analysisPanel.withinGroups')}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(anova.ssWithin)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {anova.dfWithin}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(anova.msWithin)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">—</TableCell>
                <TableCell className="font-mono tabular-nums">—</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="border-t px-2 py-1 text-xs text-fg-muted">
            {t('data.analysisPanel.observationsAcrossGroups', {
              value: formatScientific(anova.etaSquared),
              n: anova.n,
              length: anova.groups.length,
            })}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function RegressionResultTables({ result }: { result: RegressionResult }) {
  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded-md border">
        <Table>
          <caption className="sr-only">
            {t('data.analysisPanel.regressionFitsPerGroup')}
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                {t('data.analysisPanel.group2')}
              </TableHead>
              <TableHead scope="col">n</TableHead>
              <TableHead scope="col">degree</TableHead>
              <TableHead scope="col">R²</TableHead>
              <TableHead scope="col">{t('data.analysisPanel.rmse')}</TableHead>
              <TableHead scope="col">
                {t('data.analysisPanel.equation')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.group}>
                <TableCell className="font-medium">{row.group}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {row.n}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {row.degree}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(row.r2)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(row.rmse)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {row.equation}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {result.rows.map((row) => (
        <div key={row.group} className="space-y-1 rounded-md border p-2">
          <p className="text-xs font-medium text-fg-muted">
            {row.group === 'all'
              ? t('data.analysisPanel.terms')
              : t('data.analysisPanel.groupTerms', { group: row.group })}{' '}
            · {row.equation}
          </p>
          <p className="text-xs text-fg-muted">
            {[
              t('data.analysisPanel.adjustedRResidualDf', {
                value: formatScientific(row.adjR2),
                value2: formatScientific(row.sigma),
                dfResidual: row.dfResidual,
              }),
              row.f === null
                ? null
                : t('data.analysisPanel.overallFP', {
                    degree: row.degree,
                    dfResidual: row.dfResidual,
                    value: formatScientific(row.f),
                    value2: formatP(row.fP),
                  }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="overflow-auto">
            <Table>
              <caption className="sr-only">
                {t('data.analysisPanel.modelTermsFittedSpace')}
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    {t('data.analysisPanel.term')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('data.analysisPanel.estimate')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('data.analysisPanel.se')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('data.analysisPanel.n95Ci')}
                  </TableHead>
                  <TableHead scope="col">t</TableHead>
                  <TableHead scope="col">p</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {row.terms.map((term) => (
                  <TableRow key={term.term}>
                    <TableCell className="font-medium">{term.term}</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {formatScientific(term.estimate)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {formatScientific(term.se)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {term.ci95
                        ? `${formatScientific(term.ci95.lo)} – ${formatScientific(term.ci95.hi)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {formatScientific(term.t)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {formatP(term.p)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  )
}

export function AnalysisResultTable({ result }: { result: AnalysisResult }) {
  return (
    <div className="space-y-3">
      <AnalysisMethodSummary result={result} />
      {result.kind === 'descriptive' ? (
        <DescriptiveResultTables result={result} />
      ) : (
        <RegressionResultTables result={result} />
      )}
      <AssumptionCheckList checks={result.checks} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Saved definitions
// ---------------------------------------------------------------------------

function SavedDefinitionsList({
  definitions,
  loading,
  activeId,
  onLoad,
  onDelete,
}: {
  definitions: AnalysisDefinitionWire[]
  loading: boolean
  activeId: string | null
  onLoad: (saved: AnalysisDefinitionWire) => void
  onDelete: (saved: AnalysisDefinitionWire) => void
}) {
  if (loading)
    return (
      <div className="p-3 text-xs text-fg-muted" role="status">
        {t('data.analysisPanel.loadingSavedAnalyses')}
      </div>
    )
  if (definitions.length === 0)
    return (
      <div className="p-3 text-xs text-fg-muted" role="status">
        {t('data.analysisPanel.savedAnalysesYet')}
      </div>
    )
  return (
    <ul
      className="space-y-1 overflow-auto"
      aria-label={t('data.analysisPanel.ariaSavedAnalyses')}
    >
      {definitions.map((saved) => (
        <li
          key={saved.id}
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
        >
          <span className="truncate font-medium">{saved.name}</span>
          <span className="flex items-center gap-2">
            <Badge variant="kind">v{saved.version}</Badge>
            {activeId === saved.id ? (
              <Badge>{t('data.analysisPanel.savingEditsHere')}</Badge>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onLoad(saved)}
            >
              {t('data.analysisPanel.load')}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="quiet"
              aria-label={t('data.analysisPanel.ariaDelete', {
                name: saved.name,
              })}
              onClick={() => onDelete(saved)}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </Button>
          </span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// SCI-02 → SCI-01 link: plot a fitted regression curve over its observations
// ---------------------------------------------------------------------------

interface FitChartSpecInput {
  definition: Extract<AnalysisDefinition, { kind: 'regression' }>
  fit: RegressionFitRow
  rows: Record<string, unknown>[]
}

/**
 * Build the observed-points + fitted-curve materialisation for a regression
 * run. Pure so the studio preview and future surfaces share one construction.
 *
 * Correctness contract: the plotted space IS the fitted space. Coefficients
 * describe the transformed coordinates (ADR 0040 §6 — never back-transformed),
 * so observations are drawn with the same monotonic transforms applied and
 * axis labels name the transform. Ungrouped runs only: grouped fits produce
 * one model per group, which a single overlay cannot represent honestly.
 */
export function buildRegressionFitChart(input: FitChartSpecInput): {
  spec: ChartSpec
  materialised: MaterialisedChart
} | null {
  const { definition, fit } = input
  if (definition.group) return null

  const predictorTransform = definition.predictorTransform ?? 'none'
  const outcomeTransform = definition.outcomeTransform ?? 'none'
  const transformLabel: Record<
    Exclude<(typeof COLUMN_TRANSFORMS)[number], 'none'>,
    string
  > = { log10: 'log10', ln: 'ln' }
  const applyTransform = (
    value: number,
    kind: (typeof COLUMN_TRANSFORMS)[number],
  ): number | null => {
    if (kind === 'none') return value
    // A non-positive observation cannot exist in the fitted log space; the
    // execution kernel already refused these, so this is belt-and-braces.
    if (value <= 0) return null
    return TRANSFORM_FNS[kind](value)
  }

  const pairs: Array<{ x: number; y: number }> = []
  for (const row of input.rows) {
    const rawX = toNumberValue(row[definition.predictor.fieldId])
    const rawY = toNumberValue(row[definition.outcome.fieldId])
    if (rawX === null || rawY === null) continue
    const px = applyTransform(rawX, predictorTransform)
    const py = applyTransform(rawY, outcomeTransform)
    if (px !== null && py !== null) pairs.push({ x: px, y: py })
  }
  if (pairs.length === 0) return null
  const xs = pairs.map((p) => p.x)
  const min = Math.min(...xs)
  const max = Math.max(...xs)

  const observed = 'var(--series-a)'
  const fitColor = 'var(--series-b)'
  const xLabel =
    predictorTransform === 'none'
      ? t('data.analysisPanel.predictor')
      : `${transformLabel[predictorTransform]}(Predictor)`
  const yLabel =
    outcomeTransform === 'none'
      ? t('data.analysisPanel.outcome')
      : `${transformLabel[outcomeTransform]}(Outcome)`

  return {
    spec: {
      specVersion: 1,
      type: 'scatter',
      datasets: [],
      fields: {
        x: null,
        y: { fieldId: '' },
        series: null,
        color: null,
        size: null,
        facet: null,
      },
      filters: [],
      transformations: [],
      typeParams: {},
      display: {
        axes: {
          x: { label: xLabel, scale: 'linear' },
          y: { label: yLabel, scale: 'linear' },
        },
        series: [
          {
            identifier: 'observed',
            label: t('data.analysisPanel.observed'),
            color: observed,
          },
          {
            identifier: 'fit',
            label: t('data.analysisPanel.fit', { equation: fit.equation }),
            color: fitColor,
          },
        ],
        legend: { visible: true },
        annotations: [],
      },
      overlays: { errorBars: null },
    },
    materialised: {
      state: { kind: 'ok' },
      columns: [],
      rows: [],
      series: [
        {
          identifier: 'observed',
          label: t('data.analysisPanel.observed'),
          color: observed,
          points: pairs.map((p) => ({
            x: p.x,
            y: p.y,
            yError: null,
            label: t('data.analysisPanel.observed'),
          })),
        },
        {
          identifier: 'fit',
          label: t('data.analysisPanel.fit2', {
            value: formatScientific(fit.r2),
          }),
          color: fitColor,
          renderAs: 'line',
          points: regressionFitCurve(fit.coefficients, { min, max }).map(
            (pt) => ({
              x: pt.x,
              y: pt.y,
              yError: null,
              label: t('data.analysisPanel.fit3'),
            }),
          ),
        },
      ],
      xLabel,
      yLabel,
      xUnit: undefined,
      yUnit: undefined,
      droppedPoints: 0,
    },
  }
}

function toNumberValue(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Cite a saved statistic in an experiment's notebook: an `analysis` block that
 * names the saved definition, frozen on the dataset version it ran against. The
 * experiment the studio was opened from is the first choice.
 */
function CiteDefinitionDialog({
  definitionId,
  defaultTitle,
  defaultExperimentId,
  onClose,
  onCited,
}: {
  definitionId: string
  defaultTitle: string
  defaultExperimentId?: string
  onClose: () => void
  onCited: (experiment: { id: string; identifier: string }) => void
}) {
  const [title, setTitle] = useState(defaultTitle)
  const [picked, setPicked] = useState<PickerItem | null>(null)
  const handed = useQuery({
    queryKey: ['analysis-panel', 'cite-target', defaultExperimentId],
    enabled: Boolean(defaultExperimentId),
    queryFn: async () =>
      (
        await notebookDataClient.list<{ id: string; identifier: string }>(
          'records',
          `?id=eq.${encodeURIComponent(defaultExperimentId ?? '')}&kind=eq.experiment&select=id,identifier&limit=1`,
        )
      ).at(0) ?? null,
  })
  const target = picked
    ? { id: picked.id, identifier: picked.identifier }
    : (handed.data ?? null)
  const cite = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error(t('data.analysisPanel.chooseExperiment'))
      const record = await fetchRecord(notebookDataClient, target.id)
      const inserted = await insertBlock(notebookDataClient, {
        recordId: target.id,
        type: 'analysis',
        payload: { title: title.trim(), definitionId },
        expectedStructureVersion: record?.structureVersion,
      })
      await freezeAnalysisBlock(notebookDataClient, {
        blockId: inserted.block.id,
        expectedVersion: inserted.block.version,
      })
      return target
    },
    onSuccess: (experiment) => onCited(experiment),
    onError: (error: unknown) =>
      toast(t('data.analysisPanel.couldCite'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.analysisPanel.databaseRefused'),
      }),
  })
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('data.analysisPanel.citeNotebook2')}
          description={t('data.analysisPanel.addsAnalysisExperimentS')}
        />
        <DialogBody>
          <label className="flex flex-col gap-1 text-label">
            <span className="font-medium text-fg">
              {t('data.analysisPanel.title')}
            </span>
            <Input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="min-h-[220px] rounded-md border border-border">
            <RecordPicker
              allowed={['Experiment']}
              exclude={[]}
              onPick={(items) => setPicked(items[0] ?? null)}
            />
          </div>
          {target ? (
            <span className="text-label text-fg-muted">
              {t('data.analysisPanel.citingInto', {
                identifier: target.identifier,
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
            disabled={cite.isPending || !title.trim() || !target}
            onClick={() => cite.mutate()}
          >
            {cite.isPending
              ? t('data.analysisPanel.citing')
              : t('data.analysisPanel.cite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
