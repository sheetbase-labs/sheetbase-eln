import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { DescriptionList } from '#/components/ui/layout'
import { ExperimentPicker } from '#/components/record-picker/experiment-picker'
import { Select } from '#/components/ui/select'
import { cn } from '#/lib/utils'
import { notebookDataClient } from '#/lib/notebook-data'
import type { SampleQuantityBalances } from '#/lib/samples'
import { t } from '#/copy'
import { formatQuantityAmount, parseQuantityInput } from './quantity-input'
import { useQuantityEntry, useSampleBalances } from './quantity-hooks'
import type { ExperimentOption } from './quantity-hooks'
import { QuantityFields } from './quantity-fields'

/**
 * LAB-01 step 3 — the withdraw dialog and its numeric keypad (DialogsRecord,
 * PhoneWithdraw), plus the reserve-for-an-experiment dialog and the small
 * actions context the Usage tab uses to open them.
 *
 * The dialogs call the canonical `api.withdraw_sample` /
 * `api.create_sample_reservation` wrappers through `src/lib/samples.tsx`; the
 * available amount comes from `api.sample_quantity_balances`, so a withdrawal
 * that would overdraw the free (current - reserved) balance is refused in the
 * dialog and again on the server. Nothing is written until the server RPC
 * succeeds.
 */

// ---------------------------------------------------------------------------
// Keypad.
// ---------------------------------------------------------------------------

const KEYPAD_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '.',
  '0',
  'backspace',
] as const

