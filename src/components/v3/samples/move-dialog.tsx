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
        <DialogHeader title={`Move ${sample.identifier}`} />
        <DialogBody>
          {sample.storageLocation ? null : (
            <Notice icon="info">
              {sample.identifier} has no location yet, so there is nothing to
              move. Use Receive stock… on the sample to put it somewhere first.
            </Notice>
          )}
          <Field
            label="New location"
            required
            error={
              unchanged
                ? `${sample.identifier} is already at ${sample.storageLocation}.`
                : undefined
            }
            hint={
              sample.storageLocation
                ? `Now at ${sample.storageLocation}. Pick a place already in use or type a new one.`
                : 'Pick a place already in use or type a new one.'
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
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || !target || unchanged || !sample.storageLocation}
            onClick={() => onSubmit(target)}
          >
            {busy ? 'Moving…' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
