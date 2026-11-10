import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { ExperimentPicker } from '#/components/record-picker/experiment-picker'
import { PlaceField } from '#/components/samples/place-field'
import { PrintLabelsDialog } from '#/components/samples/sample-label-sheet'
import { formatQuantityAmount } from './quantity-input'
import { useQuantityBalances } from './quantity-hooks'
import type { ExperimentOption } from './quantity-hooks'
import {
  canSubmitAliquots,
  planAliquots,
  quantityDestination,
} from './quantity-plans'
import { AliquotCreated } from './quantity-created'
import { AliquotPlanPreview } from './quantity-plan-preview'
import type { SampleQuantityBalances, SampleRecord } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'
import { t } from '#/copy'
import type { PlaceChoice, PositionChoice } from '#/lib/storage-positions'

export interface AliquotDialogInput {
  count: number
  quantityEach: number
  purposeExperimentId: string
  unit?: string
  newContainer: { title?: string; storageLocation?: string }
  /**
   * A position in a box: the tubes fill the free positions from there. Left
   * out, they go in the source's box when it sits in one.
   */
  place?: PositionChoice
}

function AliquotSubmitButton({
  busy,
  count,
  disabled,
  onClick,
}: {
  busy: boolean
  count: number | null
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button variant="primary" disabled={disabled} onClick={onClick}>
      {busy
        ? t('library.samples.aliquotDialog.makingTubes')
        : count
          ? t('library.samples.aliquotDialog.makeTubes', { count })
          : t('library.samples.aliquotDialog.makeTubes2')}
    </Button>
  )
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
  canManageStorage,
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
  canManageStorage?: boolean
  experiments?: ExperimentOption[]
  balances?: SampleQuantityBalances | null
}) {
  const balances = useQuantityBalances(sample.id, client, balancesProp)

  const unit = balances?.unit ?? sample.quantityUnit
  const free = balances?.free ?? sample.quantity

  const [count, setCount] = useState('')
  const [each, setEach] = useState('')
  const [purposePicked, setPurpose] = useState('')
  const purpose = purposePicked || defaultExperimentId || ''
  const [place, setPlace] = useState<PlaceChoice | null>(null)
  const [titlePrefix, setTitlePrefix] = useState('')
  const [printing, setPrinting] = useState(false)

  const plan = planAliquots(count, each, free, unit)

  const canSubmit = canSubmitAliquots(plan, busy, purpose)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          {created ? (
            <AliquotCreated
              created={created}
              identifier={sample.identifier}
              onPrint={() => setPrinting(true)}
            />
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
                <AliquotPlanPreview
                  plan={plan}
                  unit={unit}
                  identifier={sample.identifier}
                />
                <Field
                  label={t('library.samples.aliquotDialog.forExperiment')}
                  required
                >
                  <ExperimentPicker
                    value={purpose}
                    onChange={setPurpose}
                    experiments={experimentsProp}
                    client={client}
                  />
                </Field>
                <div className="flex flex-col gap-1 text-label">
                  <span className="font-medium text-fg">
                    {t('library.samples.aliquotDialog.storeTubesAt')}
                  </span>
                  <PlaceField
                    value={place}
                    onChange={setPlace}
                    title={t('library.samples.aliquotDialog.pickerTitle')}
                    canManageStorage={canManageStorage}
                  />
                  <span className="text-fg-muted">
                    {t('library.samples.aliquotDialog.leaveBlankToKeep', {
                      storageLocation:
                        sample.storageLocation ??
                        t('library.samples.aliquotDialog.theSourceLocation'),
                    })}
                  </span>
                </div>
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
                <AliquotSubmitButton
                  busy={busy}
                  count={plan.count}
                  disabled={!canSubmit}
                  onClick={() =>
                    onSubmit({
                      count: plan.count!,
                      quantityEach: plan.quantityEach!,
                      purposeExperimentId: purpose,
                      unit: unit ?? undefined,
                      ...quantityDestination(titlePrefix, place),
                    })
                  }
                />
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
          scope={t('library.samples.aliquotDialog.theCountNewTubes', {
            count: created.length,
          })}
          client={client}
        />
      ) : null}
    </>
  )
}
