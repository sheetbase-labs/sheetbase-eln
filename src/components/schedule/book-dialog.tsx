import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Link } from '@tanstack/react-router'

import { RequestQualificationButton } from '#/components/instruments/request-qualification-button'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { ObjectLink } from '#/components/ui/object-link'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { RepeatFields } from '#/components/recurring/repeat-fields'
import { fetchTrainingGaps } from '#/lib/booking-rules'
import { describeCalendarError } from '#/lib/calendar'
import { DataClientError } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  NO_REPEAT,
  createRepeat,
  repeatFormError,
  repeatFormToRule,
} from '#/lib/recurring'
import type { RepeatForm } from '#/lib/recurring'
import { t } from '#/copy'
import { bookInstrument } from './schedule-data'
import type {
  BookableSample,
  ScheduleBooking,
  ScheduleInstrument,
} from './schedule-data'
import { instantInZone, workspaceTimezone } from './booking-time'

/** The wall-clock a new booking starts from. */
const DEFAULT_START = '09:00'
const DEFAULT_END = '10:00'

/**
 * WORK-04.2 — the book-instrument dialog (DialogsRecord).
 *
 * It offers the workspace's instruments (INS display id and name — ADR-0054
 * makes the instrument the subject of a booking, so the picker reads the
 * registry), collects a label and a time range, and submits through the
 * canonical `create_booking` RPC with the instrument id as `resource_id`.
 * Availability, qualification and calibration stay the server's authority: the
 * dialog never pre-filters an instrument with a second availability or
 * qualification model, it surfaces the server's refusal (SB020 clash, SB115
 * unqualified, SB116 calibration overdue).
 */
export interface BookingDialogProps {
  instruments: ScheduleInstrument[]
  defaultDate: string
  workspaceId: string | undefined
  onBooked: (booking: ScheduleBooking) => void
  /** Preselects an instrument, e.g. a deep link from the instrument registry. */
  defaultResourceId?: string
  /** Opens the dialog on mount, e.g. a deep link that asks to book. */
  defaultOpen?: boolean
  /** A title to start from, e.g. the experiment the booking is for. */
  defaultTitle?: string
  /** The experiment the booking is for; the booking then carries it. */
  experiment?: {
    id: string
    identifier: string
    title: string
    projectId?: string | null
  }
  /** Samples the booking can name (the experiment's), all ticked to start. */
  sampleOptions?: BookableSample[]
  /** Called when the person dismisses the dialog without booking. */
  onCancel?: () => void
  /** Called after a repeating booking is set up, with what was made now. */
  onRepeated?: (made: Awaited<ReturnType<typeof createRepeat>>) => void
}

