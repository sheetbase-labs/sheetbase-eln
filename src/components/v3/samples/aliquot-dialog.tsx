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
import { Field, Input } from '#/components/v3/ui/input'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { ExperimentPicker } from '#/components/v3/record-picker/experiment-picker'
import { LocationInput } from '#/components/v3/samples/location-field'
import { PrintLabelsDialog } from '#/components/v3/samples/sample-label-sheet'
import {
  formatQuantityAmount,
  parseQuantityInput,
  useSampleBalances,
} from '#/components/v3/samples/withdraw-dialog'
import type { ExperimentOption } from '#/components/v3/samples/withdraw-dialog'
import type { SampleQuantityBalances, SampleRecord } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'
import { t } from '#/copy'

/** The largest split the server accepts in one step (api.aliquot_sample). */
export const ALIQUOT_MAX_TUBES = 96

export interface AliquotPlan {
  count: number | null
  quantityEach: number | null
  total: number | null
  /** Why the plan cannot be submitted, in words for the field; null when it can. */
  error: string | null
  /** Free volume left in the source after the split, when it is valid. */
  remaining: number | null
}

/**
 * Check a split against the free volume. The server checks the same total and
 * refuses the whole split, so this only names the problem before the request.
 */
export function planAliquots(
  rawCount: string,
  rawEach: string,
  free: number | null,
  unit: string | null,
): AliquotPlan {
  const count = parseQuantityInput(rawCount)
  const quantityEach = parseQuantityInput(rawEach)
  const empty = { count, quantityEach, total: null, remaining: null }
  if (count == null || quantityEach == null) return { ...empty, error: null }
  if (!Number.isInteger(count) || count < 1 || count > ALIQUOT_MAX_TUBES)
    return {
      ...empty,
      error: t('library.samples.aliquotDialog.enterAWholeNumberOf', {
        aliquotMaxTubes: ALIQUOT_MAX_TUBES,
      }),
    }
  if (quantityEach <= 0)
    return {
      ...empty,
      error: t('library.samples.aliquotDialog.eachTubeNeedsAnAmount'),
    }
  const total = count * quantityEach
  const suffix = unit ? ` ${unit}` : ''
  if (free != null && total > free + 1e-9) {
    return {
      count,
      quantityEach,
      total,
      remaining: null,
      error: t('library.samples.aliquotDialog.isButOnlyIsFree', {
        count,
        quantityEach: formatQuantityAmount(quantityEach),
        suffix,
        total: formatQuantityAmount(total),
        suffix2: suffix,
        free: formatQuantityAmount(free),
        suffix3: suffix,
      }),
    }
  }
  return {
    count,
    quantityEach,
    total,
    error: null,
    remaining: free == null ? null : free - total,
  }
}

export interface AliquotDialogInput {
  count: number
  quantityEach: number
  purposeExperimentId: string
  unit?: string
  newContainer: { title?: string; storageLocation?: string }
}

/**
 * Split a sample into N tubes in one step. Every tube is a real sample linked
 * back to this one and to the experiment they are for, so nothing is typed N
 * times and the lineage matches N withdrawals.
 */
