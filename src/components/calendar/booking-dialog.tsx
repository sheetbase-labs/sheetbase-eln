/**
 * OPS-004 — Create / edit booking dialog. Collects title, resource, status,
 * time range, timezone, location, notes and linked experiment. The caller
 * drives the RPC; this component validates locally and reports server errors.
 */
import { useEffect, useState } from 'react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '#/components/ui'
import { BOOKING_COLOR_OPTIONS } from '#/lib/calendar'
import type {
  CalendarBooking,
  CalendarBookingInput,
  CalendarResource,
} from '#/lib/calendar'

export interface BookingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  resources: CalendarResource[]
  workspaceId: string
  /** When editing, the existing booking. */
  booking: CalendarBooking | null
  /** Default start/end when creating a new booking. */
  defaultStart?: string
  defaultEnd?: string
  defaultResourceId?: string
  onSubmit: (input: CalendarBookingInput) => Promise<void>
  error: string | null
}

function toLocalInput(iso: string): string {
  // Convert an ISO instant to the value an <input type="datetime-local">
  // expects (local wall time, no offset).
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(local: string): string {
  return new Date(local).toISOString()
}

export function BookingDialog({
  open,
  onOpenChange,
  resources,
  booking,
  defaultStart,
  defaultEnd,
  defaultResourceId,
  onSubmit,
  error,
}: BookingDialogProps) {
  const [title, setTitle] = useState('')
  const [resourceId, setResourceId] = useState('')
  const [status, setStatus] = useState<'tentative' | 'confirmed'>('tentative')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [location, setLocation] = useState('')
  const [color, setColor] = useState('blue')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (booking) {
      setTitle(booking.title)
      setResourceId(booking.resourceId)
      setStatus(booking.status === 'confirmed' ? 'confirmed' : 'tentative')
      setStartsAt(toLocalInput(booking.startsAt))
      setEndsAt(toLocalInput(booking.endsAt))
      setLocation(booking.location ?? '')
      setColor(booking.color ?? 'blue')
      setNotes(booking.notes ?? '')
    } else {
      setTitle('')
      setResourceId(
        defaultResourceId ?? (resources.length > 0 ? resources[0].id : ''),
      )
      setStatus('tentative')
      setStartsAt(
        defaultStart
          ? toLocalInput(defaultStart)
          : toLocalInput(new Date().toISOString()),
      )
      setEndsAt(
        defaultEnd
          ? toLocalInput(defaultEnd)
          : toLocalInput(new Date(Date.now() + 3_600_000).toISOString()),
      )
      setLocation('')
      setColor('blue')
      setNotes('')
    }
  }, [open, booking, defaultResourceId, defaultStart, defaultEnd, resources])

  const canSubmit =
    title.trim().length > 0 &&
    resourceId.length > 0 &&
    startsAt.length > 0 &&
    endsAt.length > 0 &&
    new Date(endsAt) > new Date(startsAt)

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit({
        resourceId,
        title: title.trim(),
        startsAt: fromLocalInput(startsAt),
        endsAt: fromLocalInput(endsAt),
        status,
        location: location.trim() || null,
        color,
        notes: notes.trim() || null,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{booking ? 'Edit booking' : 'New booking'}</DialogTitle>
          <DialogDescription>
            {booking
              ? 'Update the booking details. Overlapping time ranges are rejected.'
              : 'Book a resource. Overlapping time ranges are rejected transactionally.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="booking-title">Title</Label>
            <Input
              id="booking-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. qPCR Run - Titration Assay"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="booking-resource">Resource</Label>
              <Select
                id="booking-resource"
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
              >
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="booking-status">Status</Label>
              <Select
                id="booking-status"
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as 'tentative' | 'confirmed')
                }
              >
                <option value="tentative">Tentative</option>
                <option value="confirmed">Confirmed</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="booking-start">Start</Label>
              <Input
                id="booking-start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="booking-end">End</Label>
              <Input
                id="booking-end"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="booking-location">Location</Label>
              <Input
                id="booking-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Lab A"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="booking-color">Colour</Label>
              <Select
                id="booking-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              >
                {BOOKING_COLOR_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c[0].toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="booking-notes">Notes</Label>
            <Textarea
              id="booking-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add notes for participants…"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting
              ? 'Saving…'
              : booking
                ? 'Save changes'
                : 'Create booking'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
