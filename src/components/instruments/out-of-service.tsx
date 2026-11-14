import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
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
import { Select } from '#/components/ui/select'
import { Section, Muted } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { Textarea } from '#/components/inventory/list'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import {
  SERVICE_KINDS,
  formatInstrumentDay,
  instrumentQueryKeys,
  logInstrumentService,
  setInstrumentOutOfService,
  useInstrumentServiceLog,
} from '#/components/instruments/instruments-data'
import type {
  InstrumentRow,
  ServiceKind,
  ServiceLogRow,
} from '#/components/instruments/instruments-data'
import { t } from '#/copy'

function kindLabel(kind: ServiceKind): string {
  switch (kind) {
    case 'repair':
      return t('library.instruments.serviceLog.kindRepair')
    case 'service':
      return t('library.instruments.serviceLog.kindService')
    case 'inspection':
      return t('library.instruments.serviceLog.kindInspection')
    case 'other':
      return t('library.instruments.serviceLog.kindOther')
  }
}

function isoDay(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/** The page-wide strip while an instrument is down: why, since when, expected back. */
export function OutOfServiceNotice({
  instrument,
  names,
  action,
}: {
  instrument: InstrumentRow
  names: { userLabel: (id: string) => string }
  /** Present only when the viewer may put it back in service. */
  action?: React.ReactNode
}) {
  return (
    <Notice
      tone="warn"
      title={t('library.instruments.outOfService.since', {
        date: formatInstrumentDay(instrument.outOfServiceAt),
      })}
      action={action}
    >
      {' '}
      {[
        instrument.outOfServiceReason,
        instrument.expectedBackOn
          ? t('library.instruments.outOfService.expectedBack', {
              date: formatInstrumentDay(instrument.expectedBackOn),
            })
          : null,
        instrument.outOfServiceBy
          ? t('library.instruments.outOfService.markedBy', {
              name: names.userLabel(instrument.outOfServiceBy),
            })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    </Notice>
  )
}

function useServiceStateMutation(
  instrument: InstrumentRow,
  onDone: () => void,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      outOfService: boolean
      reason?: string
      expectedBackOn?: string
      workDone?: string
    }) => setInstrumentOutOfService({ instrumentId: instrument.id, ...input }),
    onSuccess: (_row, input) => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'instruments'],
      })
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'schedule'] })
      onDone()
      toast(
        input.outOfService
          ? t('library.instruments.outOfService.markedDown', {
              name: instrument.name,
            })
          : t('library.instruments.outOfService.markedUp', {
              name: instrument.name,
            }),
      )
    },
    onError: (error) => {
      toast.error(t('library.instruments.outOfService.couldNotChange'), {
        description: error instanceof Error ? error.message : undefined,
      })
    },
  })
}