/** Numeric keypad (PhoneWithdraw): digits, one decimal point and backspace. */
export function QuantityKeypad({
  onKey,
  className,
}: {
  onKey: (key: string) => void
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={t('library.samples.withdrawDialog.numberPad')}
      className={cn('grid grid-cols-3 gap-1.5', className)}
    >
      {KEYPAD_KEYS.map((key) =>
        key === 'backspace' ? (
          <Button
            key={key}
            type="button"
            size="lg"
            aria-label={t('library.samples.withdrawDialog.backspace')}
            onClick={() => onKey('backspace')}
          >
            ⌫
          </Button>
        ) : (
          <Button
            key={key}
            type="button"
            size="lg"
            className="text-[18px]"
            onClick={() => onKey(key)}
          >
            {key}
          </Button>
        ),
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Withdraw dialog.
// ---------------------------------------------------------------------------

export interface WithdrawDialogInput {
  quantity: number
  unit?: string
  purposeExperimentId: string
  notes?: string
  /** When set, the server derives a linked container sample in the same tx. */
  newContainer?: { title?: string }
}

export interface WithdrawDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sample: {
    id: string
    identifier: string
    title: string
    quantity: number | null
    quantityUnit: string | null
  }
  busy: boolean
  onSubmit: (input: WithdrawDialogInput) => void
  /** Test/preview override; when omitted the dialog loads the workspace list. */
  experiments?: ExperimentOption[]
  /** Test/preview override; when omitted the dialog loads the balance. */
  balances?: SampleQuantityBalances | null
}

export function WithdrawDialog({
  open,
  onOpenChange,
  sample,
  busy,
  onSubmit,
  experiments: experimentsProp,
  balances: balancesProp,
}: WithdrawDialogProps) {
  const queriedBalances = useSampleBalances(
    sample.id,
    notebookDataClient,
    balancesProp === undefined,
  )

  const balances =
    balancesProp !== undefined ? balancesProp : (queriedBalances.data ?? null)

  const entry = useQuantityEntry(sample, balances)

  const { quantity, unit, free, validation, unitSuffix, onKey } = entry

  const [purpose, setPurpose] = useState('')
  const [into, setInto] = useState('keep')
  const [containerTitle, setContainerTitle] = useState('')
  const [notes, setNotes] = useState('')

  const blocked = busy || !validation.valid || purpose === ''

  const submit = () => {
    const value = parseQuantityInput(quantity)

    if (value == null || value <= 0 || purpose === '' || blocked) return
    onSubmit({
      quantity: value,
      unit: unit || undefined,
      purposeExperimentId: purpose,
      notes: notes.trim() || undefined,
      newContainer:
        into === 'new'
          ? { title: containerTitle.trim() || undefined }
          : undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.samples.withdrawDialog.withdrawVolume')}
          description={t('library.samples.withdrawDialog.available', {
            identifier: sample.identifier,
            title: sample.title,
            free: formatQuantityAmount(free),
            unitSuffix,
          })}
        />
        <DialogBody>
          <QuantityFields entry={entry} />

          <QuantityKeypad onKey={onKey} className="md:hidden" />

          <Field label={t('library.samples.withdrawDialog.purpose')} required>
            <ExperimentPicker
              value={purpose}
              onChange={setPurpose}
              experiments={experimentsProp}
              placeholder={t(
                'library.samples.withdrawDialog.selectAnExperiment',
              )}
            />
          </Field>

          <Field label={t('library.samples.withdrawDialog.into')}>
            <Select
              value={into}
              onChange={(event) => setInto(event.target.value)}
            >
              <option value="keep">
                {t('library.samples.withdrawDialog.keepInThisSample')}
              </option>
              <option value="new">
                {t('library.samples.withdrawDialog.newContainerPrintLabel')}
              </option>
            </Select>
          </Field>

          {into === 'new' ? (
            <Field
              label={t(
                'library.samples.withdrawDialog.newContainerLabelOptional',
              )}
            >
              <Input
                value={containerTitle}
                onChange={(event) => setContainerTitle(event.target.value)}
                placeholder={`${sample.title} from ${sample.identifier}`}
              />
            </Field>
          ) : null}

          <Field label={t('library.samples.withdrawDialog.notesOptional')}>
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>

          <DescriptionList
            labelWidth={120}
            items={[
              [
                t('library.samples.withdrawDialog.availableNow'),
                `${formatQuantityAmount(free)}${unitSuffix}`,
              ],
              [
                t('library.samples.withdrawDialog.reserved'),
                `${formatQuantityAmount(balances?.reserved ?? 0)}${unitSuffix}`,
              ],
              [
                t('library.samples.withdrawDialog.remainingAfter'),
                validation.remainingAfter == null ? (
                  '—'
                ) : (
                  <span
                    className={cn(
                      validation.remainingAfter < 0 && 'text-danger-text',
                    )}
                  >
                    {formatQuantityAmount(validation.remainingAfter)}
                    {unitSuffix}
                  </span>
                ),
              ],
            ]}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button variant="primary" disabled={blocked} onClick={submit}>
            {t('library.samples.withdrawDialog.withdraw')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Reserve dialog.
// ---------------------------------------------------------------------------

export interface ReserveDialogInput {
  experimentId: string
  quantity: number
  unit?: string
  planned: boolean
  notes?: string
}

export interface ReserveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sample: {
    id: string
    identifier: string
    title: string
    quantity: number | null
    quantityUnit: string | null
  }
  busy: boolean
  onSubmit: (input: ReserveDialogInput) => void
  experiments?: ExperimentOption[]
  balances?: SampleQuantityBalances | null
}

export function ReserveDialog({
  open,
  onOpenChange,
  sample,
  busy,
  onSubmit,
  experiments: experimentsProp,
  balances: balancesProp,
}: ReserveDialogProps) {
  const queriedBalances = useSampleBalances(
    sample.id,
    notebookDataClient,
    balancesProp === undefined,
  )

  const balances =
    balancesProp !== undefined ? balancesProp : (queriedBalances.data ?? null)

  const entry = useQuantityEntry(sample, balances, 'free')

  const { quantity, unit, free, validation, unitSuffix, onKey } = entry

  const [experiment, setExperiment] = useState('')
  const [planned, setPlanned] = useState(true)
  const [notes, setNotes] = useState('')

  const blocked = busy || !validation.valid || experiment === ''

  const submit = () => {
    const value = parseQuantityInput(quantity)

    if (value == null || value <= 0 || experiment === '' || blocked) return
    onSubmit({
      experimentId: experiment,
      quantity: value,
      unit: unit || undefined,
      planned,
      notes: notes.trim() || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.samples.withdrawDialog.reserveVolume')}
          description={t('library.samples.withdrawDialog.free', {
            identifier: sample.identifier,
            title: sample.title,
            free: formatQuantityAmount(free),
            unitSuffix,
          })}
        />
        <DialogBody>
          <QuantityFields entry={entry} reserve />

          <QuantityKeypad onKey={onKey} className="md:hidden" />

          <Field label={t('library.samples.withdrawDialog.for')} required>
            <ExperimentPicker
              value={experiment}
              onChange={setExperiment}
              experiments={experimentsProp}
              placeholder={t(
                'library.samples.withdrawDialog.selectAnExperiment',
              )}
            />
          </Field>

          <label className="flex items-center gap-2 text-label">
            <Checkbox
              checked={planned}
              onCheckedChange={(value) => setPlanned(Boolean(value))}
            />
            {t('library.samples.withdrawDialog.plannedUseNotYetRun')}
          </label>

          <Field label={t('library.samples.withdrawDialog.notesOptional')}>
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>

          <DescriptionList
            labelWidth={120}
            items={[
              [
                t('library.samples.withdrawDialog.freeNow'),
                `${formatQuantityAmount(free)}${unitSuffix}`,
              ],
              [
                t('library.samples.withdrawDialog.reserved'),
                `${formatQuantityAmount(balances?.reserved ?? 0)}${unitSuffix}`,
              ],
            ]}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button variant="primary" disabled={blocked} onClick={submit}>
            {t('library.samples.withdrawDialog.reserve')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
