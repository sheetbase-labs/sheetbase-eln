import { t } from '#/copy'
import type { PlaceChoice } from '#/lib/storage-positions'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

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
import { PlaceField } from '#/components/v3/samples/place-field'
import type { SampleRecord } from '#/lib/samples'
import { parseQuantityInput } from '#/components/v3/samples/withdraw-dialog'
import { PickerMultiSelect } from '#/components/v3/record-picker/entity-picker'
import type { PickerOption } from '#/components/v3/record-picker/entity-picker'
import {
  recordOption,
  recordSearch,
} from '#/components/v3/record-picker/entity-options'
import { listByIds } from '#/lib/chunk-ids'
import { notebookDataClient } from '#/lib/notebook-data'

/**
 * Editors for the sample writes that had no screen: details (`edit_sample`),
 * hold limits and the allowed-experiment exception (also `edit_sample`), and
 * stock receipt (`receive_sample`). Each calls back with a plain value object;
 * the sample route owns the mutation, version check and error toast.
 */

const searchExperiments = recordSearch(['Experiment'])

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
        <DialogHeader
          title={t('library.samples.sampleEditDialogs.edit', {
            identifier: sample.identifier,
          })}
        />
        <DialogBody>
          <Field label={t('library.samples.sampleEditDialogs.name')} required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('library.samples.sampleEditDialogs.notes')}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field
            label={t('library.samples.sampleEditDialogs.tags')}
            hint={t('library.samples.sampleEditDialogs.separateTagsWithCommas')}
          >
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field
            label={t('library.samples.sampleEditDialogs.reasonForTheChange')}
            hint={t(
              'library.samples.sampleEditDialogs.recordedInTheSampleHistory',
            )}
            required
          >
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
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
            {t('common.actions.saveChanges')}
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
  // Names for the experiments already allowed, and for the ones just chosen.
  const [picked, setPicked] = useState<Map<string, PickerOption>>(new Map())
  const stored = useQuery({
    queryKey: ['ui-port', 'sample-hold', 'allowed', sample.id],
    enabled: (sample.allowedUseExperimentIds ?? []).length > 0,
    staleTime: 60_000,
    queryFn: () =>
      listByIds(sample.allowedUseExperimentIds ?? [], (ids) =>
        notebookDataClient.list<{
          id: string
          identifier: string
          title: string
        }>('records', `?id=in.(${ids})&select=id,identifier,title`),
      ),
  })
  const known = new Map<string, PickerOption>([
    ...(stored.data ?? []).map((r) => [r.id, recordOption(r)] as const),
    ...picked,
  ])
  const parsedDays = days.trim() === '' ? null : parseQuantityInput(days)
  const daysInvalid =
    days.trim() !== '' &&
    (parsedDays == null || parsedDays <= 0 || !Number.isInteger(parsedDays))
  const valid = reason.trim() !== '' && !daysInvalid
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.samples.sampleEditDialogs.holdLimitFor', {
            identifier: sample.identifier,
          })}
        />
        <DialogBody>
          <Field
            label={t('library.samples.sampleEditDialogs.storageCondition')}
          >
            <Input
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('library.samples.sampleEditDialogs.holdStarted')}>
              <Input
                type="date"
                value={started}
                onChange={(e) => setStarted(e.target.value)}
              />
            </Field>
            <Field
              label={t('library.samples.sampleEditDialogs.holdLimitDays')}
              error={
                daysInvalid
                  ? t('library.samples.sampleEditDialogs.enterAWholeNumberOf')
                  : undefined
              }
            >
              <Input
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
          </div>
          <Field
            label={t('library.samples.sampleEditDialogs.holdUntil')}
            hint={t('library.samples.sampleEditDialogs.toExtendAHoldThat')}
          >
            <Input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </Field>
          <Field
            label={t(
              'library.samples.sampleEditDialogs.experimentsAllowedToUseThis',
            )}
          >
            <PickerMultiSelect
              noun="experiment"
              values={allowed}
              selected={[...known.values()]}
              search={searchExperiments}
              onChange={(ids, options) => {
                setAllowed(ids)
                setPicked(
                  (p) =>
                    new Map([...p, ...options.map((o) => [o.id, o] as const)]),
                )
              }}
              placeholder={t('library.samples.sampleEditDialogs.placeholder')}
            />
          </Field>
          <Field
            label={t('library.samples.sampleEditDialogs.reasonForTheChange')}
            hint={t(
              'library.samples.sampleEditDialogs.recordedInTheSampleHistory2',
            )}
            required
          >
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
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
            {t('library.samples.sampleEditDialogs.saveHold')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface ReceiveValue {
  quantity: number
  /** Where the new stock goes; left out to keep the sample where it is. */
  place?: PlaceChoice
  notes?: string
}

export function ReceiveStockDialog({
  sample,
  busy,
  canManageStorage,
  onClose,
  onSubmit,
}: {
  sample: SampleRecord
  busy: boolean
  canManageStorage?: boolean
  onClose: () => void
  onSubmit: (value: ReceiveValue) => void
}) {
  const [quantity, setQuantity] = useState('')
  const [place, setPlace] = useState<PlaceChoice | null>(null)
  const [notes, setNotes] = useState('')
  const parsed = parseQuantityInput(quantity)
  const invalid = quantity.trim() !== '' && (parsed == null || parsed <= 0)
  const unit = sample.quantityUnit ?? ''
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.samples.sampleEditDialogs.receiveStockInto', {
            identifier: sample.identifier,
          })}
        />
        <DialogBody>
          <Field
            label={
              unit
                ? t('library.samples.sampleEditDialogs.quantityReceived', {
                    unit,
                  })
                : t('library.samples.sampleEditDialogs.quantityReceived2')
            }
            error={
              invalid
                ? t('library.samples.sampleEditDialogs.enterAnAmountAboveZero')
                : undefined
            }
            required
          >
            <Input
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
            />
          </Field>
          <div className="flex flex-col gap-1 text-label">
            <span className="font-medium text-fg">
              {t('library.samples.sampleEditDialogs.location')}
            </span>
            <PlaceField
              value={place}
              onChange={setPlace}
              title={t('library.samples.placeField.pickerTitle', {
                identifier: sample.identifier,
              })}
              canManageStorage={canManageStorage}
            />
            <span className="text-fg-muted">
              {t('library.samples.sampleEditDialogs.leaveBlankToKeep', {
                storageLocation:
                  sample.storageLocation ??
                  t('library.samples.sampleEditDialogs.theCurrentLocation'),
              })}
            </span>
          </div>
          <Field label={t('library.samples.sampleEditDialogs.notes')}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={busy || parsed == null || parsed <= 0}
            onClick={() =>
              parsed != null &&
              onSubmit({
                quantity: parsed,
                place: place ?? undefined,
                notes: notes.trim() || undefined,
              })
            }
          >
            {t('library.samples.sampleEditDialogs.receive')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
