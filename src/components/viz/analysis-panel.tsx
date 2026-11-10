import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { ExtensionAnalysisSection } from '#/components/viz/extension-analysis'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { RecordPicker } from '#/components/record-picker/record-picker'
import type { PickerItem } from '#/components/record-picker/record-picker-data'
import { toast } from '#/components/ui/sonner'
import { freezeAnalysisBlock } from '#/lib/analysis-definitions-data'
import type { AnalysisDefinitionWire } from '#/lib/analysis-definitions-data'
import type { DataClient } from '#/lib/data-client'
import { AnalysisExecutionResult } from './analysis-results'
import { useAnalysisSession } from './analysis-session'
import type { AnalysisPanelProps } from './analysis-session'
import { AnalysisEditor } from './analysis-editor'
import { SnapshotSourceBanner } from './snapshot-source-banner'
import {
  fetchRecord,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { insertBlock } from '#/lib/notebook-mutations'

export { AnalysisResultTable } from './analysis-results'

export type { AnalysisPanelProps } from './analysis-session'

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

export function AnalysisPanel(props: AnalysisPanelProps) {
  const model = useAnalysisSession(props)

  const {
    dataClient,
    experimentId,
    navigate,
    selectedDatasetId,
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
    execution,
    loadDefinition,
    deleteMutation,
    deleteTarget,
    setDeleteTarget,
    fitChart,
    curveCharts,
  } = model

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {snapshotId && selectedDatasetId ? (
        <SnapshotSourceBanner
          client={dataClient}
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
      <AnalysisEditor model={model} />

      <ExtensionAnalysisSection
        dataset={selectedDataset}
        rows={rowsQuery.data?.rows}
        flags={rowsQuery.data?.flags}
        truncated={rowsQuery.data?.truncated ?? false}
      />

      {curveCharts.map(({ group, chart }) => (
        <div key={group} className="rounded-md border p-2">
          <p className="mb-1 text-xs font-medium text-fg-muted">
            {group === 'all'
              ? t('data.analysisPanel.curveOverStandards')
              : t('data.analysisPanel.curveOverStandardsGroup', { group })}
          </p>
          <ChartRenderer
            title={t('data.analysisPanel.fitPreview')}
            hideTitle
            spec={chart.spec}
            materialised={chart.materialised}
            frozen={null}
            showTableAlternative={false}
            plotHeight={240}
          />
        </div>
      ))}

      <AnalysisExecutionResult error={rowsQuery.error} execution={execution} />

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
          client={dataClient}
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
              <Icon name="trash" className="size-3.5" aria-hidden />
            </Button>
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Cite a saved statistic in an experiment's notebook: an `analysis` block that
 * names the saved definition, frozen on the dataset version it ran against. The
 * experiment the studio was opened from is the first choice.
 */
function CiteDefinitionDialog({
  client = notebookDataClient,
  definitionId,
  defaultTitle,
  defaultExperimentId,
  onClose,
  onCited,
}: {
  client?: DataClient
  definitionId: string
  defaultTitle: string
  defaultExperimentId?: string
  onClose: () => void
  onCited: (experiment: { id: string; identifier: string }) => void
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(defaultTitle)
  const [picked, setPicked] = useState<PickerItem | null>(null)

  const handed = useQuery({
    queryKey: ['analysis-panel', 'cite-target', defaultExperimentId],
    enabled: Boolean(defaultExperimentId),
    queryFn: async () =>
      (
        await client.list<{ id: string; identifier: string }>(
          'records',
          `?id=eq.${encodeURIComponent(defaultExperimentId ?? '')}&kind=eq.experiment&select=id,identifier&limit=1`,
        )
      ).at(0) ?? null,
  })

  const target = picked
    ? { id: picked.id, identifier: picked.identifier }
    : (handed.data ?? null)

  const cite = useMutation({
    mutationFn: async (experiment: { id: string; identifier: string }) => {
      const record = await fetchRecord(client, experiment.id)

      const inserted = await insertBlock(client, {
        recordId: experiment.id,
        type: 'analysis',
        payload: { title: title.trim(), definitionId },
        expectedStructureVersion: record?.structureVersion,
      })

      await freezeAnalysisBlock(client, {
        blockId: inserted.block.id,
        expectedVersion: inserted.block.version,
      })

      return experiment
    },
    onSuccess: (experiment) => onCited(experiment),
    onSettled: (_result, _error, experiment) => {
      // Insertion may have succeeded even if freezing was refused. Refresh the
      // structure, its blocks and their activity in either outcome.
      void queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.record(experiment.id),
      })
      void queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.blocks(experiment.id),
      })
      void queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.activity(experiment.id),
      })
    },
    onError: (error) =>
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
            onClick={() => {
              if (target) cite.mutate(target)
            }}
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
