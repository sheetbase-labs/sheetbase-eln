/**
 * OPS-004 — Lab Calendar route.
 *
 * Day / week / month views with filtering by team (instrument), project and
 * location, a left sub-column (mini picker, upcoming, conflicts, available
 * now), and a right inspector showing the selected booking's details,
 * participants, linked experiment, samples, notes and Edit / Duplicate /
 * Cancel actions.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import {
  BookingDialog,
  CalendarFilters,
  CalendarGrid,
  CalendarInspector,
  CalendarSidebar,
  EMPTY_CALENDAR_FILTERS,
} from '#/components/calendar'
import type { CalendarFilterValue } from '#/components/calendar'
import { Button } from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import {
  addDays,
  addMonths,
  cancelBooking,
  createBooking,
  describeCalendarError,
  duplicateBooking,
  editBooking,
  fetchBookingParticipants,
  fetchBookingSamples,
  fetchCalendarBookings,
  fetchCalendarResources,
  formatLongDateInZone,
  toCalendarBooking,
  viewRange,
} from '#/lib/calendar'
import type {
  CalendarBooking,
  CalendarBookingInput,
  CalendarView,
} from '#/lib/calendar'

const getCalendarContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext } = await import('#/lib/current-user')
    return getCurrentContext(getRequestHeaders())
  },
)

export const Route = createFileRoute('/calendar')({
  beforeLoad: async () => {
    const context = await getCalendarContext()
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: CalendarRoute,
})

const dataClient = createDataClient()
const VIEW_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function CalendarRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const [view, setView] = useState<CalendarView>('week')
  const [cursor, setCursor] = useState(() => new Date())
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

  const { start, end } = useMemo(
    () => viewRange(view, cursor, VIEW_TIMEZONE),
    [view, cursor],
  )
  const rangeKey = `${start.toISOString()}_${end.toISOString()}`

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
        start.toISOString(),
        end.toISOString(),
      ),
    enabled: Boolean(workspaceId),
  })

  // Hydrate participants + samples for every booking in range.
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

  const headerLabel = useMemo(() => {
    if (view === 'day') return formatLongDateInZone(cursor, VIEW_TIMEZONE)
    if (view === 'week') {
      const s = viewRange('week', cursor, VIEW_TIMEZONE).start
      const e = addDays(s, 6)
      return `${formatLongDateInZone(s, VIEW_TIMEZONE)} – ${formatLongDateInZone(e, VIEW_TIMEZONE)}`
    }
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: VIEW_TIMEZONE,
      month: 'long',
      year: 'numeric',
    }).format(cursor)
  }, [view, cursor])

  function stepView(direction: -1 | 1) {
    if (view === 'day') setCursor((c) => addDays(c, direction))
    else if (view === 'week') setCursor((c) => addDays(c, 7 * direction))
    else setCursor((c) => addMonths(c, direction))
  }

  function openCreate() {
    setEditingBooking(null)
    setDialogError(null)
    setDialogOpen(true)
  }
  function openEdit(booking: CalendarBooking) {
    setEditingBooking(booking)
    setDialogError(null)
    setDialogOpen(true)
  }

  return (
    <AppShell
      context={shellContext}
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Lab Calendar' }]}
      fullBleed
      primaryAction={
        <Button onClick={openCreate} size="sm">
          <Plus className="size-4" /> New booking
        </Button>
      }
      inspectorLabel="Booking"
      inspector={
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
      }
    >
      <div className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col">
        {/* Header: view controls, navigation, filters */}
        <div className="space-y-2 border-b border-border/60 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => stepView(-1)}
                aria-label="Previous"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCursor(new Date())}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => stepView(1)}
                aria-label="Next"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <h1 className="flex items-center gap-1.5 text-sm font-semibold">
              <CalendarDays className="size-4 text-muted-foreground" />
              {headerLabel}
            </h1>
            <div className="ml-auto flex items-center gap-1 rounded-md border border-border p-0.5">
              {(['day', 'week', 'month'] as CalendarView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={
                    view === v
                      ? 'rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground'
                      : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted'
                  }
                >
                  {v[0].toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <CalendarFilters
            resources={resourcesQuery.data ?? []}
            value={filters}
            onChange={setFilters}
            projectOptions={projectOptions}
          />
          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
        </div>

        {/* Body: sidebar + grid */}
        <div className="flex min-h-0 flex-1">
          <CalendarSidebar
            cursor={cursor}
            timeZone={VIEW_TIMEZONE}
            view={view}
            bookings={filteredBookings}
            resources={resourcesQuery.data ?? []}
            selectedBookingId={selectedBookingId}
            onPickDate={(d) => setCursor(d)}
            onSelectBooking={setSelectedBookingId}
          />
          <CalendarGrid
            view={view}
            cursor={cursor}
            timeZone={VIEW_TIMEZONE}
            bookings={filteredBookings}
            resources={resourcesQuery.data ?? []}
            selectedBookingId={selectedBookingId}
            onSelectBooking={setSelectedBookingId}
          />
        </div>
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
    </AppShell>
  )
}
