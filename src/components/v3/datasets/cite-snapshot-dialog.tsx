import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { RecordPicker } from '#/components/v3/record-picker/record-picker'
import type { PickerItem } from '#/components/v3/record-picker/record-picker-data'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import {
  citeSnapshotInNotebook,
  snapshotCitationLabel,
} from '#/lib/dataset-snapshot-cite'
import { notebookDataClient } from '#/lib/notebook-data'
import type { SnapshotVersion } from './snapshot-data'

/**
 * Put a snapshot into an experiment's notebook: pick the experiment, and the
 * notebook gets a reference to this exact snapshot. The toast opens it.
 */
export function CiteSnapshotDialog({
  datasetId,
  snapshot,
  onClose,
}: {
  datasetId: string
  snapshot: SnapshotVersion
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [target, setTarget] = useState<PickerItem | null>(null)
  const [citing, setCiting] = useState(false)
  const dataset = useQuery({
    queryKey: ['ui-port', 'dataset-cite-identity', datasetId],
    queryFn: async () =>
      (
        await notebookDataClient.list<{
          id: string
          name: string
          display_id: string | null
        }>(
          'datasets',
          `?id=eq.${encodeURIComponent(datasetId)}&select=id,name,display_id&limit=1`,
        )
      ).at(0) ?? null,
  })

  async function cite() {
    if (!target || !dataset.data) return
    setCiting(true)
    try {
      await citeSnapshotInNotebook(notebookDataClient, {
        recordId: target.id,
        datasetId,
        datasetIdentifier: dataset.data.display_id || dataset.data.name,
        datasetName: dataset.data.name,
        versionId: snapshot.id,
        versionLabel: snapshot.label,
        contentHash: snapshot.contentHash,
      })
      toast(t('data.citeSnapshotDialog.citedNotebook'), {
        description: t('data.citeSnapshotDialog.nowReferences', {
          identifier: target.identifier,
          value: snapshotCitationLabel({
            datasetName: dataset.data.name,
            versionLabel: snapshot.label,
          }),
        }),
        action: {
          label: t('data.citeSnapshotDialog.openNotebook'),
          onClick: () =>
            void navigate({
              to: '/experiments/$expId/notebook',
              params: { expId: target.id },
            }),
        },
      })
      onClose()
    } catch (error) {
      toast(t('data.citeSnapshotDialog.couldCite'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.citeSnapshotDialog.notebookDidAcceptReference'),
      })
    } finally {
      setCiting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('data.citeSnapshotDialog.citeSnapshotNotebook')}
          description={t('data.citeSnapshotDialog.addsReferenceExperimentS', {
            label: snapshot.label,
          })}
        />
        <DialogBody>
          <div className="min-h-[220px] rounded-md border border-border">
            <RecordPicker
              allowed={['Experiment']}
              exclude={[]}
              onPick={(items) => setTarget(items[0] ?? null)}
            />
          </div>
          {target ? (
            <span className="text-label text-fg-muted">
              {t('data.citeSnapshotDialog.citingInto', {
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
            disabled={citing || !target || !dataset.data}
            onClick={() => void cite()}
          >
            {citing
              ? t('data.citeSnapshotDialog.citing')
              : t('data.citeSnapshotDialog.cite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
