/**
 * OPS-004 — Booking inspector. Shows the selected booking's details,
 * participants, linked experiment, required samples, notes and the
 * Edit / Duplicate / Cancel actions. Mirrors the mockup right detail panel.
 */
import {
  CalendarClock,
  Copy,
  FileText,
  FlaskRound,
  MapPin,
  Pencil,
  Trash2,
  Users,
  X,
} from 'lucide-react'

import { Badge, Button, Separator } from '#/components/ui'
import { formatLongDateInZone, formatTimeInZone } from '#/lib/calendar'
import type {
  CalendarBooking,
  CalendarBookingParticipant,
  CalendarBookingSample,
  CalendarResource,
} from '#/lib/calendar'

export interface CalendarInspectorProps {
  booking: CalendarBooking | null
  resource: CalendarResource | null
  timeZone: string
  onEdit: (booking: CalendarBooking) => void
  onDuplicate: (booking: CalendarBooking) => void
  onCancel: (booking: CalendarBooking) => void
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger'> = {
  confirmed: 'success',
  tentative: 'warning',
  cancelled: 'danger',
}

function SectionHeading({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </div>
  )
}

function ParticipantRow({
  participant,
}: {
  participant: CalendarBookingParticipant
}) {
  const name = participant.displayName ?? participant.userId ?? 'Unknown'
  const initials = name.slice(0, 2).toUpperCase()
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary"
      >
        {initials}
      </span>
      <span className="flex-1 truncate text-sm">{name}</span>
      <Badge variant={participant.role === 'owner' ? 'info' : 'secondary'}>
        {participant.role === 'owner' ? 'Owner' : 'Participant'}
      </Badge>
    </div>
  )
}

function SampleRow({ sample }: { sample: CalendarBookingSample }) {
  return (
    <li className="text-sm">
      <span className="font-medium">
        {sample.sampleIdentifier ?? 'Unnamed sample'}
      </span>
      {sample.sampleTitle ? (
        <span className="text-muted-foreground"> — {sample.sampleTitle}</span>
      ) : null}
      {sample.quantityValue != null ? (
        <span className="ml-2 text-muted-foreground">
          ({sample.quantityValue}
          {sample.quantityUnit ? ` ${sample.quantityUnit}` : ''})
        </span>
      ) : null}
    </li>
  )
}

export function CalendarInspector({
  booking,
  resource,
  timeZone,
  onEdit,
  onDuplicate,
  onCancel,
}: CalendarInspectorProps) {
  if (!booking) {
    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No booking selected</p>
        <p>
          Select a booking in the calendar to see details, participants and
          actions.
        </p>
      </div>
    )
  }

  const start = new Date(booking.startsAt)
  const end = new Date(booking.endsAt)

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold leading-tight">
            {booking.title}
          </h2>
          <Badge variant={STATUS_VARIANT[booking.status] ?? 'secondary'}>
            {booking.status[0].toUpperCase() + booking.status.slice(1)}
          </Badge>
        </div>
        {resource ? (
          <p className="text-muted-foreground">
            {resource.name}
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
              {resource.code}
            </span>
          </p>
        ) : null}
      </div>

      <Separator />

      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <CalendarClock className="size-4" />
          <span>{formatLongDateInZone(start, timeZone)}</span>
        </div>
        <div className="pl-6 text-foreground">
          {formatTimeInZone(start, timeZone)} –{' '}
          {formatTimeInZone(end, timeZone)}
        </div>
        {booking.location || resource?.location ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="size-4" />
            <span>{booking.location ?? resource?.location}</span>
          </div>
        ) : null}
      </div>

      <Separator />

      <div className="space-y-2">
        <SectionHeading icon={<Users className="size-3.5" />}>
          Participants
        </SectionHeading>
        {booking.participants.length === 0 ? (
          <p className="text-xs text-muted-foreground">No participants.</p>
        ) : (
          <div className="space-y-2">
            {booking.participants.map((p) => (
              <ParticipantRow key={p.id} participant={p} />
            ))}
          </div>
        )}
      </div>

      {booking.linkedExperimentRecordId ? (
        <>
          <Separator />
          <div className="space-y-1.5">
            <SectionHeading icon={<FileText className="size-3.5" />}>
              Linked experiment
            </SectionHeading>
            <p className="font-medium">
              {booking.linkedExperimentIdentifier ?? 'Experiment'}
            </p>
            {booking.linkedExperimentTitle ? (
              <p className="text-muted-foreground">
                {booking.linkedExperimentTitle}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {booking.samples.length > 0 ? (
        <>
          <Separator />
          <div className="space-y-1.5">
            <SectionHeading icon={<FlaskRound className="size-3.5" />}>
              Required samples
            </SectionHeading>
            <ul className="space-y-1">
              {booking.samples.map((s) => (
                <SampleRow key={s.id} sample={s} />
              ))}
            </ul>
          </div>
        </>
      ) : null}

      {booking.notes ? (
        <>
          <Separator />
          <div className="space-y-1.5">
            <SectionHeading icon={<FileText className="size-3.5" />}>
              Notes
            </SectionHeading>
            <p className="whitespace-pre-wrap text-muted-foreground">
              {booking.notes}
            </p>
          </div>
        </>
      ) : null}

      <Separator />

      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={() => onEdit(booking)}
          disabled={booking.status === 'cancelled'}
        >
          <Pencil className="size-4" /> Edit
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={() => onDuplicate(booking)}
        >
          <Copy className="size-4" /> Duplicate
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start text-destructive hover:text-destructive"
          onClick={() => onCancel(booking)}
          disabled={booking.status === 'cancelled'}
        >
          <X className="size-4" /> Cancel booking
        </Button>
      </div>

      <p className="pt-1 text-[10px] text-muted-foreground">
        <Trash2 className="mb-0.5 mr-1 inline size-3" />
        Cancelled bookings free the resource slot and remain visible for audit.
      </p>
    </div>
  )
}
