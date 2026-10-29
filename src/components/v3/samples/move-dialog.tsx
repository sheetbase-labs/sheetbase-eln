import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field } from '#/components/v3/ui/input'
import { LocationInput } from '#/components/v3/samples/location-field'
import { t } from '#/copy'

/**
 * Move a sample: where it is now, and a place to put it. The place can be one
 * already in use (suggested from where samples sit) or a new one. A move to
 * where the sample already is would change nothing, so it is held with the
 * reason rather than sent for the server to refuse.
 */
export function MoveSampleDialog({
  open,
  onOpenChange,
  sample,
  busy,
  onSubmit,
  locations,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sample: { identifier: string; storageLocation: string | null }
  busy: boolean
  onSubmit: (toLocation: string) => void
  /** Supplied when the page already holds the locations; else they are fetched. */
  locations?: readonly string[]
}) {
  const [value, setValue] = useState('')
  const target = value.trim()
  const unchanged =
    Boolean(target) &&
    target.toLowerCase() === (sample.storageLocation ?? '').trim().toLowerCase()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.samples.moveDialog.move', {
            identifier: sample.identifier,
          })}
        />
        <DialogBody>
          {sample.storageLocation ? null : (
            <Notice icon="info">
              {t('library.samples.moveDialog.hasNoLocationYetSo', {
                identifier: sample.identifier,
              })}
            </Notice>
          )}
          <Field
            label={t('library.samples.moveDialog.newLocation')}
            required
            error={
              unchanged
                ? `${sample.identifier} is already at ${sample.storageLocation}.`
                : undefined
            }
            hint={
              sample.storageLocation
                ? t('library.samples.moveDialog.nowAtPickAPlace', {
                    storageLocation: sample.storageLocation,
                  })
                : t('library.samples.moveDialog.pickAPlaceAlreadyIn')
            }
          >
            <LocationInput
              value={value}
              onChange={setValue}
              locations={locations}
              autoFocus
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={busy || !target || unchanged || !sample.storageLocation}
            onClick={() => onSubmit(target)}
          >
            {busy
              ? t('library.samples.moveDialog.moving')
              : t('library.samples.moveDialog.move2')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