export function BookDialog({
  instruments,
  defaultDate,
  workspaceId,
  onBooked,
  defaultResourceId,
  defaultOpen,
  defaultTitle,
  experiment,
  sampleOptions = [],
  onCancel,
  onRepeated,
}: BookingDialogProps) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [resourceId, setResourceId] = useState(defaultResourceId ?? '')
  // The default may arrive after the dialog opens (it is read from the record),
  // so it is the value until the person types something of their own.
  const [typedTitle, setTitle] = useState<string | null>(null)
  const title = typedTitle ?? defaultTitle ?? ''
  // Samples start ticked: an experiment's booking is for the samples it uses,
  // so the person unticks what the run does not need.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set())

  const chosenSamples = sampleOptions.filter(
    (sample) => !unticked.has(sample.id),
  )

  const [date, setDate] = useState(defaultDate)
  const [start, setStart] = useState(DEFAULT_START)
  const [end, setEnd] = useState(DEFAULT_END)
  const [repeat, setRepeat] = useState<RepeatForm>(NO_REPEAT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // SB115/SB116 name an instrument the person can act on, so they carry a link.
  const [refusal, setRefusal] = useState<{
    code: 'SB115' | 'SB116'
    instrument: ScheduleInstrument
  } | null>(null)

  // The zone a booking's wall clock means. Resolved once per opening and shown
  // in the dialog so the person can see which clock From/To are read against;
  // the same promise is what submit awaits, so the label cannot disagree with
  // the instant that is written.
  const zonePromise = useRef<Promise<string | null> | null>(null)
  const [timeZone, setTimeZone] = useState<string | null>(null)

  // The dialog's times belong to one booking: opening it restores the
  // wall-clock defaults, and the date follows the view's anchor, so the next
  // booking starts from the day the person is looking at rather than from
  // whatever the last one left behind. The instrument resets to any preset the
  // opener supplied, so a deep link keeps its selection across a cancel.
  const changeOpen = (next: boolean) => {
    if (next) {
      setDate(defaultDate)
      setStart(DEFAULT_START)
      setEnd(DEFAULT_END)
      setRepeat(NO_REPEAT)
      setResourceId(defaultResourceId ?? '')
    }

    setOpen(next)
  }

  useEffect(() => {
    if (!open) {
      zonePromise.current = null
      setTimeZone(null)

      return
    }

    const promise = workspaceTimezone()
    zonePromise.current = promise
    let cancelled = false
    void promise.then((zone) => {
      if (!cancelled) setTimeZone(zone)
    })

    return () => {
      cancelled = true
    }
  }, [open])

  const submit = async () => {
    if (!workspaceId) return

    if (!resourceId || !title.trim()) {
      setError(t('projects.bookDialog.errors.missing'))

      return
    }

    setBusy(true)
    setError(null)

    try {
      // The person enters a wall clock, not an instant: the workspace's zone is
      // what that wall clock means, and it is recorded with the booking. This
      // is the same read the dialog showed, so the label cannot disagree with
      // the instant that is written.
      const timezone = await (zonePromise.current ?? workspaceTimezone())

      if (!timezone) {
        setError(t('projects.bookDialog.errors.zone'))

        return
      }

      const startsAt = instantInZone(date, start, timezone)
      const endsAt = instantInZone(date, end, timezone)

      if (!startsAt || !endsAt) {
        setError(t('projects.bookDialog.errors.when'))

        return
      }

      if (Date.parse(endsAt) <= Date.parse(startsAt)) {
        setError(t('projects.bookDialog.errors.order'))

        return
      }

      if (repeat.frequency !== 'none') {
        const problem = repeatFormError(repeat, date)

        if (problem) {
          setError(problem)

          return
        }

        const made = await createRepeat(notebookDataClient, {
          kind: 'booking',
          title: title.trim(),
          startsOn: date,
          timezone,
          resourceId,
          startTime: start,
          endTime: end,
          projectId: null,
          ...repeatFormToRule(repeat),
        })

        onRepeated?.(made)
        setOpen(false)
        setTitle('')
        setResourceId('')

        return
      }

      const booking = await bookInstrument({
        workspaceId,
        resourceId,
        title: title.trim(),
        startsAt,
        endsAt,
        timezone,
        linkedExperimentRecordId: experiment?.id,
        projectId: experiment?.projectId,
        samples: chosenSamples,
      })

      onBooked(booking)
      setOpen(false)
      setTitle('')
      setResourceId('')
      setUnticked(new Set())
    } catch (e) {
      // The server owns clash, qualification and calibration decisions; show
      // its reason rather than guessing at availability in the dialog.
      const code = e instanceof DataClientError ? e.code : null
      const instrument = instruments.find((item) => item.id === resourceId)

      if (instrument && (code === 'SB115' || code === 'SB116')) {
        setRefusal({ code, instrument })
        setError(null)
      } else {
        setRefusal(null)
        setError(describeCalendarError(e))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        changeOpen(next)

        if (!next) onCancel?.()
      }}
    >
      <Button
        className="ml-2 max-md:ml-0 max-md:w-full"
        onClick={() => changeOpen(true)}
      >
        {t('projects.bookInstrument.label')}
      </Button>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader title={t('projects.bookDialog.title')} />
        <DialogBody>
          <Field label={t('projects.bookDialog.instrument')} required>
            <PickerSelect
              noun="instrument"
              value={resourceId}
              onChange={(id) => setResourceId(id)}
              options={instruments.map((i) => ({
                id: i.id,
                identifier: i.displayId ?? undefined,
                label: i.name,
                disabled: i.outOfService,
                disabledReason: i.outOfService
                  ? t('library.instruments.outOfService.status')
                  : undefined,
              }))}
            />
            <TrainingNotice instrumentId={resourceId} />
            {instruments.length === 0 ? (
              // A picker with nothing in it is a dead end; say what is missing
              // rather than leaving "Choose…" as the only option.
              <p className="m-0 text-label text-fg-muted">
                {t('projects.bookDialog.noInstruments')}
              </p>
            ) : null}
          </Field>
          <Field label={t('projects.bookDialog.what')} required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          {experiment ? (
            <div className="flex flex-col gap-1 text-label">
              <span className="font-medium text-fg">
                {t('projects.bookDialog.forExperiment')}
              </span>
              <span className="text-body">
                <ObjectLink
                  kind="experiment"
                  id={experiment.id}
                  identifier={experiment.identifier}
                />{' '}
                {experiment.title}
              </span>
            </div>
          ) : null}
          {sampleOptions.length ? (
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="mb-1 p-0 text-label font-medium text-fg">
                {t('projects.bookDialog.samples')}
              </legend>
              {sampleOptions.map((sample) => (
                <label
                  key={sample.id}
                  className="flex items-center gap-2 text-body"
                >
                  <Checkbox
                    checked={!unticked.has(sample.id)}
                    onCheckedChange={(checked) =>
                      setUnticked((current) => {
                        const next = new Set(current)

                        if (checked) next.delete(sample.id)
                        else next.add(sample.id)

                        return next
                      })
                    }
                  />
                  <span className="mono text-fg-muted">
                    {sample.identifier}
                  </span>
                  <span className="min-w-0 truncate">{sample.title}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <Field label={t('projects.bookDialog.date')} required>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('projects.bookDialog.from')} required>
              <Input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label={t('projects.bookDialog.to')} required>
              <Input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>
          {experiment ? null : (
            <RepeatFields value={repeat} onChange={setRepeat} firstDay={date} />
          )}
          {/* The wall clock the person types is read in one zone; name it so
              10:00 cannot be misread as their own clock. */}
          <p role="note" className="m-0 text-label text-fg-muted">
            {timeZone
              ? t('projects.bookDialog.zoneNamed', { zone: timeZone })
              : t('projects.bookDialog.zone')}
            {repeat.frequency === 'none' ? null : (
              <> {t('projects.recurring.booking.note')}</>
            )}
          </p>
          {error ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {error}
            </p>
          ) : null}
          {refusal ? <BookingRefusal {...refusal} /> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button variant="primary" disabled={busy} onClick={submit}>
            {busy
              ? t('projects.bookDialog.booking')
              : t('projects.bookDialog.book')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The two instrument rules the server enforces at booking time, in plain words,
 * with the one place each is resolved. The server stays the authority; this only
 * says what its refusal means and where to go.
 */
function BookingRefusal({
  code,
  instrument,
}: {
  code: 'SB115' | 'SB116'
  instrument: ScheduleInstrument
}) {
  const qualification = code === 'SB115'

  return (
    <div role="alert" className="flex flex-col gap-1.5">
      <p className="m-0 text-label text-danger-text">
        {qualification
          ? t('projects.bookDialog.refusal.unqualified', {
              name: instrument.name,
            })
          : t('projects.bookDialog.refusal.calibration', {
              name: instrument.name,
            })}{' '}
        <Link
          to="/instruments/$instrumentId"
          params={{ instrumentId: instrument.id }}
          search={qualification ? undefined : { record: '1' }}
          className="underline"
        >
          {qualification
            ? t('projects.bookDialog.refusal.open')
            : t('projects.bookDialog.refusal.record')}
        </Link>
      </p>
      {qualification ? (
        <div>
          <RequestQualificationButton
            instrumentId={instrument.id}
            instrumentName={instrument.name}
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * Before someone tries: the procedures this instrument asks for that they have
 * not been trained on. The server still decides when they book.
 */
function TrainingNotice({ instrumentId }: { instrumentId: string }) {
  const gaps = useQuery({
    queryKey: ['booking-rules', 'gaps', instrumentId],
    queryFn: () => fetchTrainingGaps(notebookDataClient, instrumentId),
    enabled: instrumentId !== '',
    staleTime: 15_000,
  })

  if (!gaps.data || gaps.data.length === 0) return null

  return (
    <div
      role="status"
      className="flex flex-col gap-1 text-label text-warning-text"
    >
      <p className="m-0">{t('library.instruments.bookingRules.notTrained')}</p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {gaps.data.map((gap) => (
          <li key={gap.protocol_record_id}>
            <Link
              to="/protocols/$protocolId"
              params={{ protocolId: gap.protocol_record_id }}
              className="underline"
            >
              <span className="mono">{gap.identifier}</span> {gap.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
