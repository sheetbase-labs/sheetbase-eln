import { useState } from 'react'

import { PositionPicker } from '#/components/v3/samples/position-picker'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { t } from '#/copy'
import { describePlace } from '#/lib/storage-positions'
import type { PlaceChoice } from '#/lib/storage-positions'

/**
 * A place for a sample inside a form: it reads as the chosen position (or the
 * typed place) with a button that opens the box picker. Forms that are already
 * crowded use this instead of carrying the whole picker.
 */
export function PlaceField({
  value,
  onChange,
  title,
  canManageStorage,
  textLocations,
}: {
  value: PlaceChoice | null
  onChange: (choice: PlaceChoice | null) => void
  /** The picker's heading, for example "Where should SMP-12 go?". */
  title: string
  canManageStorage?: boolean
  textLocations?: readonly string[]
}) {
  const [open, setOpen] = useState(false)
  const label = describePlace(value)
  return (
    <div className="flex items-center gap-2">
      <div
        className="min-h-[30px] min-w-0 flex-1 truncate rounded-md border border-border bg-surface-muted px-2 py-[5px] text-body"
        title={label || undefined}
      >
        {label || (
          <span className="text-fg-faint">
            {t('library.samples.placeField.none')}
          </span>
        )}
      </div>
      <Button size="sm" onClick={() => setOpen(true)}>
        {label
          ? t('library.samples.placeField.change')
          : t('library.samples.placeField.choose')}
      </Button>
      {label ? (
        <Button size="sm" variant="quiet" onClick={() => onChange(null)}>
          {t('library.samples.placeField.clear')}
        </Button>
      ) : null}
      {open ? (
        <PlaceDialog
          title={title}
          initial={value}
          canManageStorage={canManageStorage}
          textLocations={textLocations}
          onClose={() => setOpen(false)}
          onDone={(choice) => {
            onChange(choice)
            setOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function PlaceDialog({
  title,
  initial,
  canManageStorage,
  textLocations,
  onClose,
  onDone,
}: {
  title: string
  initial: PlaceChoice | null
  canManageStorage?: boolean
  textLocations?: readonly string[]
  onClose: () => void
  onDone: (choice: PlaceChoice) => void
}) {
  const [choice, setChoice] = useState<PlaceChoice | null>(initial)
  const ready = Boolean(describePlace(choice))
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <DialogHeader title={title} />
        <DialogBody>
          <PositionPicker
            value={choice}
            onChange={setChoice}
            canManageStorage={canManageStorage}
            textLocations={textLocations}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => choice && onDone(choice)}
          >
            {t('library.samples.placeField.use')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
