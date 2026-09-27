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
import { AlertCircle, Plus } from 'lucide-react'

import { useShell } from '#/components/shell'
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
    fullBleed: true,
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
          <EventCalendar
            events={events}
            onEventsChange={setEvents}
            defaultView="week"
            timeZone={VIEW_TIMEZONE}
            resources={eventResources}
            loading={resourcesQuery.isLoading || bookingsQuery.isLoading}
            onEventClick={(occurrence) =>
              setSelectedBookingId(occurrence.eventId)
            }
            onSlotClick={(slot) => {
              const end = slot.end ?? new Date(slot.date.getTime() + 3_600_000)
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
            className="flex-1 min-h-0"
          >
            <EventCalendarNav />
            <EventCalendarContent />
          </EventCalendar>
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
