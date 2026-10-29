import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
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
import { archiveDataset, restoreDataset } from '#/lib/dataset-product'
import { notebookDataClient } from '#/lib/notebook-data'

/**
 * Archive a dataset made by mistake, or restore an archived one. The revision
 * is read when the action is confirmed, so a stale page cannot archive over a
 * newer import; the server still refuses a dataset others depend on.
 */
export function DatasetArchive({
  datasetId,
  name,
  archived,
  canEdit,
  onDone,
  client = notebookDataClient,
  open: controlledOpen,
  onOpenChange,
}: {
  datasetId: string
  name: string
  archived: boolean
  canEdit: boolean
  onDone?: (archived: boolean) => void
  client?: typeof notebookDataClient
  /**
   * Controlled mode: the caller opens the dialog from its own menu, so no
   * button is rendered here.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [ownOpen, setOwnOpen] = useState(false)
  const controlled = controlledOpen !== undefined
  const open = controlled ? controlledOpen : ownOpen
  const setOpen = controlled ? (onOpenChange ?? (() => {})) : setOwnOpen
  const run = useMutation({
    mutationFn: async () => {
      const found = await client.list<{ revision: number | string }>(
        'datasets',
        `?id=eq.${encodeURIComponent(datasetId)}&select=revision`,
      )
      const expectedRevision = Number(found.at(0)?.revision ?? 0)
      return archived
        ? restoreDataset(client, { datasetId, expectedRevision })
        : archiveDataset(client, { datasetId, expectedRevision })
    },
    onSuccess: () => {
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['ui-port'] })
      toast(
        archived
          ? t('data.datasetArchive.datasetRestored')
          : t('data.datasetArchive.datasetArchived'),
      )
      onDone?.(!archived)
    },
  })

  if (!canEdit) return null
  return (
    <>
      {controlled ? null : (
        <Button onClick={() => setOpen(true)}>
          {archived
            ? t('data.datasetArchive.restoreDataset')
            : t('data.datasetArchive.archiveDataset')}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(480px,calc(100vw-32px))]">
          <DialogHeader
            title={
              archived
                ? t('data.datasetArchive.restoreTitle', { name })
                : t('data.datasetArchive.archiveTitle', { name })
            }
            description={
              archived
                ? t('data.datasetArchive.returnsDatasetsListRows')
                : t('data.datasetArchive.leavesDatasetsListBut')
            }
          />
          <DialogBody>
            {run.isError ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {run.error instanceof Error
                  ? run.error.message
                  : archived
                    ? t('data.datasetArchive.couldRestore')
                    : t('data.datasetArchive.couldArchive')}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending
                ? t('common.states.saving')
                : archived
                  ? t('common.actions.restore')
                  : t('common.actions.archive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
