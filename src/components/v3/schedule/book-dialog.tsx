import { useState } from 'react'

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
import { bookInstrument } from './schedule-data'
import type { ScheduleBooking, ScheduleInstrument } from './schedule-data'

/**
 * WORK-04.2 — the book-instrument dialog (DialogsRecord).
 *
 * It collects the instrument, a label and a time range and submits through the
 * canonical `create_booking` RPC. Availability, qualification and calibration
 * stay the server's authority: the dialog never pre-filters a resource with a
 * second availability or qualification model, it surfaces the server's refusal
 * (SB020 clash, SB115 unqualified, SB116 calibration overdue).
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
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!workspaceId) return
    if (!resourceId || !title.trim()) {
      setError('Choose an instrument and give the booking a title.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const booking = await bookInstrument({
        workspaceId,
        resourceId,
        title: title.trim(),
        startsAt: `${date}T${start}:00.000Z`,
        endsAt: `${date}T${end}:00.000Z`,
        timezone: 'UTC',
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
                  {i.name}
                </option>
              ))}
            </NativeSelect>
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
