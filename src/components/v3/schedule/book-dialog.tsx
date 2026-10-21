import { useEffect, useRef, useState } from 'react'

import { Link } from '@tanstack/react-router'

import { RequestQualificationButton } from '#/components/v3/instruments/request-qualification-button'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Field, Input } from '#/components/v3/ui/input'
import { ObjectLink } from '#/components/v3/ui/object-link'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Select } from '#/components/v3/ui/select'
import { describeCalendarError } from '#/lib/calendar'
import { DataClientError } from '#/lib/data-client'
import { fetchWorkspaceGeneral } from '#/lib/workspace-general'
import { getDisplayTimeZone } from '#/lib/display-time-zone'
import { bookInstrument } from './schedule-data'
import type {
  BookableSample,
  ScheduleBooking,
  ScheduleInstrument,
} from './schedule-data'

/** The wall-clock a new booking starts from. */
const DEFAULT_START = '09:00'
const DEFAULT_END = '10:00'

/**
 * The IANA time zone a booking is made in — the person's own, else the
 * workspace's. Schedule and Home render bookings on the same clock, so a
 * booking written in another zone would show a different time there. `null` when the setting cannot be read or resolved: the
 * dialog then refuses the booking rather than writing an instant the person did
 * not ask for.
 */
async function workspaceTimezone(): Promise<string | null> {
  try {
    const zone =
      getDisplayTimeZone() ?? (await fetchWorkspaceGeneral())?.timezone
    if (!zone) return null
    // Resolving the name proves the platform can read it; a name it cannot read
    // would make every conversion silently wrong.
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return null
  }
}

/**
 * The UTC instant for a wall-clock date and time in an IANA zone. `Intl` turns
 * an instant into a zone but cannot invert, so the zone's offset is read at the
 * naive instant and re-read at the result: the second pass settles the answer
 * across a DST boundary. `null` when the date or time is not one.
 */
export function instantInZone(
  date: string,
  time: string,
  timeZone: string,
): string | null {
  const naiveMs = Date.parse(`${date}T${time}:00.000Z`)
  if (Number.isNaN(naiveMs)) return null
  let instant = new Date(naiveMs)
  for (let pass = 0; pass < 2; pass += 1) {
    instant = new Date(naiveMs - wallClockOffsetMs(instant, timeZone))
  }
  return instant.toISOString()
}

/** Offset (ms) of the timezone at the given UTC instant. */
function wallClockOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const wallMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  )
  return wallMs - instant.getTime()
}

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
}: BookingDialogProps) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [resourceId, setResourceId] = useState(defaultResourceId ?? '')
  const [title, setTitle] = useState(defaultTitle ?? '')
  // The default may arrive after the dialog opens (it is read from the record);
  // it fills an empty title and never overwrites what the person typed.
  useEffect(() => {
    if (defaultTitle) setTitle((current) => current || defaultTitle)
  }, [defaultTitle])
  // Samples start ticked: an experiment's booking is for the samples it uses,
  // so the person unticks what the run does not need.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set())
  const chosenSamples = sampleOptions.filter(
    (sample) => !unticked.has(sample.id),
  )
  const [date, setDate] = useState(defaultDate)
  const [start, setStart] = useState(DEFAULT_START)
  const [end, setEnd] = useState(DEFAULT_END)
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

  // The dialog's times belong to one booking: closing it restores the
  // wall-clock defaults, and the date follows the view's anchor, so the next
  // booking starts from the day the person is looking at rather than from
  // whatever the last one left behind. The instrument resets to any preset the
  // opener supplied, so a deep link keeps its selection across a cancel.
  useEffect(() => {
    if (open) return
    setDate(defaultDate)
    setStart(DEFAULT_START)
    setEnd(DEFAULT_END)
    setResourceId(defaultResourceId ?? '')
  }, [open, defaultDate, defaultResourceId])

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
      setError('Choose an instrument and give the booking a title.')
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
        setError(
          'The workspace time zone could not be read, so the booking was not created. Try again.',
        )
        return
      }
      const startsAt = instantInZone(date, start, timezone)
      const endsAt = instantInZone(date, end, timezone)
      if (!startsAt || !endsAt) {
        setError('Choose the date, a start time and an end time.')
        return
      }
      if (Date.parse(endsAt) <= Date.parse(startsAt)) {
        setError('The end time must be after the start time.')
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
        setOpen(next)
        if (!next) onCancel?.()
      }}
    >
      <Button
        className="ml-2 max-md:ml-0 max-md:w-full"
        onClick={() => setOpen(true)}
      >
        Book instrument
      </Button>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader title="Book an instrument" />
        <DialogBody>
          <Field label="Instrument" required>
            <Select
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
            >
              <option value="">Choose…</option>
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.displayId ? `${i.displayId} · ${i.name}` : i.name}
                </option>
              ))}
            </Select>
            {instruments.length === 0 ? (
              // A picker with nothing in it is a dead end; say what is missing
              // rather than leaving "Choose…" as the only option.
              <p className="m-0 text-label text-fg-muted">
                No instruments are registered in this workspace yet, so there is
                nothing to book. Add one in the registry first.
              </p>
            ) : null}
          </Field>
          <Field label="What" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          {experiment ? (
            <div className="flex flex-col gap-1 text-label">
              <span className="font-medium text-fg">For experiment</span>
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
                Samples this run uses
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
          <Field label="Date" required>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" required>
              <Input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="To" required>
              <Input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>
          {/* The wall clock the person types is read in one zone; name it so
              10:00 cannot be misread as their own clock. */}
          <p role="note" className="m-0 text-label text-fg-muted">
            {timeZone
              ? `Times are interpreted in the workspace time zone, ${timeZone}.`
              : 'Times are interpreted in the workspace time zone.'}
          </p>
          {error ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {error}
            </p>
          ) : null}
          {refusal ? <BookingRefusal {...refusal} /> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary" disabled={busy} onClick={submit}>
            {busy ? 'Booking…' : 'Book'}
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
          ? `You are not qualified to run ${instrument.name}. A workspace owner can grant that on the instrument record.`
          : `${instrument.name}’s calibration is overdue, so it can’t be booked until a new calibration is recorded.`}{' '}
        <Link
          to="/instruments/$instrumentId"
          params={{ instrumentId: instrument.id }}
          search={qualification ? undefined : { record: '1' }}
          className="underline"
        >
          {qualification ? 'Open the instrument' : 'Record the calibration'}
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
