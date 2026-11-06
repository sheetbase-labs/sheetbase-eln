/**
 * An instrument's recharge rate: what each hour booked on it is charged at.
 * Anyone can read it; instrument managers set it.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { currencyOptions, lastCurrency, rememberCurrency } from '#/lib/currency'
import {
  fetchInstrumentRates,
  setInstrumentRate,
  usageKeys,
} from '#/lib/facility-usage'
import { notebookDataClient } from '#/lib/notebook-data'
import { formatMoney } from '#/lib/report-period'
import type { InstrumentRow } from '#/components/instruments/instruments-data'

const client = notebookDataClient

export function InstrumentRateSection({
  instrument,
  canManage,
}: {
  instrument: InstrumentRow
  canManage: boolean
}) {
  const [editing, setEditing] = useState(false)
  const rates = useQuery({
    queryKey: usageKeys.rates,
    queryFn: () => fetchInstrumentRates(client),
    staleTime: 30_000,
  })
  const rate = rates.data?.find((r) => r.instrumentId === instrument.id)

  return (
    <Section
      className="border-t border-border pt-4"
      title={t('spend.usage.rate.title')}
      action={
        canManage ? (
          <Button size="sm" onClick={() => setEditing(true)}>
            {t('spend.usage.rate.edit')}
          </Button>
        ) : undefined
      }
    >
      {rates.isPending ? null : (
        <p className="m-0 text-body">
          {rate ? (
            t('spend.usage.perHour', {
              rate: formatMoney(rate.ratePerHour, rate.currency),
            })
          ) : (
            <span className="text-fg-muted">{t('spend.usage.rate.none')}</span>
          )}
        </p>
      )}
      {editing ? (
        <RateDialog
          instrument={instrument}
          current={rate}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </Section>
  )
}

function RateDialog({
  instrument,
  current,
  onClose,
}: {
  instrument: InstrumentRow
  current: { ratePerHour: number; currency: string } | undefined
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [rate, setRate] = useState(current ? String(current.ratePerHour) : '')
  const [currency, setCurrency] = useState(current?.currency ?? lastCurrency())
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (value: number | null) =>
      setInstrumentRate(client, {
        instrumentId: instrument.id,
        ratePerHour: value,
        currency: value === null ? null : currency,
      }),
    onSuccess: (_result, value) => {
      void queryClient.invalidateQueries({ queryKey: usageKeys.all })
      if (value !== null) rememberCurrency(currency)
      toast.success(t('spend.usage.rate.saved'))
      onClose()
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t('spend.usage.rate.couldNotSave'),
      ),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader
          title={t('spend.usage.rate.dialogTitle')}
          description={instrument.name}
        />
        <DialogBody>
          <form
            id="instrument-rate-form"
            className="grid grid-cols-[1fr_120px] items-start gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (rate.trim() === '') {
                setError(null)
                save.mutate(null)
                return
              }
              const value = Number(rate)
              if (!Number.isFinite(value) || value < 0) {
                setError(t('spend.usage.rate.enterARate'))
                return
              }
              setError(null)
              save.mutate(value)
            }}
          >
            <Field
              label={t('spend.usage.rate.rate')}
              hint={t('spend.usage.rate.rateHint')}
              error={error}
            >
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={rate}
                autoFocus
                aria-invalid={error !== null}
                onChange={(e) => {
                  setRate(e.target.value)
                  setError(null)
                }}
                disabled={save.isPending}
              />
            </Field>
            <Field label={t('spend.usage.rate.currency')}>
              <Select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={save.isPending}
              >
                {currencyOptions(currency).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="instrument-rate-form"
            disabled={save.isPending}
          >
            {t('spend.usage.rate.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
