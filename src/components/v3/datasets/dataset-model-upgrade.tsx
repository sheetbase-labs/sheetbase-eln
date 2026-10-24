import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
import { Select } from '#/components/v3/ui/select'
import { toast } from '#/components/v3/ui/sonner'
import {
  applyDatasetModelUpgrade,
  describeUpgradeEffects,
  fetchDatasetModelPosition,
  previewDatasetModelUpgrade,
} from '#/lib/dataset-model-upgrade'
import { notebookDataClient } from '#/lib/notebook-data'

export const datasetModelPositionKey = (datasetId: string) =>
  ['ui-port', 'dataset-model-position', datasetId] as const

/**
 * Offers the move to a newer published version of the dataset's model, and
 * shows what the move changes before anything is written. Renders nothing when
 * the dataset is already on the newest version or the viewer cannot edit.
 */
export function DatasetModelUpgrade({
  datasetId,
  canEdit,
  client = notebookDataClient,
}: {
  datasetId: string
  canEdit: boolean
  client?: typeof notebookDataClient
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState('')
  const position = useQuery({
    queryKey: datasetModelPositionKey(datasetId),
    queryFn: () => fetchDatasetModelPosition(client, datasetId),
    staleTime: 30_000,
  })
  const newer = position.data?.newer ?? []
  const target = chosen || newer.at(-1)?.id || ''
  const preview = useQuery({
    queryKey: ['ui-port', 'dataset-model-preview', datasetId, target],
    queryFn: () => previewDatasetModelUpgrade(client, datasetId, target),
    enabled: open && Boolean(target),
  })
  const apply = useMutation({
    mutationFn: () =>
      applyDatasetModelUpgrade(client, {
        datasetId,
        targetVersionId: target,
        expectedRevision: position.data?.datasetRevision ?? 0,
      }),
    onSuccess: (result) => {
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['ui-port'] })
      void queryClient.invalidateQueries({ queryKey: ['dataset-explorer'] })
      toast(`Dataset now follows schema v${result.toVersion}`)
    },
  })

  if (!canEdit || !position.data || newer.length === 0) return null
  const latest = newer.at(-1)!
  const data = preview.data

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        Schema v{latest.version} available
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          <DialogHeader
            title="Upgrade to a newer Dataset schema version"
            description={`This dataset follows schema v${position.data.currentVersion}. Review the change before it is applied.`}
          />
          <DialogBody>
            <div className="flex flex-col gap-3">
              {newer.length > 1 ? (
                <label className="flex flex-col gap-1 text-label">
                  Move to
                  <Select
                    value={target}
                    onChange={(event) => setChosen(event.target.value)}
                  >
                    {newer.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.version}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
              {preview.isLoading ? (
                <p className="m-0 text-label text-fg-muted">
                  Checking what changes…
                </p>
              ) : null}
              {preview.isError ? (
                <Banner tone="bad" title="Could not preview the upgrade">
                  Reload the page, or ask an admin if it keeps happening.
                </Banner>
              ) : null}
              {data?.blocked ? (
                <Banner tone="warn" title="This version cannot be applied yet">
                  {data.reason}
                  {data.semanticChanges.length ? (
                    <p className="mb-0 mt-2">
                      Affected fields:{' '}
                      {data.semanticChanges
                        .map((field) => field.label)
                        .join(', ')}
                      .
                    </p>
                  ) : null}
                </Banner>
              ) : null}
              {data && !data.blocked ? (
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-label">
                  {describeUpgradeEffects(data).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              {apply.isError ? (
                <p role="alert" className="m-0 text-label text-danger-text">
                  {apply.error instanceof Error
                    ? apply.error.message
                    : 'Could not upgrade the dataset.'}
                </p>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
            <Button
              variant="primary"
              disabled={!data || data.blocked || apply.isPending}
              onClick={() => apply.mutate()}
            >
              {apply.isPending
                ? 'Upgrading…'
                : `Upgrade to v${data?.toVersion ?? latest.version}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
