import { useQuery } from '@tanstack/react-query'

import {
  createBooking,
  fetchCalendarBookings,
  fetchCalendarResources,
} from '#/lib/calendar'
import { notebookDataClient } from '#/lib/notebook-data'
import type { CalendarBookingWire } from '#/lib/calendar'
import type { DataClient } from '#/lib/data-client'

/** UI port (roadmap-4/ui-app3): Schedule reads calendar_resources (instruments)
 * and calendar_bookings for the visible range; booking writes go through the
 * canonical create_booking RPC. */

export interface ScheduleInstrument {
  id: string
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
  }
}

export const scheduleQueryKeys = {
  resources: (workspaceId: string) =>
    ['schedule', 'resources', workspaceId] as const,
  bookings: (workspaceId: string, from: string, to: string) =>
    ['schedule', 'bookings', workspaceId, from, to] as const,
}

export function useScheduleResources(
  workspaceId: string | undefined,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: scheduleQueryKeys.resources(workspaceId ?? 'none'),
    queryFn: async (): Promise<ScheduleInstrument[]> => {
      const resources = await fetchCalendarResources(client, workspaceId!)
      return resources
        .filter((r) => r.resourceType === 'instrument')
        .map((r) => ({ id: r.id, name: r.name }))
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

export async function bookInstrument(input: {
  workspaceId: string
  resourceId: string
  title: string
  startsAt: string
  endsAt: string
  timezone: string
}): Promise<ScheduleBooking> {
  const wire = await createBooking(notebookDataClient, input.workspaceId, {
    resourceId: input.resourceId,
    title: input.title,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timezone: input.timezone,
    status: 'tentative',
  })
  return toScheduleBooking(wire)
}
