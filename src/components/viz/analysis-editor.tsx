import { PickerSelect } from '#/components/record-picker/entity-picker'
import { datasetOption } from '#/components/record-picker/entity-options'
import { Icon } from '#/components/icons'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { t } from '#/copy'
import { ANALYSIS_KINDS } from '#/lib/analysis-definition'
import { AnalysisDefinitionControls } from './analysis-controls'
import type { AnalysisPanelModel } from './analysis-session'

const KIND_LABELS = {
  descriptive: t('data.analysisPanel.descriptiveAnova'),
  curve: t('data.analysisPanel.doseResponseCurve'),
  comparison: t('data.analysisPanel.comparisonKind'),
  survival: t('data.analysisPanel.survivalKind'),
  regression: t('data.analysisPanel.regressionFit'),
}

export function AnalysisEditor({ model }: { model: AnalysisPanelModel }) {
  const {
    datasets,
    selectedDatasetId,
    selectDataset,
    onDatasetChange,
    draft,
    selectedDataset,
    startDraft,
    updateDefinition,
    runnable,
    rowsQuery,
    setDraft,
    validation,
    saveMutation,
    setCiteOpen,
    staleDetail,
  } = model

  return (
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
            onChange={selectDataset}
            placeholder={t('data.analysisPanel.selectDataset')}
            clearLabel={
              onDatasetChange
                ? undefined
                : t('data.analysisPanel.selectDataset')
            }
            options={datasets.map((dataset) =>
              datasetOption({ id: dataset.datasetId, name: dataset.name }),
            )}
            className="bg-surface"
          />
        </div>
        <div className="flex min-w-40 flex-1 flex-col gap-1">
          <label className="text-label text-fg-muted" htmlFor="analysis-kind">
            {t('data.analysisPanel.analysis')}
          </label>
          <div className="flex flex-wrap items-center gap-1">
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
                <Icon name="sigma" className="size-3.5" aria-hidden />
                {KIND_LABELS[kind]}
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
          <Icon name="save" className="size-3.5" aria-hidden />{' '}
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
  )
}
