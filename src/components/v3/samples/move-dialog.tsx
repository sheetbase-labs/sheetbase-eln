import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { PositionPicker } from '#/components/v3/samples/position-picker'
import { Button } from '#/components/v3/ui/button'
import { Skeleton } from '#/components/v3/ui/skeleton'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import { describePlace, fetchSamplePosition } from '#/lib/storage-positions'
import type { PlaceChoice } from '#/lib/storage-positions'

/**
 * Move a sample, or put it in storage for the first time: where it is now, and
 * a free position in a box to put it in. A place that isn't in the storage
 * setup can still be typed. A move to where the sample already is would change
 * nothing, so it is held with the reason rather than sent for the server to
 * refuse.
 */
export function MoveSampleDialog({
  open,
  onOpenChange,
  sample,
  busy,
  onSubmit,
  locations,
  canManageStorage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sample: { id: string; identifier: string; storageLocation: string | null }
  busy: boolean
  onSubmit: (choice: PlaceChoice) => void
  /** Supplied when the page already holds the typed places; else they are fetched. */
  locations?: readonly string[]
  canManageStorage?: boolean
}) {
  const [choice, setChoice] = useState<PlaceChoice | null>(null)
  const current = useQuery({
    queryKey: ['storage-positions', 'sample', sample.id],
    queryFn: () => fetchSamplePosition(notebookDataClient, sample.id),
    enabled: open,
    retry: false,
  })
  const target = describePlace(choice)
  const unchanged =
    choice?.kind === 'text' &&
    Boolean(target) &&
    target.toLowerCase() === (sample.storageLocation ?? '').trim().toLowerCase()
  const ready = Boolean(target) && !unchanged
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <DialogHeader
          title={
            sample.storageLocation
              ? t('library.samples.moveDialog.move', {
                  identifier: sample.identifier,
                })
              : t('library.samples.moveDialog.place', {
                  identifier: sample.identifier,
                })
          }
          description={
            sample.storageLocation
              ? t('library.samples.moveDialog.nowAt', {
                  storageLocation: sample.storageLocation,
                })
              : t('library.samples.moveDialog.notInStorage')
          }
        />
        <DialogBody>
          {current.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <PositionPicker
              value={choice}
              onChange={setChoice}
              currentPositionId={current.data?.id ?? null}
              currentBoxId={current.data?.boxId ?? null}
              canManageStorage={canManageStorage}
              textLocations={locations}
            />
          )}
          {unchanged ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {t('library.samples.moveDialog.alreadyAt', {
                identifier: sample.identifier,
                storageLocation: sample.storageLocation ?? '',
              })}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={busy || !ready}
            onClick={() => choice && onSubmit(choice)}
          >
            {busy
              ? t('library.samples.moveDialog.moving')
              : sample.storageLocation
                ? t('library.samples.moveDialog.move2')
                : t('library.samples.moveDialog.put')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
