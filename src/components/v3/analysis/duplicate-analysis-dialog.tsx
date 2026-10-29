import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { datasetOption } from '#/components/v3/record-picker/entity-options'
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { toast } from '#/components/v3/ui/sonner'
import { rebindSpec } from '#/lib/analysis-rebind'
import {
  analysisStudioDataClient,
  captureSourceRevisions,
  createAnalysisView,
  fetchDatasetSummaries,
} from '#/lib/analysis-studio-data'
import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
import { specSourceDatasetId } from '#/lib/analysis-spec-source'
import { fetchCanonicalDataset } from '#/lib/chart-data'
import { objectPath } from '#/lib/navigation'

/**
 * Run a saved analysis on other data. The copy keeps the chart, filters and
 * transformations, points them at the chosen dataset, and is saved as its own
 * analysis; the original is untouched. Columns are matched by identity, then by
 * name and type, and the preview lists the match. If a bound column has no
 * counterpart the copy is refused and the missing column is named.
 */
export function DuplicateAnalysisDialog({
  view,
  workspaceId,
  userId,
  open,
  onOpenChange,
  client = analysisStudioDataClient,
}: {
  view: AnalysisViewWire
  workspaceId: string
  userId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  client?: typeof analysisStudioDataClient
}) {
  const navigate = useNavigate()
  const sourceId = specSourceDatasetId(view.charts[0])
  const [targetId, setTargetId] = useState('')
  const [name, setName] = useState('')
  const datasets = useQuery({
    queryKey: ['ui-port', 'analysis-duplicate', 'datasets'],
    queryFn: () => fetchDatasetSummaries(client),
    enabled: open,
  })
  const options = (datasets.data ?? []).filter((d) => d.id !== sourceId)
  const source = useQuery({
    queryKey: ['ui-port', 'analysis-duplicate', 'source', sourceId],
    queryFn: () => fetchCanonicalDataset(client, sourceId ?? ''),
    enabled: open && Boolean(sourceId),
  })
  const target = useQuery({
    queryKey: ['ui-port', 'analysis-duplicate', 'target', targetId],
    queryFn: () => fetchCanonicalDataset(client, targetId),
    enabled: open && Boolean(targetId),
  })
  const rebound = useMemo(
    () =>
      source.data && target.data
        ? rebindSpec(view.charts[0], source.data.columns, {
            datasetId: target.data.datasetId,
            columns: target.data.columns,
          })
        : null,
    [view.charts[0], source.data, target.data],
  )
  const save = useMutation({
    mutationFn: async () => {
      if (!rebound?.spec || !target.data)
        throw new Error(t('data.duplicateAnalysisDialog.nothingSave'))
      return createAnalysisView(
        client,
        {
          name: name.trim() || `${view.name} on ${target.data.name}`,
          charts: [rebound.spec],
          source_revisions: captureSourceRevisions([target.data], rebound.spec),
          export_settings: view.export_settings,
        },
        workspaceId,
        userId,
      )
    },
    onSuccess: (created) => {
      onOpenChange(false)
      toast(t('data.duplicateAnalysisDialog.analysisCopiedOntoNew'))
      const to = objectPath('analysis', created.id)
      if (to) void navigate({ to } as never)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('data.duplicateAnalysisDialog.runAnalysisOtherData')}
          description={t(
            'data.duplicateAnalysisDialog.savesCopyPointedAnother',
          )}
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Field label="Dataset">
              <PickerSelect
                noun="dataset"
                value={targetId}
                onChange={(id) => {
                  setTargetId(id)
                  setName('')
                }}
                options={options.map((d) =>
                  datasetOption({ id: d.id, name: d.name }),
                )}
              />
            </Field>
            {target.isLoading || source.isLoading ? (
              <p className="m-0 text-label text-fg-muted">
                {t('data.duplicateAnalysisDialog.matchingColumns')}
              </p>
            ) : null}
            {rebound && rebound.spec ? (
              <>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-label">
                  {rebound.matches.map((m) => (
                    <li key={m.fromFieldId}>
                      {m.fromLabel}
                      {m.by === 'label'
                        ? ` → ${m.toLabel}`
                        : t('data.duplicateAnalysisDialog.sameColumn')}
                    </li>
                  ))}
                </ul>
                <Field label={t('data.duplicateAnalysisDialog.name')}>
                  <Input
                    value={name}
                    placeholder={`${view.name} on ${target.data?.name ?? ''}`}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
              </>
            ) : null}
            {rebound && !rebound.spec ? (
              <Banner
                tone="warn"
                title={t(
                  'data.duplicateAnalysisDialog.datasetCannotTakeAnalysis',
                )}
              >
                {t('data.duplicateAnalysisDialog.hasColumnMatchingChoose', {
                  join: rebound.unmatched.join(', '),
                })}
              </Banner>
            ) : null}
            {save.isError ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {save.error instanceof Error
                  ? save.error.message
                  : t('data.duplicateAnalysisDialog.couldSaveCopy')}
              </p>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!rebound?.spec || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('common.states.saving')
              : t('data.duplicateAnalysisDialog.saveCopy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
