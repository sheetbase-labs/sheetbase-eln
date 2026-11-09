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
import { ObjectLink } from '#/components/ui/object-link'
import { ExperimentPicker } from '#/components/record-picker/experiment-picker'
import { RecordPickerDialog } from '#/components/record-picker/record-picker'
import { PlaceField } from '#/components/samples/place-field'
import { PrintLabelsDialog } from '#/components/samples/sample-label-sheet'
import {
  formatQuantityAmount,
  parseQuantityInput,
  useSampleBalances,
} from '#/components/samples/withdraw-dialog'
import type { ExperimentOption } from '#/components/samples/withdraw-dialog'
import { POOL_MAX_SAMPLES, fetchSample } from '#/lib/samples'
import type {
  PoolSamplesResult,
  SampleQuantityBalances,
  SampleRecord,
} from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'
import { t } from '#/copy'
import type { PlaceChoice, PositionChoice } from '#/lib/storage-positions'

/** One sample going into the pool, with what the person typed to take from it. */
export interface PoolRow {
  id: string
  identifier: string
  title: string
  free: number | null
  unit: string | null
  metadataVersion: number
  take: string
}

export interface PoolPlan {
  /** Amounts to take, in row order; null where a row is not valid yet. */
  amounts: Array<number | null>
  total: number | null
  unit: string | null
  /** Why the pool cannot be made, in words; null when it can. */
  error: string | null
}

/**
 * Check a pool before sending it. The server checks the same things (free
 * volume per sample, one unit) and refuses the whole pool, so this only names
 * the problem before the request.
 */
export function planPool(rows: PoolRow[]): PoolPlan {
  const amounts = rows.map((row) => parseQuantityInput(row.take))

  const units = [
    ...new Set(rows.map((row) => row.unit).filter((u): u is string => !!u)),
  ]

  const unit = units[0] ?? null
  const empty = { amounts, total: null, unit }

  if (rows.length > POOL_MAX_SAMPLES)
    return {
      ...empty,
      error: t('library.samples.poolDialog.tooMany', { max: POOL_MAX_SAMPLES }),
    }

  if (units.length > 1)
    return {
      ...empty,
      error: t('library.samples.poolDialog.mixedUnits', {
        units: units.join(', '),
      }),
    }

  if (rows.length < 2)
    return { ...empty, error: t('library.samples.poolDialog.needAnother') }

  for (const [index, row] of rows.entries()) {
    const amount = amounts[index]

    if (amount == null) return { ...empty, error: null }

    if (amount <= 0)
      return {
        ...empty,
        error: t('library.samples.poolDialog.needAmount', {
          identifier: row.identifier,
        }),
      }

    if (row.free != null && amount > row.free + 1e-9)
      return {
        ...empty,
        error: t('library.samples.poolDialog.tooMuch', {
          identifier: row.identifier,
          free: formatQuantityAmount(row.free),
          suffix: unit ? ` ${unit}` : '',
        }),
      }
  }

  const total = (amounts as number[]).reduce((sum, a) => sum + a, 0)

  return { amounts, total, unit, error: null }
}

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
  const queriedBalances = useSampleBalances(
    sample.id,
    client,
    balancesProp === undefined,
  )

  const balances =
    balancesProp !== undefined ? balancesProp : (queriedBalances.data ?? null)

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
  const suffix = unit ? ` ${unit}` : ''

  const canSubmit =
    !busy &&
    Boolean(purpose) &&
    plan.total != null &&
    plan.error == null &&
    plan.amounts.every((a) => a != null)

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
            <>
              <DialogHeader
                title={t('library.samples.poolDialog.madePool', {
                  identifier: created.pool.identifier,
                })}
                description={t('library.samples.poolDialog.madeFrom', {
                  identifiers: created.sources
                    .map((source) => source.identifier)
                    .join(', '),
                })}
              />
              <DialogBody>
                <div className="flex gap-3 text-body">
                  <ObjectLink
                    kind="sample"
                    id={created.pool.id}
                    identifier={created.pool.identifier}
                    className="w-24 shrink-0"
                  />
                  <span className="min-w-0 truncate">{created.pool.title}</span>
                  <span className="num ml-auto text-fg-muted">
                    {created.pool.quantity != null
                      ? `${formatQuantityAmount(created.pool.quantity)}${created.pool.quantityUnit ? ` ${created.pool.quantityUnit}` : ''}`
                      : ''}
                  </span>
                </div>
              </DialogBody>
              <DialogFooter>
                <DialogClose render={<Button />}>
                  {t('common.actions.done')}
                </DialogClose>
                <Button variant="primary" onClick={() => setPrinting(true)}>
                  {t('library.samples.poolDialog.printLabel')}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader
                title={t('library.samples.poolDialog.title')}
                description={t('library.samples.poolDialog.description')}
              />
              <DialogBody>
                <div className="flex flex-col gap-1.5">
                  <span className="text-label font-medium text-fg">
                    {t('library.samples.poolDialog.samples')}
                  </span>
                  <ul className="m-0 flex list-none flex-col divide-y divide-border-subtle rounded-md border border-border-subtle p-0">
                    {rows.map((row, index) => (
                      <li
                        key={row.id}
                        className="flex items-center gap-3 px-3 py-2 text-body"
                      >
                        <ObjectLink
                          kind="sample"
                          id={row.id}
                          identifier={row.identifier}
                          className="w-24 shrink-0"
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{row.title}</span>
                          {row.free != null ? (
                            <span className="num text-label text-fg-muted">
                              {t('library.samples.poolDialog.free', {
                                free: formatQuantityAmount(row.free),
                                value: row.unit ? ` ${row.unit}` : '',
                              })}
                            </span>
                          ) : null}
                        </span>
                        <Input
                          inputMode="decimal"
                          className="w-24"
                          value={row.take}
                          aria-label={t('library.samples.poolDialog.takeAria', {
                            identifier: row.identifier,
                          })}
                          autoFocus={index === 0}
                          onChange={(event) =>
                            setTakes((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                        />
                        <span className="num w-9 shrink-0 text-label text-fg-muted">
                          {row.unit ?? ''}
                        </span>
                        {index > 0 ? (
                          <Button
                            variant="quiet"
                            size="icon"
                            icon="x"
                            aria-label={t('library.samples.poolDialog.remove', {
                              identifier: row.identifier,
                            })}
                            onClick={() =>
                              setOthers((current) =>
                                current.filter((other) => other.id !== row.id),
                              )
                            }
                          />
                        ) : (
                          <span className="size-7 shrink-0" aria-hidden />
                        )}
                      </li>
                    ))}
                  </ul>
                  <div>
                    <Button icon="plus" onClick={() => setPicking(true)}>
                      {t('library.samples.poolDialog.addSamples')}
                    </Button>
                  </div>
                </div>
                {plan.error ? (
                  <p role="alert" className="m-0 text-label text-danger-text">
                    {plan.error}
                  </p>
                ) : plan.total != null ? (
                  <p role="status" className="m-0 text-label text-fg-muted">
                    {t('library.samples.poolDialog.total', {
                      total: `${formatQuantityAmount(plan.total)}${suffix}`,
                    })}
                  </p>
                ) : null}
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
                      newContainer: {
                        title: title.trim() || undefined,
                        storageLocation:
                          place?.kind === 'text'
                            ? place.text.trim() || undefined
                            : undefined,
                      },
                      place: place?.kind === 'position' ? place : undefined,
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
