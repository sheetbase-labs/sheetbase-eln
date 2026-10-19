import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { describeCalendarError, editBooking } from '#/lib/calendar'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

import { instantInZone } from './book-dialog'
import { toScheduleBooking } from './schedule-data'
import type { BookableSample, ScheduleBooking } from './schedule-data'

/**
 * Change a booking: what it is for, when, and its notes. The instrument stays
 * (moving a run to another instrument is a new booking), the time is read in
 * the booking's own zone, and the server decides clashes and stale edits —
 * its reason is shown as it is.
 */
export function EditBookingDialog({
  booking,
  sampleOptions = [],
  currentSampleIds = [],
  client = notebookDataClient,
  onSaved,
  onClose,
}: {
  booking: ScheduleBooking
  /** Samples that can be named on the booking (the experiment's, plus its own). */
  sampleOptions?: BookableSample[]
  /** The samples the booking names now; these start ticked. */
  currentSampleIds?: string[]
  client?: DataClient
  onSaved: (booking: ScheduleBooking) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(booking.title)
  const [date, setDate] = useState(booking.date)
  const [start, setStart] = useState(booking.start)
  const [end, setEnd] = useState(booking.end)
  const [notes, setNotes] = useState(booking.notes ?? '')
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    new Set(currentSampleIds),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const startsAt = instantInZone(date, start, booking.timezone)
    const endsAt = instantInZone(date, end, booking.timezone)
    if (!title.trim()) {
      setError('Give the booking a title.')
      return
    }
    if (!startsAt || !endsAt) {
      setError('Choose the date, a start time and an end time.')
      return
    }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      setError('The end time must be after the start time.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const wire = await editBooking(client, {
        bookingId: booking.id,
        title: title.trim(),
        startsAt,
        endsAt,
        timezone: booking.timezone,
        notes: notes.trim() || null,
        expectedMetadataVersion: booking.metadataVersion,
        // Only send the samples when the person had a choice to make.
        samples: sampleOptions.length
          ? sampleOptions
              .filter((sample) => ticked.has(sample.id))
              .map((sample) => ({
                sampleRecordId: sample.id,
                sampleIdentifier: sample.identifier,
                sampleTitle: sample.title,
              }))
          : undefined,
      })
      onSaved(toScheduleBooking(wire))
    } catch (cause) {
      setError(describeCalendarError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader title="Edit booking" />
        <DialogBody>
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
          <p role="note" className="m-0 text-label text-fg-muted">
            Times are in the booking’s time zone, {booking.timezone}.
          </p>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
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
                    checked={ticked.has(sample.id)}
                    onCheckedChange={(checked) =>
                      setTicked((current) => {
                        const next = new Set(current)
                        if (checked) next.add(sample.id)
                        else next.delete(sample.id)
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
          {error ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
