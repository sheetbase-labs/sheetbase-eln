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
import { RecordPickerDialog } from '#/components/record-picker/record-picker'
import { PlaceField } from '#/components/samples/place-field'
import { PrintLabelsDialog } from '#/components/samples/sample-label-sheet'
import { useQuantityBalances } from './quantity-hooks'
import type { ExperimentOption } from './quantity-hooks'
import { canSubmitPool, planPool, quantityDestination } from './quantity-plans'
import type { PoolRow } from './quantity-plans'
import { PoolCreated } from './quantity-created'
import { PoolSources } from './quantity-pool-sources'
import { PoolPlanPreview } from './quantity-plan-preview'
import { fetchSample } from '#/lib/samples'
import type {
  PoolSamplesResult,
  SampleQuantityBalances,
  SampleRecord,
} from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'
import { t } from '#/copy'
import type { PlaceChoice, PositionChoice } from '#/lib/storage-positions'

export interface PoolDialogInput {
  sources: Array<{
    recordId: string
    quantity: number
    expectedMetadataVersion: number
  }>
  purposeExperimentId: string
  unit?: string
  newContainer: { title?: string; storageLocation?: string }
  place?: PositionChoice
}

/**
 * Combine this sample with others into one new sample, taking an amount from
 * each. The pool is a real sample linked back to every source and to the
 * experiment it is for.
 */
export function PoolDialog({
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
  initialRows,
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
    metadataVersion: number
  }
  busy: boolean
  error?: string | null
  /** The pool just made; when set the dialog shows it instead of the form. */
  created?: PoolSamplesResult | null
  onSubmit: (input: PoolDialogInput) => void
  defaultExperimentId?: string
  client?: DataClient
  canManageStorage?: boolean
  experiments?: ExperimentOption[]
  balances?: SampleQuantityBalances | null
  /** Other samples already chosen (for tests and stories). */
  initialRows?: PoolRow[]
}) {
  const balances = useQuantityBalances(sample.id, client, balancesProp)

  const first: PoolRow = {
    id: sample.id,
    identifier: sample.identifier,
    title: sample.title,
    free: balances?.free ?? sample.quantity,
    unit: balances?.unit ?? sample.quantityUnit,
    metadataVersion: sample.metadataVersion,
    take: '',
  }

  const [others, setOthers] = useState<PoolRow[]>(initialRows ?? [])
  const [picking, setPicking] = useState(false)
  const [purposePicked, setPurpose] = useState('')
  const purpose = purposePicked || defaultExperimentId || ''
  const [place, setPlace] = useState<PlaceChoice | null>(null)
  const [title, setTitle] = useState('')
  const [printing, setPrinting] = useState(false)
  // What the person typed for each row, by sample id.
  const [takes, setTakes] = useState<Record<string, string>>({})

  const rows = [first, ...others].map((row) => ({
    ...row,
    take: takes[row.id] ?? row.take,
  }))

  const plan = planPool(rows)
  const unit = plan.unit

  const canSubmit = canSubmitPool(plan, busy, purpose)

  const addSamples = async (ids: string[]) => {
    const records = await Promise.all(ids.map((id) => fetchSample(client, id)))
    setOthers((current) => [
      ...current,
      ...records
        .filter((r): r is SampleRecord => r != null)
        .map((r) => ({
          id: r.id,
          identifier: r.identifier,
          title: r.title,
          free: r.quantity,
          unit: r.quantityUnit,
          metadataVersion: r.metadataVersion,
          take: '',
        })),
    ])
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(600px,calc(100vw-32px))]">
          {created ? (
            <PoolCreated created={created} onPrint={() => setPrinting(true)} />
          ) : (
            <>
              <DialogHeader
                title={t('library.samples.poolDialog.title')}
                description={t('library.samples.poolDialog.description')}
              />
              <DialogBody>
                <PoolSources
                  rows={rows}
                  onTake={(id, take) =>
                    setTakes((current) => ({ ...current, [id]: take }))
                  }
                  onRemove={(id) =>
                    setOthers((current) =>
                      current.filter((other) => other.id !== id),
                    )
                  }
                  onAdd={() => setPicking(true)}
                />
                <PoolPlanPreview plan={plan} />
                <Field
                  label={t('library.samples.poolDialog.forExperiment')}
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
                    {t('library.samples.poolDialog.storeAt')}
                  </span>
                  <PlaceField
                    value={place}
                    onChange={setPlace}
                    title={t('library.samples.poolDialog.pickerPlaceTitle')}
                    canManageStorage={canManageStorage}
                  />
                  <span className="text-fg-muted">
                    {t('library.samples.poolDialog.leaveBlankToKeep', {
                      storageLocation:
                        sample.storageLocation ??
                        t('library.samples.poolDialog.firstLocation'),
                    })}
                  </span>
                </div>
                <Field
                  label={t('library.samples.poolDialog.name')}
                  hint={t('library.samples.poolDialog.nameHint')}
                >
                  <Input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </Field>
                {error ? (
                  <Notice
                    tone="bad"
                    title={t('library.samples.poolDialog.noPoolMade')}
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
                      sources: rows.map((row, index) => ({
                        recordId: row.id,
                        quantity: plan.amounts[index]!,
                        expectedMetadataVersion: row.metadataVersion,
                      })),
                      purposeExperimentId: purpose,
                      unit: unit ?? undefined,
                      ...quantityDestination(title, place),
                    })
                  }
                >
                  {busy
                    ? t('library.samples.poolDialog.pooling')
                    : t('library.samples.poolDialog.pool')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <RecordPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title={t('library.samples.poolDialog.pickerTitle')}
        allowed={['Sample']}
        multiple
        exclude={rows.map((row) => row.id)}
        confirmLabel={(count) =>
          t('library.samples.poolDialog.pickerConfirm', { count })
        }
        onPick={(items) => void addSamples(items.map((item) => item.id))}
      />
      {created ? (
        <PrintLabelsDialog
          open={printing}
          onOpenChange={setPrinting}
          records={[created.pool]}
          scope={t('library.samples.poolDialog.thePool')}
          client={client}
        />
      ) : null}
    </>
  )
}
