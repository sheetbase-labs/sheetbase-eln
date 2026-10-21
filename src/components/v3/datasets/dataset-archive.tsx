import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

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
}: {
  datasetId: string
  name: string
  archived: boolean
  canEdit: boolean
  onDone?: (archived: boolean) => void
  client?: typeof notebookDataClient
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
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
      toast(archived ? 'Dataset restored' : 'Dataset archived')
      onDone?.(!archived)
    },
  })

  if (!canEdit) return null
  const verb = archived ? 'Restore' : 'Archive'
  return (
    <>
      <Button onClick={() => setOpen(true)}>{verb} dataset…</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(480px,calc(100vw-32px))]">
          <DialogHeader
            title={`${verb} ${name}`}
            description={
              archived
                ? 'It returns to the Datasets list with its rows and snapshots.'
                : 'It leaves the Datasets list but keeps its rows and snapshots, and can be restored. A dataset that experiments or analyses depend on cannot be archived.'
            }
          />
          <DialogBody>
            {run.isError ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {run.error instanceof Error
                  ? run.error.message
                  : `Could not ${verb.toLowerCase()} the dataset.`}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
            <Button
              variant="primary"
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? 'Saving…' : verb}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
