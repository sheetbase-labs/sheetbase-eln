import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import type { SampleRecord } from '#/lib/samples'
import {
  parseQuantityInput,
  useExperimentOptions,
} from '#/components/v3/samples/withdraw-dialog'

/**
 * Editors for the sample writes that had no screen: details (`edit_sample`),
 * hold limits and the allowed-experiment exception (also `edit_sample`), and
 * stock receipt (`receive_sample`). Each calls back with a plain value object;
 * the sample route owns the mutation, version check and error toast.
 */

const dayInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '')
const dayToIso = (day: string): string | undefined =>
  day ? `${day}T00:00:00.000Z` : undefined

export interface EditDetailsValue {
  title: string
  notes: string
  tags: string[]
  reason: string
}

export function EditDetailsDialog({
  sample,
  busy,
  onClose,
  onSubmit,
}: {
  sample: SampleRecord
  busy: boolean
  onClose: () => void
  onSubmit: (value: EditDetailsValue) => void
}) {
  const [title, setTitle] = useState(sample.title)
  const [notes, setNotes] = useState(sample.notes ?? '')
  const [tags, setTags] = useState(sample.tags.join(', '))
  const [reason, setReason] = useState('')
  const valid = title.trim() !== '' && reason.trim() !== ''
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogHeader title={`Edit ${sample.identifier}`} />
        <DialogBody>
          <Field label="Name" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Tags" hint="Separate tags with commas.">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field
            label="Reason for the change"
            hint="Recorded in the sample history. Volume and location change through Withdraw, Receive and Move."
            required
          >
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || !valid}
            onClick={() =>
              onSubmit({
                title: title.trim(),
                notes: notes.trim(),
                tags: tags
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
                reason: reason.trim(),
              })
            }
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface EditHoldValue {
  holdCondition?: string
  holdStartedAt?: string
  holdDurationDays?: number
  holdUntil?: string
  allowedUseExperimentIds: string[]
  reason: string
}

export function EditHoldDialog({
  sample,
  busy,
  onClose,
  onSubmit,
}: {
  sample: SampleRecord
  busy: boolean
  onClose: () => void
  onSubmit: (value: EditHoldValue) => void
}) {
  const [condition, setCondition] = useState(sample.holdCondition ?? '')
  const [started, setStarted] = useState(dayInput(sample.holdStartedAt))
  const [days, setDays] = useState(
    sample.holdDurationDays != null ? String(sample.holdDurationDays) : '',
  )
  const [until, setUntil] = useState(dayInput(sample.holdUntil))
  const [allowed, setAllowed] = useState<string[]>(
    sample.allowedUseExperimentIds ?? [],
  )
  const [reason, setReason] = useState('')
  const experiments = useExperimentOptions()
  const parsedDays = days.trim() === '' ? null : parseQuantityInput(days)
  const daysInvalid =
    days.trim() !== '' &&
    (parsedDays == null || parsedDays <= 0 || !Number.isInteger(parsedDays))
  const valid = reason.trim() !== '' && !daysInvalid
  const toggle = (id: string, on: boolean) =>
    setAllowed((current) =>
      on ? [...current, id] : current.filter((value) => value !== id),
    )
  // An allowed id outside the 100 newest experiments still has to stay listed.
  const listed = new Set((experiments.data ?? []).map((option) => option.id))
  const orphaned = allowed.filter((id) => !listed.has(id))
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader title={`Hold limit for ${sample.identifier}`} />
        <DialogBody>
          <Field label="Storage condition">
            <Input
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hold started">
              <Input
                type="date"
                value={started}
                onChange={(e) => setStarted(e.target.value)}
              />
            </Field>
            <Field
              label="Hold limit (days)"
              error={daysInvalid ? 'Enter a whole number of days.' : undefined}
            >
              <Input
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Hold until"
            hint="To extend a hold that has passed, set a later date, then release the sample to re-qualify it."
          >
            <Input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </Field>
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="p-0 text-label font-medium text-fg">
              Experiments allowed to use this sample after the hold
            </legend>
            {experiments.data?.length || orphaned.length ? (
              <div className="flex max-h-[160px] flex-col gap-1 overflow-auto">
                {orphaned.map((id) => (
                  <label key={id} className="flex items-center gap-2 text-body">
                    <Checkbox
                      checked
                      onCheckedChange={() => toggle(id, false)}
                    />
                    <span className="text-fg-muted">Other experiment</span>
                  </label>
                ))}
                {(experiments.data ?? []).map((option) => (
                  <label
                    key={option.id}
                    className="flex items-center gap-2 text-body"
                  >
                    <Checkbox
                      checked={allowed.includes(option.id)}
                      onCheckedChange={(checked) =>
                        toggle(option.id, checked === true)
                      }
                    />
                    <span>
                      {option.identifier} · {option.title}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="m-0 text-label text-fg-muted">
                No experiments to choose from yet.
              </p>
            )}
          </fieldset>
          <Field
            label="Reason for the change"
            hint="Recorded in the sample history."
            required
          >
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || !valid}
            onClick={() =>
              onSubmit({
                holdCondition: condition.trim() || undefined,
                holdStartedAt: dayToIso(started),
                holdDurationDays: parsedDays ?? undefined,
                holdUntil: dayToIso(until),
                allowedUseExperimentIds: allowed,
                reason: reason.trim(),
              })
            }
          >
            Save hold
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface ReceiveValue {
  quantity: number
  location?: string
  notes?: string
}

export function ReceiveStockDialog({
  sample,
  busy,
  onClose,
  onSubmit,
}: {
  sample: SampleRecord
  busy: boolean
  onClose: () => void
  onSubmit: (value: ReceiveValue) => void
}) {
  const [quantity, setQuantity] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const parsed = parseQuantityInput(quantity)
  const invalid = quantity.trim() !== '' && (parsed == null || parsed <= 0)
  const unit = sample.quantityUnit ?? ''
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader title={`Receive stock into ${sample.identifier}`} />
        <DialogBody>
          <Field
            label={unit ? `Quantity received (${unit})` : 'Quantity received'}
            error={invalid ? 'Enter an amount above zero.' : undefined}
            required
          >
            <Input
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
            />
          </Field>
          <Field
            label="Location"
            hint={`Leave blank to keep ${sample.storageLocation ?? 'the current location'}.`}
          >
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || parsed == null || parsed <= 0}
            onClick={() =>
              parsed != null &&
              onSubmit({
                quantity: parsed,
                location: location.trim() || undefined,
                notes: notes.trim() || undefined,
              })
            }
          >
            Receive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
