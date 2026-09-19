/**
 * OPS-004 — Lab Calendar route.
 *
 * Powered by the reui.io Event Calendar (Radix UI variant, copy-and-own).
 * Month, week, day, N-day, agenda, and resource views with drag-and-drop,
 * resize, drag-to-create, and timezone-aware rendering.  A right inspector
 * shows the selected booking's details, participants, linked experiment,
 * samples, notes and Edit / Duplicate / Cancel actions.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  AlertCircle,
  CalendarDays,
  CircleCheck,
  Clock,
  Plus,
  TriangleAlert,
} from 'lucide-react'

import { useShell } from '#/components/app-shell'
import {
  BookingDialog,
  CalendarFilters,
  CalendarInspector,
  EMPTY_CALENDAR_FILTERS,
} from '#/components/calendar'
import type { CalendarFilterValue } from '#/components/calendar'
import { EventCalendar } from '#/components/reui/event-calendar/event-calendar'
import { EventCalendarContent } from '#/components/reui/event-calendar/event-calendar-content'
import { EventCalendarNav } from '#/components/reui/event-calendar/event-calendar-nav'
import type {
  CalendarEvent,
  EventCalendarResource,
} from '#/components/reui/event-calendar/event-calendar-types'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Calendar,
  PageHeader,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import {
  cancelBooking,
  createBooking,
  describeCalendarError,
  duplicateBooking,
  editBooking,
  fetchBookingParticipants,
  fetchBookingSamples,
  fetchCalendarBookings,
  fetchCalendarResources,
  toCalendarBooking,
} from '#/lib/calendar'
import type {
  CalendarBooking,
  CalendarBookingInput,
  CalendarResource,
} from '#/lib/calendar'

export const Route = createFileRoute('/calendar')({
  staticData: { shellFullBleed: true },
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: CalendarRoute,
})

const dataClient = createDataClient()
const VIEW_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** Map our booking color token names to CSS colors for the reui event chip. */
const BOOKING_COLOR_TO_CSS: Record<string, string> = {
  blue: 'var(--color-blue-500)',
  green: 'var(--color-green-500)',
  purple: 'var(--color-purple-500)',
  orange: 'var(--color-orange-500)',
}

function toCalendarEvent(
  booking: CalendarBooking,
): CalendarEvent<CalendarBooking> {
  return {
    id: booking.id,
    title: booking.title,
    start: new Date(booking.startsAt),
    end: new Date(booking.endsAt),
    allDay: booking.allDay,
    color: booking.color ? BOOKING_COLOR_TO_CSS[booking.color] : undefined,
    resourceId: booking.resourceId,
    data: booking,
    readOnly: booking.status === 'cancelled',
  }
}

function toEventCalendarResource(
  resource: CalendarResource,
): EventCalendarResource {
  return {
    id: resource.id,
    title: resource.name,
  }
}

function CalendarRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''

  const [filters, setFilters] = useState<CalendarFilterValue>(
    EMPTY_CALENDAR_FILTERS,
  )
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(
    null,
  )
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingBooking, setEditingBooking] = useState<CalendarBooking | null>(
    null,
  )
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dialogDefaults, setDialogDefaults] = useState<{
    start?: string
    end?: string
    resourceId?: string
  }>({})

  // Visible range driven by the reui EventCalendar's onRangeChange callback.
  const [calendarDate, setCalendarDate] = useState(() => new Date())
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null)
  const rangeKey = range
    ? `${range.start.toISOString()}_${range.end.toISOString()}`
    : 'none'

  const resourcesQuery = useQuery({
    queryKey: ['ops-004', 'resources', workspaceId],
    queryFn: () => fetchCalendarResources(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const bookingsQuery = useQuery({
    queryKey: ['ops-004', 'bookings', workspaceId, rangeKey],
    queryFn: () =>
      fetchCalendarBookings(
        dataClient,
        workspaceId,
        range!.start.toISOString(),
        range!.end.toISOString(),
      ),
    enabled: Boolean(workspaceId) && range !== null,
  })

  const bookings = useMemo<CalendarBooking[]>(() => {
    const wires = bookingsQuery.data ?? []
    return wires.map((b) => toCalendarBooking(b, [], []))
  }, [bookingsQuery.data])

  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      if (filters.resourceId && b.resourceId !== filters.resourceId)
        return false
      if (filters.projectId && b.projectId !== filters.projectId) return false
      if (filters.status && b.status !== filters.status) return false
      if (filters.location) {
        const res = resourcesQuery.data?.find((r) => r.id === b.resourceId)
        const loc = b.location ?? res?.location
        if (loc !== filters.location) return false
      }
      if (filters.resourceType) {
        const res = resourcesQuery.data?.find((r) => r.id === b.resourceId)
        if (res?.resourceType !== filters.resourceType) return false
      }
      return true
    })
  }, [bookings, filters, resourcesQuery.data])

  // Left-rail derivations (V2ALT): upcoming bookings, resource conflicts and
  // currently-free resources, all from the already-loaded week range.
  const railData = useMemo(() => {
    const now = Date.now()
    const live = bookings.filter((b) => b.status !== 'cancelled')
    const upcoming = live
      .filter((b) => new Date(b.endsAt).getTime() > now)
      .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))
      .slice(0, 4)
    const conflicts: Array<{ a: CalendarBooking; b: CalendarBooking }> = []
    const byResource = new Map<string, CalendarBooking[]>()
    for (const b of live) {
      byResource.set(b.resourceId, [...(byResource.get(b.resourceId) ?? []), b])
    }
    for (const list of byResource.values()) {
      const sorted = [...list].sort(
        (a, b) => +new Date(a.startsAt) - +new Date(b.startsAt),
      )
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i]
          const b = sorted[j]
          if (new Date(b.startsAt) < new Date(a.endsAt)) {
            conflicts.push({ a, b })
          } else break
        }
      }
    }
    const availableNow = (resourcesQuery.data ?? [])
      .filter(
        (resource) =>
          !live.some(
            (b) =>
              b.resourceId === resource.id &&
              new Date(b.startsAt).getTime() <= now &&
              new Date(b.endsAt).getTime() > now,
          ),
      )
      .map((resource) => ({
        resource,
        freeUntil: live
          .filter(
            (b) =>
              b.resourceId === resource.id &&
              new Date(b.startsAt).getTime() > now,
          )
          .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))[0]
          ?.startsAt,
      }))
    return { upcoming, conflicts, availableNow }
  }, [bookings, resourcesQuery.data])

  // Map domain bookings → reui CalendarEvent for the calendar.
  const queryEvents = useMemo(
    () => filteredBookings.map(toCalendarEvent),
    [filteredBookings],
  )

  // Controlled events state: synced from the query, updated optimistically
  // by onEventsChange when a drag/resize is accepted.
  const [events, setEvents] =
    useState<CalendarEvent<CalendarBooking>[]>(queryEvents)
  useEffect(() => {
    setEvents(queryEvents)
  }, [queryEvents])

  const eventResources = useMemo(
    () => (resourcesQuery.data ?? []).map(toEventCalendarResource),
    [resourcesQuery.data],
  )

  const selectedBooking = useMemo(
    () => filteredBookings.find((b) => b.id === selectedBookingId) ?? null,
    [filteredBookings, selectedBookingId],
  )

  // Fetch full detail (participants + samples) for the selected booking.
  const participantsQuery = useQuery({
    queryKey: ['ops-004', 'participants', selectedBookingId ?? 'none'],
    queryFn: () => fetchBookingParticipants(dataClient, selectedBookingId!),
    enabled: Boolean(selectedBookingId),
  })
  const samplesQuery = useQuery({
    queryKey: ['ops-004', 'samples', selectedBookingId ?? 'none'],
    queryFn: () => fetchBookingSamples(dataClient, selectedBookingId!),
    enabled: Boolean(selectedBookingId),
  })

  const selectedBookingFull = useMemo<CalendarBooking | null>(() => {
    if (!selectedBooking) return null
    return {
      ...selectedBooking,
      participants: participantsQuery.data ?? [],
      samples: samplesQuery.data ?? [],
    }
  }, [selectedBooking, participantsQuery.data, samplesQuery.data])

  function invalidateAll() {
    void queryClient.invalidateQueries({
      queryKey: ['ops-004', 'bookings', workspaceId],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ops-004', 'participants', selectedBookingId],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ops-004', 'samples', selectedBookingId],
    })
  }

  const createMutation = useMutation({
    mutationFn: (input: CalendarBookingInput) =>
      createBooking(dataClient, workspaceId, input),
    onSuccess: async () => {
      setDialogOpen(false)
      setDialogError(null)
      invalidateAll()
    },
    onError: (cause) => setDialogError(describeCalendarError(cause)),
  })
  const editMutation = useMutation({
    mutationFn: (input: {
      bookingId: string
      patch: CalendarBookingInput
      expectedMetadataVersion: number
    }) =>
      editBooking(dataClient, {
        bookingId: input.bookingId,
        title: input.patch.title,
        startsAt: input.patch.startsAt,
        endsAt: input.patch.endsAt,
        status: input.patch.status,
        location: input.patch.location,
        color: input.patch.color,
        notes: input.patch.notes,
        expectedMetadataVersion: input.expectedMetadataVersion,
      }),
    onSuccess: async () => {
      setDialogOpen(false)
      setDialogError(null)
      invalidateAll()
    },
    onError: (cause) => setDialogError(describeCalendarError(cause)),
  })
  const duplicateMutation = useMutation({
    mutationFn: (booking: CalendarBooking) =>
      duplicateBooking(dataClient, {
        bookingId: booking.id,
        startsAt: new Date(
          new Date(booking.startsAt).getTime() + 7 * 86_400_000,
        ).toISOString(),
        endsAt: new Date(
          new Date(booking.endsAt).getTime() + 7 * 86_400_000,
        ).toISOString(),
        title: `${booking.title} (copy)`,
      }),
    onSuccess: async () => {
      setActionError(null)
      invalidateAll()
    },
    onError: (cause) => setActionError(describeCalendarError(cause)),
  })
  const cancelMutation = useMutation({
    mutationFn: (booking: CalendarBooking) =>
      cancelBooking(dataClient, {
        bookingId: booking.id,
        expectedMetadataVersion: booking.metadataVersion,
      }),
    onSuccess: async () => {
      setActionError(null)
      invalidateAll()
    },
    onError: (cause) => setActionError(describeCalendarError(cause)),
  })

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const b of bookings) {
      if (b.projectId) seen.set(b.projectId, b.projectId)
    }
    return Array.from(seen.entries()).map(([id, title]) => ({ id, title }))
  }, [bookings])

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  function openCreate() {
    setEditingBooking(null)
    setDialogError(null)
    setDialogDefaults({})
    setDialogOpen(true)
  }
  function openEdit(booking: CalendarBooking) {
    setEditingBooking(booking)
    setDialogError(null)
    setDialogDefaults({})
    setDialogOpen(true)
  }
  function openCreateFromSlot(start: Date, end: Date, resourceId?: string) {
    setEditingBooking(null)
    setDialogError(null)
    setDialogDefaults({
      start: start.toISOString(),
      end: end.toISOString(),
      resourceId: resourceId ?? '',
    })
    setDialogOpen(true)
  }

  useShell({
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Lab Calendar' }],
    inspectorLabel: 'Booking',
    inspector: (
      <CalendarInspector
        booking={selectedBookingFull}
        resource={
          resourcesQuery.data?.find(
            (r) => r.id === selectedBookingFull?.resourceId,
          ) ?? null
        }
        timeZone={VIEW_TIMEZONE}
        onEdit={openEdit}
        onDuplicate={(b) => duplicateMutation.mutate(b)}
        onCancel={(b) => cancelMutation.mutate(b)}
      />
    ),
  })

  const calendarError = bookingsQuery.error || resourcesQuery.error

  return (
    <>
      <div className="flex flex-1 min-h-0 flex-col">
        {/* Header: title, new-booking action, filters */}
        <div className="border-b border-border/60 px-4 pt-4">
          <PageHeader
            compact
            title="Lab Calendar"
            description="Bookings for instruments, rooms, and shared resources."
          >
            <Button onClick={openCreate} size="sm">
              <Plus className="size-4" /> New booking
            </Button>
          </PageHeader>
          <div className="py-2.5">
            <CalendarFilters
              resources={resourcesQuery.data ?? []}
              value={filters}
              onChange={setFilters}
              projectOptions={projectOptions}
            />
            {actionError ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {actionError}
              </p>
            ) : null}
          </div>
        </div>

        {/* Calendar body */}
        {calendarError ? (
          <Alert variant="destructive" className="m-6 max-w-md">
            <AlertCircle className="size-4" />
            <AlertTitle>Couldn't load calendar</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>{describeCalendarError(calendarError)}</span>
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => {
                  void queryClient.invalidateQueries({
                    queryKey: ['ops-004', 'bookings', workspaceId],
                  })
                  void queryClient.invalidateQueries({
                    queryKey: ['ops-004', 'resources', workspaceId],
                  })
                }}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex min-h-0 flex-1">
            <CalendarRail
              date={calendarDate}
              onPick={setCalendarDate}
              upcoming={railData.upcoming}
              conflicts={railData.conflicts}
              availableNow={railData.availableNow}
              onSelectBooking={setSelectedBookingId}
            />
            <EventCalendar
              events={events}
              onEventsChange={setEvents}
              defaultView="week"
              date={calendarDate}
              onDateChange={setCalendarDate}
              timeZone={VIEW_TIMEZONE}
              resources={eventResources}
              loading={resourcesQuery.isLoading || bookingsQuery.isLoading}
              onEventClick={(occurrence) =>
                setSelectedBookingId(occurrence.eventId)
              }
              onSlotClick={(slot) => {
                const end =
                  slot.end ?? new Date(slot.date.getTime() + 3_600_000)
                openCreateFromSlot(slot.date, end, slot.resourceId)
              }}
              onSelectSlot={(slot) => {
                openCreateFromSlot(slot.start, slot.end, slot.resourceId)
              }}
              onEventUpdate={(update) => {
                const booking = update.event.data
                if (!booking || booking.status === 'cancelled') return false
                editMutation.mutate({
                  bookingId: booking.id,
                  patch: {
                    resourceId: update.resourceId ?? booking.resourceId,
                    title: booking.title,
                    startsAt: update.start.toISOString(),
                    endsAt: update.end.toISOString(),
                    timezone: booking.timezone,
                    status: booking.status,
                    allDay: update.allDay,
                    location: booking.location,
                    color: booking.color,
                    notes: booking.notes,
                    projectId: booking.projectId,
                  },
                  expectedMetadataVersion: booking.metadataVersion,
                })
                return true
              }}
              onRangeChange={(info) =>
                setRange({ start: info.range.start, end: info.range.end })
              }
              className="min-w-0 flex-1 min-h-0"
            >
              <EventCalendarNav />
              <EventCalendarContent />
            </EventCalendar>
          </div>
        )}
      </div>

      <BookingDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o)
          if (!o) setEditingBooking(null)
        }}
        resources={resourcesQuery.data ?? []}
        workspaceId={workspaceId}
        booking={editingBooking}
        defaultStart={dialogDefaults.start}
        defaultEnd={dialogDefaults.end}
        defaultResourceId={dialogDefaults.resourceId}
        onSubmit={async (input) => {
          if (editingBooking) {
            await editMutation.mutateAsync({
              bookingId: editingBooking.id,
              patch: input,
              expectedMetadataVersion: editingBooking.metadataVersion,
            })
          } else {
            await createMutation.mutateAsync(input)
          }
        }}
        error={dialogError}
      />
    </>
  )
}

