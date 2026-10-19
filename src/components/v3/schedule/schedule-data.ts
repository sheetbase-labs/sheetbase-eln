import { useQuery } from '@tanstack/react-query'

import {
  createBooking,
  fetchBookingSamples,
  fetchCalendarBookings,
  fetchCalendarInstruments,
} from '#/lib/calendar'
import { notebookDataClient } from '#/lib/notebook-data'
import type { CalendarBookingSample, CalendarBookingWire } from '#/lib/calendar'
import type { DataClient } from '#/lib/data-client'

/** UI port (roadmap-4/ui-app3): Schedule books instruments. ADR-0054 makes the
 * booking subject the instrument itself — a booking's resource_id is the
 * instrument id (its calendar resource is derived), so the grid, the picker and
 * the day view read `api.instruments` and link to /instruments/$id. Booking
 * writes still go through the canonical create_booking RPC. */

export interface ScheduleInstrument {
  id: string
  displayId: string | null
  name: string
}

export interface ScheduleBooking {
  id: string
  resourceId: string
  title: string
  /** Local ISO day in the booking's timezone. */
  date: string
  /** HH:MM in the booking's timezone. */
  start: string
  end: string
  timezone: string
  createdByUserId: string | null
  /** Set by the screen: whether the current user made this booking. */
  mine?: boolean
  /** Set by the screen: the booker's display name. */
  who?: string
}

const dayFmt = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
const timeFmt = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

export function toScheduleBooking(wire: CalendarBookingWire): ScheduleBooking {
  const tz = wire.timezone || 'UTC'
  return {
    id: wire.id,
    resourceId: wire.resource_id,
    title: wire.title,
    date: dayFmt(tz).format(new Date(wire.starts_at)),
    start: timeFmt(tz).format(new Date(wire.starts_at)),
    end: timeFmt(tz).format(new Date(wire.ends_at)),
    timezone: tz,
    createdByUserId: wire.created_by_user_id,
  }
}

export const scheduleQueryKeys = {
  instruments: (workspaceId: string) =>
    ['schedule', 'instruments', workspaceId] as const,
  bookings: (workspaceId: string, from: string, to: string) =>
    ['schedule', 'bookings', workspaceId, from, to] as const,
}

/** The bookable instruments: the registry minus anything retired. */
export function useScheduleInstruments(
  workspaceId: string | undefined,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: scheduleQueryKeys.instruments(workspaceId ?? 'none'),
    queryFn: async (): Promise<ScheduleInstrument[]> => {
      const instruments = await fetchCalendarInstruments(client, workspaceId!)
      return instruments
        .filter((i) => i.retiredAt === null)
        .map((i) => ({ id: i.id, displayId: i.displayId, name: i.name }))
    },
    enabled: Boolean(workspaceId),
  })
}

export function useRangeBookings(
  workspaceId: string | undefined,
  from: string,
  to: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: scheduleQueryKeys.bookings(workspaceId ?? 'none', from, to),
    queryFn: async (): Promise<ScheduleBooking[]> => {
      const rows = await fetchCalendarBookings(client, workspaceId!, from, to)
      return rows
        .filter((b) => !b.cancelled_at)
        .map(toScheduleBooking)
        .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    },
    enabled: Boolean(workspaceId),
  })
}

export interface BookingSample {
  id: string
  bookingId: string
  sampleRecordId: string | null
  identifier: string
  title: string
  left: string
}

/** Samples booked onto the given bookings, for the day's "Materials" list. */
export function useBookingSamples(
  bookingIds: string[],
  client: DataClient = notebookDataClient,
) {
  const key = bookingIds.join(',')
  return useQuery({
    queryKey: ['schedule', 'booking-samples', key],
    enabled: bookingIds.length > 0,
    queryFn: async (): Promise<BookingSample[]> => {
      const lists = await Promise.all(
        bookingIds.map((id) => fetchBookingSamples(client, id)),
      )
      return lists
        .flat()
        .filter((s: CalendarBookingSample) => Boolean(s.sampleIdentifier))
        .map((s) => ({
          id: s.id,
          bookingId: s.bookingId,
          sampleRecordId: s.sampleRecordId,
          identifier: s.sampleIdentifier ?? '—',
          title: s.sampleTitle ?? '—',
          left:
            s.quantityValue == null
              ? '—'
              : `${s.quantityValue}${s.quantityUnit ? ` ${s.quantityUnit}` : ''}`,
        }))
    },
    staleTime: 30_000,
  })
}

export interface BookInstrumentInput {
  workspaceId: string
  resourceId: string
  title: string
  startsAt: string
  endsAt: string
  timezone: string
  /** The experiment the booking is for; the booking then belongs to it. */
  linkedExperimentRecordId?: string | null
  projectId?: string | null
}

export async function bookInstrument(
  input: BookInstrumentInput,
): Promise<ScheduleBooking> {
  const wire = await createBooking(notebookDataClient, input.workspaceId, {
    resourceId: input.resourceId,
    title: input.title,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timezone: input.timezone,
    status: 'tentative',
    linkedExperimentRecordId: input.linkedExperimentRecordId ?? null,
    projectId: input.projectId ?? null,
  })
  return toScheduleBooking(wire)
}