export function AliquotDialog({
  open,
  onOpenChange,
  sample,
  busy,
  error,
  created,
  onSubmit,
  defaultExperimentId,
  client = notebookDataClient,
  experiments: experimentsProp,
  balances: balancesProp,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sample: {
    id: string
    identifier: string
    title: string
    quantity: number | null
    quantityUnit: string | null
    storageLocation: string | null
  }
  busy: boolean
  error?: string | null
  /** The tubes just made; when set the dialog shows them instead of the form. */
  created?: SampleRecord[] | null
  onSubmit: (input: AliquotDialogInput) => void
  defaultExperimentId?: string
  client?: DataClient
  experiments?: ExperimentOption[]
  balances?: SampleQuantityBalances | null
}) {
  const queriedBalances = useSampleBalances(
    sample.id,
    client,
    balancesProp === undefined,
  )
  const balances =
    balancesProp !== undefined ? balancesProp : (queriedBalances.data ?? null)
  const unit = balances?.unit ?? sample.quantityUnit
  const free = balances?.free ?? sample.quantity

  const [count, setCount] = useState('')
  const [each, setEach] = useState('')
  const [purposePicked, setPurpose] = useState('')
  const purpose = purposePicked || defaultExperimentId || ''
  const [location, setLocation] = useState('')
  const [titlePrefix, setTitlePrefix] = useState('')
  const [printing, setPrinting] = useState(false)

  const plan = planAliquots(count, each, free, unit)
  const canSubmit =
    !busy &&
    Boolean(purpose) &&
    plan.count != null &&
    plan.quantityEach != null &&
    plan.error == null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          {created ? (
            <>
              <DialogHeader
                title={t('library.samples.aliquotDialog.madeTubesFrom', {
                  count: created.length,
                  identifier: sample.identifier,
                })}
              />
              <DialogBody>
                <ul
                  aria-label={t('library.samples.aliquotDialog.newTubes')}
                  className="m-0 flex max-h-[40vh] list-none flex-col gap-1 overflow-auto p-0"
                >
                  {created.map((tube) => (
                    <li key={tube.id} className="flex gap-3 text-body">
                      <ObjectLink
                        kind="sample"
                        id={tube.id}
                        identifier={tube.identifier}
                        className="w-24 shrink-0"
                      />
                      <span className="min-w-0 truncate">{tube.title}</span>
                      <span className="num ml-auto text-fg-muted">
                        {tube.quantity != null
                          ? `${formatQuantityAmount(tube.quantity)}${tube.quantityUnit ? ` ${tube.quantityUnit}` : ''}`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </DialogBody>
              <DialogFooter>
                <DialogClose render={<Button />}>
                  {t('common.actions.done')}
                </DialogClose>
                <Button variant="primary" onClick={() => setPrinting(true)}>
                  {t('library.samples.aliquotDialog.printLabels', {
                    count: created.length,
                  })}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader
                title={t('library.samples.aliquotDialog.aliquot', {
                  identifier: sample.identifier,
                })}
                description={
                  free != null
                    ? t('library.samples.aliquotDialog.freeToSplit', {
                        free: formatQuantityAmount(free),
                        value: unit ? ` ${unit}` : '',
                      })
                    : undefined
                }
              />
              <DialogBody>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label={t('library.samples.aliquotDialog.numberOfTubes')}
                    required
                  >
                    <Input
                      inputMode="numeric"
                      value={count}
                      onChange={(event) => setCount(event.target.value)}
                      autoFocus
                    />
                  </Field>
                  <Field
                    label={t('library.samples.aliquotDialog.amountInEach', {
                      value: unit ? ` (${unit})` : '',
                    })}
                    required
                  >
                    <Input
                      inputMode="decimal"
                      value={each}
                      onChange={(event) => setEach(event.target.value)}
                    />
                  </Field>
                </div>
                {plan.error ? (
                  <p role="alert" className="m-0 text-label text-danger-text">
                    {plan.error}
                  </p>
                ) : plan.total != null ? (
                  <p role="status" className="m-0 text-label text-fg-muted">
                    {formatQuantityAmount(plan.total)}
                    {unit ? ` ${unit}` : ''}{' '}
                    {t('library.samples.aliquotDialog.inTotal')}
                    {plan.remaining != null
                      ? t('library.samples.aliquotDialog.staysIn', {
                          remaining: formatQuantityAmount(plan.remaining),
                          value: unit ? ` ${unit}` : '',
                          identifier: sample.identifier,
                        })
                      : '.'}
                  </p>
                ) : null}
                <Field label="For experiment" required>
                  <ExperimentPicker
                    value={purpose}
                    onChange={setPurpose}
                    experiments={experimentsProp}
                    client={client}
                  />
                </Field>
                <Field
                  label={t('library.samples.aliquotDialog.storeTubesAt')}
                  hint={t('library.samples.aliquotDialog.leaveBlankToKeep', {
                    storageLocation:
                      sample.storageLocation ?? 'the source location',
                  })}
                >
                  <LocationInput value={location} onChange={setLocation} />
                </Field>
                <Field
                  label={t('library.samples.aliquotDialog.name')}
                  hint={t(
                    'library.samples.aliquotDialog.tubesAreNamedNameAliquot',
                    { title: sample.title },
                  )}
                >
                  <Input
                    value={titlePrefix}
                    onChange={(event) => setTitlePrefix(event.target.value)}
                  />
                </Field>
                {error ? (
                  <Notice
                    tone="bad"
                    title={t('library.samples.aliquotDialog.noTubesWereMade')}
                  >
                    {error}
                  </Notice>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose render={<Button />}>
                  {t('common.actions.cancel')}
                </DialogClose>
                <Button
                  variant="primary"
                  disabled={!canSubmit}
                  onClick={() =>
                    onSubmit({
                      count: plan.count!,
                      quantityEach: plan.quantityEach!,
                      purposeExperimentId: purpose,
                      unit: unit ?? undefined,
                      newContainer: {
                        title: titlePrefix.trim() || undefined,
                        storageLocation: location.trim() || undefined,
                      },
                    })
                  }
                >
                  {busy
                    ? t('library.samples.aliquotDialog.makingTubes')
                    : plan.count
                      ? t('library.samples.aliquotDialog.makeTubes', {
                          count: plan.count,
                        })
                      : t('library.samples.aliquotDialog.makeTubes2')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {created ? (
        <PrintLabelsDialog
          open={printing}
          onOpenChange={setPrinting}
          records={created}
          scope={`the ${created.length} new tubes`}
          client={client}
        />
      ) : null}
    </>
  )
}