function RailSection({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" aria-hidden="true" /> {title}
      </h3>
      {children}
    </section>
  )
}

function shortDayTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** V2ALT left rail: mini week picker, upcoming bookings, conflicts, availability. */
function CalendarRail({
  date,
  onPick,
  upcoming,
  conflicts,
  availableNow,
  onSelectBooking,
}: {
  date: Date
  onPick: (date: Date) => void
  upcoming: CalendarBooking[]
  conflicts: Array<{ a: CalendarBooking; b: CalendarBooking }>
  availableNow: Array<{
    resource: CalendarResource
    freeUntil: string | undefined
  }>
  onSelectBooking: (id: string) => void
}) {
  return (
    <aside
      aria-label="Calendar overview"
      className="hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r p-3 lg:flex"
    >
      <RailSection icon={CalendarDays} title="Pick a week">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(day) => day && onPick(day)}
          className="p-0"
          classNames={{
            weekday: 'w-7 text-[11px] font-normal text-muted-foreground',
            day: 'size-7 p-0 text-center text-xs',
            day_button: 'size-7',
          }}
        />
      </RailSection>
      <RailSection icon={Clock} title="Upcoming bookings">
        {upcoming.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing scheduled.</p>
        ) : (
          <ul className="space-y-1">
            {upcoming.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onSelectBooking(b.id)}
                  className="w-full rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
                >
                  <span className="block truncate">{b.title}</span>
                  <span className="text-muted-foreground">
                    {shortDayTime(b.startsAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </RailSection>
      <RailSection icon={TriangleAlert} title="Booking conflicts">
        {conflicts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No conflicts.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {conflicts.slice(0, 3).map(({ a, b }) => (
              <li key={`${a.id}-${b.id}`} className="text-warning-foreground">
                {a.title} overlaps {b.title} — {shortDayTime(b.startsAt)}
              </li>
            ))}
          </ul>
        )}
      </RailSection>
      <RailSection icon={CircleCheck} title="Available now">
        {availableNow.length === 0 ? (
          <p className="text-xs text-muted-foreground">All resources booked.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {availableNow.slice(0, 4).map(({ resource, freeUntil }) => (
              <li key={resource.id} className="text-muted-foreground">
                <span className="text-foreground">{resource.name}</span> — free
                {freeUntil ? ` until ${shortTime(freeUntil)}` : ' all week'}
              </li>
            ))}
          </ul>
        )}
      </RailSection>
    </aside>
  )
}