/** Mark an instrument down: what is wrong, and when it should be back. */
export function MarkOutOfServiceDialog({
  instrument,
  open,
  onOpenChange,
}: {
  instrument: InstrumentRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [reason, setReason] = useState('')
  const [expected, setExpected] = useState('')

  const mutation = useServiceStateMutation(instrument, () => {
    onOpenChange(false)
    setReason('')
    setExpected('')
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.instruments.outOfService.downDialogTitle', {
            name: instrument.name,
          })}
          description={t(
            'library.instruments.outOfService.downDialogDescription',
          )}
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Field
              label={t('library.instruments.outOfService.reason')}
              required
            >
              <Textarea
                value={reason}
                maxLength={1000}
                placeholder={t(
                  'library.instruments.outOfService.reasonPlaceholder',
                )}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Field
              label={t('library.instruments.outOfService.expectedBackOn')}
              hint={t('library.instruments.outOfService.optional')}
            >
              <Input
                type="date"
                value={expected}
                min={isoDay()}
                onChange={(e) => setExpected(e.target.value)}
              />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!reason.trim() || mutation.isPending}
            onClick={() =>
              mutation.mutate({
                outOfService: true,
                reason: reason.trim(),
                expectedBackOn: expected || undefined,
              })
            }
          >
            {mutation.isPending
              ? t('library.instruments.outOfService.marking')
              : t('library.instruments.outOfService.confirmDown')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Put an instrument back in service, optionally logging the repair that fixed it. */
export function BackInServiceDialog({
  instrument,
  open,
  onOpenChange,
}: {
  instrument: InstrumentRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [work, setWork] = useState('')

  const mutation = useServiceStateMutation(instrument, () => {
    void queryClient.invalidateQueries({
      queryKey: instrumentQueryKeys.serviceLog(instrument.id),
    })
    onOpenChange(false)
    setWork('')
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.instruments.outOfService.upDialogTitle', {
            name: instrument.name,
          })}
          description={t(
            'library.instruments.outOfService.upDialogDescription',
          )}
        />
        <DialogBody>
          <Field
            label={t('library.instruments.outOfService.workDone')}
            hint={t('library.instruments.outOfService.workDoneHint')}
          >
            <Textarea
              value={work}
              maxLength={300}
              placeholder={t(
                'library.instruments.outOfService.workDonePlaceholder',
              )}
              onChange={(e) => setWork(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({
                outOfService: false,
                workDone: work.trim() || undefined,
              })
            }
          >
            {mutation.isPending
              ? t('library.instruments.outOfService.marking')
              : t('library.instruments.outOfService.confirmUp')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LogVisitDialog({
  instrument,
  open,
  onOpenChange,
}: {
  instrument: InstrumentRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<ServiceKind>('service')
  const [visitedOn, setVisitedOn] = useState(() => isoDay())
  const [summary, setSummary] = useState('')
  const [performedBy, setPerformedBy] = useState('')
  const [details, setDetails] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      logInstrumentService({
        instrumentId: instrument.id,
        kind,
        visitedOn,
        summary: summary.trim(),
        performedBy: performedBy.trim() || null,
        details: details.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: instrumentQueryKeys.serviceLog(instrument.id),
      })
      onOpenChange(false)
      setSummary('')
      setPerformedBy('')
      setDetails('')
      toast(t('library.instruments.serviceLog.logged'))
    },
    onError: (error) => {
      toast.error(t('library.instruments.serviceLog.couldNotLog'), {
        description: error instanceof Error ? error.message : undefined,
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.instruments.serviceLog.dialogTitle')}
          description={t('library.instruments.serviceLog.dialogDescription', {
            name: instrument.name,
          })}
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('library.instruments.serviceLog.kind')} required>
                <Select
                  value={kind}
                  onChange={(event) => {
                    const selected = SERVICE_KINDS.find(
                      (entry) => entry === event.target.value,
                    )

                    if (selected) setKind(selected)
                  }}
                >
                  {SERVICE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('library.instruments.serviceLog.visitedOn')}
                required
              >
                <Input
                  type="date"
                  value={visitedOn}
                  max={isoDay()}
                  onChange={(e) => setVisitedOn(e.target.value)}
                />
              </Field>
            </div>
            <Field label={t('library.instruments.serviceLog.summary')} required>
              <Input
                value={summary}
                maxLength={300}
                placeholder={t(
                  'library.instruments.serviceLog.summaryPlaceholder',
                )}
                onChange={(e) => setSummary(e.target.value)}
              />
            </Field>
            <Field
              label={t('library.instruments.serviceLog.performedBy')}
              hint={t('library.instruments.outOfService.optional')}
            >
              <Input
                value={performedBy}
                maxLength={200}
                placeholder={t(
                  'library.instruments.serviceLog.performedByPlaceholder',
                )}
                onChange={(e) => setPerformedBy(e.target.value)}
              />
            </Field>
            <Field
              label={t('library.instruments.serviceLog.details')}
              hint={t('library.instruments.outOfService.optional')}
            >
              <Textarea
                value={details}
                maxLength={4000}
                placeholder={t(
                  'library.instruments.serviceLog.detailsPlaceholder',
                )}
                onChange={(e) => setDetails(e.target.value)}
              />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!summary.trim() || !visitedOn || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? t('library.instruments.serviceLog.saving')
              : t('library.instruments.serviceLog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The instrument's repairs and service visits, as a table. */
export function ServiceLogSection({
  instrument,
  canLog,
  names,
}: {
  instrument: InstrumentRow
  canLog: boolean
  names: { userLabel: (id: string) => string }
}) {
  const log = useInstrumentServiceLog(instrument.id)
  const [open, setOpen] = useState(false)
  const rows = log.data ?? []

  const columns: RegistryColumn<ServiceLogRow>[] = [
    {
      id: 'date',
      header: t('library.instruments.serviceLog.date'),
      cell: ({ row }) => (
        <span className="mono">
          {formatInstrumentDay(row.original.visitedOn)}
        </span>
      ),
    },
    {
      id: 'kind',
      header: t('library.instruments.serviceLog.kind'),
      cell: ({ row }) => kindLabel(row.original.kind),
    },
    {
      id: 'summary',
      header: t('library.instruments.serviceLog.whatWasDone'),
      cell: ({ row }) => (
        <span title={row.original.details ?? undefined}>
          {row.original.summary}
        </span>
      ),
    },
    {
      id: 'doneBy',
      header: t('library.instruments.serviceLog.doneBy'),
      cell: ({ row }) => row.original.performedBy ?? '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'loggedBy',
      header: t('library.instruments.serviceLog.loggedBy'),
      cell: ({ row }) =>
        row.original.loggedBy ? names.userLabel(row.original.loggedBy) : '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
  ]

  return (
    <Section
      className="border-t border-border pt-4"
      title={t('library.instruments.serviceLog.title')}
      action={
        canLog ? (
          <Button size="sm" icon="plus" onClick={() => setOpen(true)}>
            {t('library.instruments.serviceLog.logVisit')}
          </Button>
        ) : undefined
      }
    >
      {rows.length ? (
        <TableBox>
          <RegistryGrid
            label={t('library.instruments.serviceLog.tableLabel')}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <Muted>{t('library.instruments.serviceLog.empty')}</Muted>
      )}
      <LogVisitDialog
        instrument={instrument}
        open={open}
        onOpenChange={setOpen}
      />
    </Section>
  )
}
