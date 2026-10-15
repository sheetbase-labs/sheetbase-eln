import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

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
import { DescriptionList } from '#/components/v3/ui/layout'
import { NativeSelect } from '#/components/v3/projects/select'
import { cn } from '#/lib/utils'
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import type { RecordWire } from '#/lib/notebook-data'
import { fetchSampleQuantityBalances, sampleQueryKeys } from '#/lib/samples'
import type { SampleQuantityBalances } from '#/lib/samples'

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
// Shared numeric helpers.
// ---------------------------------------------------------------------------

/** Format a quantity the way the design tables do (en-GB, up to 2 decimals). */
export function formatQuantityAmount(value: number): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 })
}

/** Parse a quantity field that may carry thousands separators. Null when empty. */
export function parseQuantityInput(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export interface QuantityValidation {
  /** Inline message when the amount is above the free balance. */
  error: string | null
  /** Free balance minus the entered amount; null until a positive amount is typed. */
  remainingAfter: number | null
  valid: boolean
}

/**
 * Client-side gate shared by withdraw and reserve: the amount must be positive
 * and must not exceed the free balance. The server remains authoritative.
 */
export function validateQuantity(
  rawQuantity: string,
  free: number,
  unit: string | null,
  freeWord: 'left' | 'free' = 'left',
): QuantityValidation {
  const quantity = parseQuantityInput(rawQuantity)
  if (quantity == null || quantity <= 0) {
    return { error: null, remainingAfter: null, valid: false }
  }
  const unitLabel = unit ? ` ${unit}` : ''
  if (quantity > free) {
    return {
      error: `Only ${formatQuantityAmount(free)}${unitLabel} ${freeWord}. Enter ${formatQuantityAmount(free)} or less.`,
      remainingAfter: free - quantity,
      valid: false,
    }
  }
  return { error: null, remainingAfter: free - quantity, valid: true }
}

/**
 * Map an RPC refusal to a short, actionable message. Over-withdrawal
 * (`SB006`) reports the amount the server computed from the free balance so
 * the user can correct the field; the amount is parsed from the canonical
 * error text ("available 2" / "have 2").
 */
export function describeWithdrawError(
  error: unknown,
  unit: string | null,
): string {
  if (error instanceof DataClientError) {
    if (error.code === 'SB006') {
      const match =
        /available ([\d.]+)/i.exec(error.message) ??
        /have ([\d.]+)/i.exec(error.message)
      const amount = match ? Number(match[1]) : null
      if (amount != null && Number.isFinite(amount)) {
        const label = unit ? ` ${unit}` : ''
        return `Only ${formatQuantityAmount(amount)}${label} available. Enter ${formatQuantityAmount(amount)} or less.`
      }
      return 'Not enough free volume for this amount.'
    }
    if (error.code === 'SB001') {
      return 'This sample was edited by someone else. Refresh and try again.'
    }
    if (error.code === 'SB004') {
      return 'This sample cannot be withdrawn in its current state.'
    }
    if (error.code === '42501') {
      return 'You do not have permission to change this sample.'
    }
    return error.message
  }
  if (error instanceof Error) return error.message
  return 'Could not complete the sample operation. Try again.'
}

// ---------------------------------------------------------------------------
// Data hooks (the dialogs own their data so the layout stays simple).
// ---------------------------------------------------------------------------

export interface ExperimentOption {
  id: string
  identifier: string
  title: string
}

/** Active experiments in the workspace, newest first, for a purpose picker. */
export function useExperimentOptions(
  client: DataClient = notebookDataClient,
  enabled = true,
) {
  return useQuery({
    queryKey: ['ui-port', 'sample-withdraw', 'experiments'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ExperimentOption[]> => {
      const rows = await client.list<RecordWire>(
        'records',
        '?kind=eq.experiment&deleted_at=is.null&archived_at=is.null&order=updated_at.desc&limit=100&select=id,identifier,title',
      )
      return rows.map((row) => ({
        id: row.id,
        identifier: row.identifier,
        title: row.title,
      }))
    },
  })
}

/** Authoritative used / reserved / free balance for a sample. */
export function useSampleBalances(
  recordId: string,
  client: DataClient = notebookDataClient,
  enabled = true,
) {
  return useQuery({
    queryKey: sampleQueryKeys.balances(recordId),
    enabled,
    queryFn: () => fetchSampleQuantityBalances(client, recordId),
  })
}

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
      aria-label="Number pad"
      className={cn('grid grid-cols-3 gap-1.5', className)}
    >
      {KEYPAD_KEYS.map((key) =>
        key === 'backspace' ? (
          <Button
            key={key}
            type="button"
            size="lg"
            aria-label="Backspace"
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
// Actions context: lets the Usage tab open the dialogs the layout owns.
// ---------------------------------------------------------------------------

export interface SampleActions {
  openWithdraw: () => void
  openReserve: () => void
  /**
   * Whether Withdraw is available in the sample's lifecycle state. The header
   * and the Usage tab read the same answer, so the tab cannot offer a write the
   * record header withholds (a held/quarantined/expired sample).
   */
  canWithdraw: boolean
}

const SampleActionsContext = createContext<SampleActions | null>(null)

export function SampleActionsProvider({
  actions,
  children,
}: {
  actions: SampleActions
  children: React.ReactNode
}) {
  return (
    <SampleActionsContext.Provider value={actions}>
      {children}
    </SampleActionsContext.Provider>
  )
}

/** The layout's dialog actions, or null when rendered outside the sample frame. */
export function useSampleActions(): SampleActions | null {
  return useContext(SampleActionsContext)
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

const COMMON_UNITS = ['mL', 'µL', 'L', 'mg', 'g', 'µg', 'units']

export function WithdrawDialog({
  open,
  onOpenChange,
  sample,
  busy,
  onSubmit,
  experiments: experimentsProp,
  balances: balancesProp,
}: WithdrawDialogProps) {
  const queriedExperiments = useExperimentOptions(
    notebookDataClient,
    experimentsProp === undefined,
  )
  const queriedBalances = useSampleBalances(
    sample.id,
    notebookDataClient,
    balancesProp === undefined,
  )
  const experiments = experimentsProp ?? queriedExperiments.data ?? []
  const balances =
    balancesProp !== undefined ? balancesProp : (queriedBalances.data ?? null)

  // The unit the server will measure the withdrawal against is the balance's:
  // a sample with no stored unit must not be able to submit a different one.
  const balanceUnit = balances?.unit ?? null
  const unitLocked = Boolean(sample.quantityUnit ?? balanceUnit)
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState(sample.quantityUnit ?? balanceUnit ?? 'mL')
  const [purpose, setPurpose] = useState('')
  const [into, setInto] = useState('keep')
  const [containerTitle, setContainerTitle] = useState('')
  const [notes, setNotes] = useState('')

  // The balance arrives after the first paint; adopt its unit when the sample
  // does not carry one of its own.
  useEffect(() => {
    if (sample.quantityUnit) return
    if (balanceUnit) setUnit(balanceUnit)
  }, [sample.quantityUnit, balanceUnit])

  const free = balances?.free ?? sample.quantity ?? 0
  const unitLabel = balances?.unit ?? sample.quantityUnit ?? null
  const validation = validateQuantity(quantity, free, unitLabel)
  const unitSuffix = unitLabel ? ` ${unitLabel}` : ''
  const blocked = busy || !validation.valid || purpose === ''
  const unitOptions = useMemo(() => {
    if (sample.quantityUnit) return [sample.quantityUnit]
    if (balanceUnit) return [balanceUnit]
    return COMMON_UNITS
  }, [sample.quantityUnit, balanceUnit])

  const onKey = (key: string) => {
    setQuantity((current) => {
      if (key === 'backspace') return current.slice(0, -1)
      if (key === '.' && current.includes('.')) return current
      return current + key
    })
  }

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
          title="Withdraw volume"
          description={`${sample.identifier} · ${sample.title} · ${formatQuantityAmount(free)}${unitSuffix} available`}
        />
        <DialogBody>
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
            <Field
              label="Volume"
              required
              error={validation.error ?? undefined}
              hint={
                validation.valid && validation.remainingAfter != null
                  ? `${formatQuantityAmount(validation.remainingAfter)}${unitSuffix} will be left`
                  : undefined
              }
            >
              <Input
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                aria-invalid={validation.error ? true : undefined}
                autoFocus
              />
            </Field>
            <Field label="Unit" required>
              <NativeSelect
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                disabled={unitLocked}
              >
                {unitOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <QuantityKeypad onKey={onKey} className="md:hidden" />

          <Field label="Purpose" required>
            <NativeSelect
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
            >
              <option value="" disabled>
                {experiments.length
                  ? 'Select an experiment…'
                  : 'No experiments available'}
              </option>
              {experiments.map((experiment) => (
                <option key={experiment.id} value={experiment.id}>
                  {experiment.identifier} · {experiment.title}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Into">
            <NativeSelect
              value={into}
              onChange={(event) => setInto(event.target.value)}
            >
              <option value="keep">Keep in this sample</option>
              <option value="new">New container, print label</option>
            </NativeSelect>
          </Field>

          {into === 'new' ? (
            <Field label="New container label (optional)">
              <Input
                value={containerTitle}
                onChange={(event) => setContainerTitle(event.target.value)}
                placeholder={`${sample.title} from ${sample.identifier}`}
              />
            </Field>
          ) : null}

          <Field label="Notes (optional)">
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>

          <DescriptionList
            labelWidth={120}
            items={[
              ['Available now', `${formatQuantityAmount(free)}${unitSuffix}`],
              [
                'Reserved',
                `${formatQuantityAmount(balances?.reserved ?? 0)}${unitSuffix}`,
              ],
              [
                'Remaining after',
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
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary" disabled={blocked} onClick={submit}>
            Withdraw
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
  const queriedExperiments = useExperimentOptions(
    notebookDataClient,
    experimentsProp === undefined,
  )
  const queriedBalances = useSampleBalances(
    sample.id,
    notebookDataClient,
    balancesProp === undefined,
  )
  const experiments = experimentsProp ?? queriedExperiments.data ?? []
  const balances =
    balancesProp !== undefined ? balancesProp : (queriedBalances.data ?? null)

  // The unit the server will measure the reservation against is the balance's:
  // a sample with no stored unit must not be able to submit a different one.
  const balanceUnit = balances?.unit ?? null
  const unitLocked = Boolean(sample.quantityUnit ?? balanceUnit)
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState(sample.quantityUnit ?? balanceUnit ?? 'mL')
  const [experiment, setExperiment] = useState('')
  const [planned, setPlanned] = useState(true)
  const [notes, setNotes] = useState('')

  // The balance arrives after the first paint; adopt its unit when the sample
  // does not carry one of its own.
  useEffect(() => {
    if (sample.quantityUnit) return
    if (balanceUnit) setUnit(balanceUnit)
  }, [sample.quantityUnit, balanceUnit])

  const free = balances?.free ?? sample.quantity ?? 0
  const unitLabel = balances?.unit ?? sample.quantityUnit ?? null
  const validation = validateQuantity(quantity, free, unitLabel, 'free')
  const unitSuffix = unitLabel ? ` ${unitLabel}` : ''
  const blocked = busy || !validation.valid || experiment === ''
  const unitOptions = useMemo(() => {
    if (sample.quantityUnit) return [sample.quantityUnit]
    if (balanceUnit) return [balanceUnit]
    return COMMON_UNITS
  }, [sample.quantityUnit, balanceUnit])

  const onKey = (key: string) => {
    setQuantity((current) => {
      if (key === 'backspace') return current.slice(0, -1)
      if (key === '.' && current.includes('.')) return current
      return current + key
    })
  }

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
          title="Reserve volume"
          description={`${sample.identifier} · ${sample.title} · ${formatQuantityAmount(free)}${unitSuffix} free`}
        />
        <DialogBody>
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
            <Field
              label="Volume"
              required
              error={validation.error ?? undefined}
              hint={
                validation.valid && validation.remainingAfter != null
                  ? `${formatQuantityAmount(validation.remainingAfter)}${unitSuffix} will stay free`
                  : undefined
              }
            >
              <Input
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                aria-invalid={validation.error ? true : undefined}
                autoFocus
              />
            </Field>
            <Field label="Unit" required>
              <NativeSelect
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                disabled={unitLocked}
              >
                {unitOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <QuantityKeypad onKey={onKey} className="md:hidden" />

          <Field label="For" required>
            <NativeSelect
              value={experiment}
              onChange={(event) => setExperiment(event.target.value)}
            >
              <option value="" disabled>
                {experiments.length
                  ? 'Select an experiment…'
                  : 'No experiments available'}
              </option>
              {experiments.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.identifier} · {option.title}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <label className="flex items-center gap-2 text-label">
            <Checkbox
              checked={planned}
              onCheckedChange={(value) => setPlanned(Boolean(value))}
            />
            Planned use (not yet run)
          </label>

          <Field label="Notes (optional)">
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>

          <DescriptionList
            labelWidth={120}
            items={[
              ['Free now', `${formatQuantityAmount(free)}${unitSuffix}`],
              [
                'Reserved',
                `${formatQuantityAmount(balances?.reserved ?? 0)}${unitSuffix}`,
              ],
            ]}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary" disabled={blocked} onClick={submit}>
            Reserve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
