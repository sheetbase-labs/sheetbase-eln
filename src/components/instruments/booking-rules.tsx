/**
 * An instrument's booking rules: who may book it (trained on which procedures)
 * and for how long. Anyone can read them; instrument managers change them.
 */
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
import { DescriptionList, Section } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import {
  NO_RULES,
  bookingRuleKeys,
  describeMinutes,
  fetchBookingRules,
  fetchProtocolOptions,
  hasAnyRule,
  setBookingRules,
} from '#/lib/booking-rules'
import { notebookDataClient } from '#/lib/notebook-data'
import type { InstrumentRow } from './instruments-data'

const client = notebookDataClient

export function BookingRulesSection({
  instrument,
  canManage,
}: {
  instrument: InstrumentRow
  canManage: boolean
}) {
  const [editing, setEditing] = useState(false)

  const query = useQuery({
    queryKey: bookingRuleKeys.forInstrument(instrument.id),
    queryFn: () => fetchBookingRules(client, instrument.id),
    staleTime: 15_000,
  })

  const rules = query.data ?? NO_RULES

  return (
    <Section
      className="border-t border-border pt-4"
      title={t('library.instruments.bookingRules.title')}
      action={
        canManage ? (
          <Button size="sm" onClick={() => setEditing(true)}>
            {t('library.instruments.bookingRules.edit')}
          </Button>
        ) : undefined
      }
    >
      {query.isPending ? null : hasAnyRule(rules) ? (
        <DescriptionList
          labelWidth={130}
          items={[
            [
              t('library.instruments.bookingRules.training'),
              rules.training.length === 0 ? (
                t('library.instruments.bookingRules.none')
              ) : (
                <span className="flex flex-col gap-0.5">
                  {rules.training.map((p) => (
                    <Link
                      key={p.protocolId}
                      to="/protocols/$protocolId"
                      params={{ protocolId: p.protocolId }}
                    >
                      <span className="mono text-fg-muted">{p.identifier}</span>{' '}
                      {p.title}
                    </Link>
                  ))}
                </span>
              ),
            ],
            [
              t('library.instruments.bookingRules.longest'),
              rules.maxBookingMinutes
                ? describeMinutes(rules.maxBookingMinutes)
                : t('library.instruments.bookingRules.noLimit'),
            ],
            [
              t('library.instruments.bookingRules.furthest'),
              rules.maxAdvanceDays
                ? t('library.instruments.bookingRules.days', {
                    count: rules.maxAdvanceDays,
                  })
                : t('library.instruments.bookingRules.noLimit'),
            ],
          ]}
        />
      ) : (
        <p className="m-0 text-body text-fg-muted">
          {t('library.instruments.bookingRules.empty')}
        </p>
      )}
      {editing ? (
        <BookingRulesDialog
          instrument={instrument}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </Section>
  )
}

function BookingRulesDialog({
  instrument,
  onClose,
}: {
  instrument: InstrumentRow
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const current = useQuery({
    queryKey: bookingRuleKeys.forInstrument(instrument.id),
    queryFn: () => fetchBookingRules(client, instrument.id),
  })

  const protocols = useQuery({
    queryKey: bookingRuleKeys.protocols,
    queryFn: () => fetchProtocolOptions(client),
    staleTime: 60_000,
  })

  const [ids, setIds] = useState<string[]>([])
  const selectedIds = new Set(ids)
  const [hours, setHours] = useState('')
  const [days, setDays] = useState('')

  useEffect(() => {
    if (!current.data) return
    setIds(current.data.training.map((p) => p.protocolId))
    setHours(
      current.data.maxBookingMinutes
        ? String(current.data.maxBookingMinutes / 60)
        : '',
    )
    setDays(
      current.data.maxAdvanceDays ? String(current.data.maxAdvanceDays) : '',
    )
  }, [current.data])

  const minutes = hours.trim() === '' ? null : Math.round(Number(hours) * 60)
  const ahead = days.trim() === '' ? null : Math.round(Number(days))

  const invalid =
    (minutes !== null && (!Number.isFinite(minutes) || minutes < 5)) ||
    (ahead !== null && (!Number.isFinite(ahead) || ahead < 1))

  const save = useMutation({
    mutationFn: () =>
      setBookingRules(client, {
        instrumentId: instrument.id,
        protocolIds: ids,
        maxBookingMinutes: minutes,
        maxAdvanceDays: ahead,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookingRuleKeys.all })
      toast.success(t('library.instruments.bookingRules.saved'))
      onClose()
    },
    onError: (e) =>
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t('library.instruments.bookingRules.couldNotSave'),
      ),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.instruments.bookingRules.dialogTitle')}
        />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <Field
              label={t('library.instruments.bookingRules.training')}
              hint={t('library.instruments.bookingRules.trainingHint')}
            >
              <span className="flex max-h-56 flex-col gap-1.5 overflow-auto">
                {(protocols.data ?? []).length === 0 && !protocols.isPending ? (
                  <span className="text-fg-muted">
                    {t('library.instruments.bookingRules.noProtocols')}
                  </span>
                ) : null}
                {(protocols.data ?? []).map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 text-body"
                  >
                    <Checkbox
                      checked={selectedIds.has(p.id)}
                      onCheckedChange={(checked) =>
                        setIds((c) =>
                          checked === true
                            ? [...c, p.id]
                            : c.filter((id) => id !== p.id),
                        )
                      }
                    />
                    <span className="mono text-fg-muted">{p.identifier}</span>
                    {p.title}
                  </label>
                ))}
              </span>
            </Field>
            <Field
              label={t('library.instruments.bookingRules.longestLabel')}
              hint={t('library.instruments.bookingRules.longestHint')}
            >
              <Input
                inputMode="decimal"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </Field>
            <Field
              label={t('library.instruments.bookingRules.furthestLabel')}
              hint={t('library.instruments.bookingRules.furthestHint')}
            >
              <Input
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending || invalid || current.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
