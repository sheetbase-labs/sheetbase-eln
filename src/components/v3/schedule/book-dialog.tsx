import { useEffect, useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { NativeSelect } from '#/components/v3/projects/select'
import { describeCalendarError } from '#/lib/calendar'
import { fetchWorkspaceGeneral } from '#/lib/workspace-general'
import { bookInstrument } from './schedule-data'
import type { ScheduleBooking, ScheduleInstrument } from './schedule-data'

/** The wall-clock a new booking starts from. */
const DEFAULT_START = '09:00'
const DEFAULT_END = '10:00'

/**
 * The workspace's IANA time zone — the wall clock a booking is made in. Home
 * renders the same bookings in it, so a booking written in another zone shows a
 * different time there. `null` when the setting cannot be read or resolved: the
 * dialog then refuses the booking rather than writing an instant the person did
 * not ask for.
 */
async function workspaceTimezone(): Promise<string | null> {
  try {
    const zone = (await fetchWorkspaceGeneral())?.timezone
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
function instantInZone(
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
}

export function BookDialog({
  instruments,
  defaultDate,
  workspaceId,
  onBooked,
}: BookingDialogProps) {
  const [open, setOpen] = useState(false)
  const [resourceId, setResourceId] = useState('')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [start, setStart] = useState(DEFAULT_START)
  const [end, setEnd] = useState(DEFAULT_END)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The dialog's times belong to one booking: closing it restores the
  // wall-clock defaults, and the date follows the view's anchor, so the next
  // booking starts from the day the person is looking at rather than from
  // whatever the last one left behind.
  useEffect(() => {
    if (open) return
    setDate(defaultDate)
    setStart(DEFAULT_START)
    setEnd(DEFAULT_END)
  }, [open, defaultDate])

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
      // what that wall clock means, and it is recorded with the booking.
      const timezone = await workspaceTimezone()
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
      })
      onBooked(booking)
      setOpen(false)
      setTitle('')
      setResourceId('')
    } catch (e) {
      // The server owns clash, qualification and calibration decisions; show
      // its reason rather than guessing at availability in the dialog.
      setError(describeCalendarError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        className="ml-2 max-md:ml-0 max-md:h-11 max-md:w-full"
        onClick={() => setOpen(true)}
      >
        Book instrument
      </Button>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader title="Book an instrument" />
        <DialogBody>
          <Field label="Instrument" required>
            <NativeSelect
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
            >
              <option value="">Choose…</option>
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.displayId ? `${i.displayId} · ${i.name}` : i.name}
                </option>
              ))}
            </NativeSelect>
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
          {error ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {error}
            </p>
          ) : null}
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
