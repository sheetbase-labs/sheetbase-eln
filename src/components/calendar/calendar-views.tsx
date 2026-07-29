/**
 * OPS-004 — Day, week and month calendar grids.
 *
 * Renders colour-coded booking blocks over a time axis. The week view mirrors
 * the mockup's Monday→Sunday grid with an 08:00–20:00 working window; the day
 * view shows a single column; the month view shows a 6-week grid with event
 * pills. All ranges are computed in the viewer's timezone so DST boundaries
 * land on the correct wall-clock day.
 */
import { useMemo } from 'react'

import { cn } from '#/lib/utils'
import {
  BOOKING_COLOR_TOKENS,
  WEEKDAY_LABELS,
  addDays,
  formatTimeInZone,
  isSameDayInZone,
  startOfDayInZone,
  startOfWeekInZone,
} from '#/lib/calendar'
import type {
  CalendarBooking,
  CalendarResource,
  CalendarView,
} from '#/lib/calendar'

const HOUR_START = 8
const HOUR_END = 20
const HOUR_COUNT = HOUR_END - HOUR_START
const HOUR_PX = 44

export interface CalendarGridProps {
  view: CalendarView
  cursor: Date
  timeZone: string
  bookings: CalendarBooking[]
  resources: CalendarResource[]
  selectedBookingId: string | null
  onSelectBooking: (id: string) => void
}

interface PositionedBooking {
  booking: CalendarBooking
  top: number
  height: number
  column: number
  columns: number
}

/** Compute day columns for the current view. */
function dayColumns(
  view: CalendarView,
  cursor: Date,
  timeZone: string,
): Date[] {
  if (view === 'day') return [startOfDayInZone(cursor, timeZone)]
  if (view === 'week') {
    const start = startOfWeekInZone(cursor, timeZone)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }
  // month: 6 weeks
  const start = startOfWeekInZone(
    new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1)),
    timeZone,
  )
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

/** Position a booking within a day column (top/height in px). */
function positionForDay(
  booking: CalendarBooking,
  dayStart: Date,
  timeZone: string,
): { top: number; height: number } | null {
  const start = new Date(booking.startsAt)
  const end = new Date(booking.endsAt)
  // Clamp to the working window for display.
  const dayWindowStart = new Date(dayStart.getTime() + HOUR_START * 3_600_000)
  const dayWindowEnd = new Date(dayStart.getTime() + HOUR_END * 3_600_000)
  if (end <= dayWindowStart || start >= dayWindowEnd) return null
  const clampStart = start < dayWindowStart ? dayWindowStart : start
  const clampEnd = end > dayWindowEnd ? dayWindowEnd : end
  const top =
    ((clampStart.getTime() - dayWindowStart.getTime()) / 3_600_000) * HOUR_PX
  const height = Math.max(
    ((clampEnd.getTime() - clampStart.getTime()) / 3_600_000) * HOUR_PX,
    20,
  )
  void timeZone
  return { top, height }
}

/** Lay out overlapping bookings side-by-side within a day column. */
function layoutDay(
  bookings: CalendarBooking[],
  dayStart: Date,
  timeZone: string,
): PositionedBooking[] {
  const positioned = bookings
    .map((booking) => {
      const pos = positionForDay(booking, dayStart, timeZone)
      return pos ? { booking, ...pos, column: 0, columns: 1 } : null
    })
    .filter((p): p is PositionedBooking => p !== null)
    .sort((a, b) => a.top - b.top)

  // Greedy column assignment for overlapping clusters.
  const clusters: PositionedBooking[][] = []
  for (const item of positioned) {
    const cluster = clusters.find(
      (c) => c[c.length - 1].top + c[c.length - 1].height > item.top,
    )
    if (cluster) cluster.push(item)
    else clusters.push([item])
  }
  const result: PositionedBooking[] = []
  for (const cluster of clusters) {
    const columns: PositionedBooking[][] = []
    for (const item of cluster) {
      const col = columns.findIndex(
        (c) => c[c.length - 1].top + c[c.length - 1].height <= item.top,
      )
      if (col >= 0) {
        columns[col].push(item)
        item.column = col
      } else {
        columns.push([item])
        item.column = columns.length - 1
      }
    }
    for (const item of cluster) {
      item.columns = columns.length
      result.push(item)
    }
  }
  return result
}

function bookingColorClass(booking: CalendarBooking): string {
  return (
    BOOKING_COLOR_TOKENS[booking.color ?? 'blue'] ?? BOOKING_COLOR_TOKENS.blue
  )
}

function HourAxis() {
  return (
    <div
      className="relative w-12 shrink-0 border-r border-border/60"
      style={{ height: HOUR_COUNT * HOUR_PX }}
      aria-hidden="true"
    >
      {Array.from({ length: HOUR_COUNT + 1 }, (_, i) => {
        const hour = HOUR_START + i
        return (
          <div
            key={hour}
            className="absolute right-1 -translate-y-1/2 text-xs text-muted-foreground"
            style={{ top: i * HOUR_PX }}
          >
            {String(hour).padStart(2, '0')}:00
          </div>
        )
      })}
    </div>
  )
}

function DayColumn({
  dayStart,
  timeZone,
  bookings,
  selectedBookingId,
  onSelectBooking,
  label,
  isToday,
}: {
  dayStart: Date
  timeZone: string
  bookings: CalendarBooking[]
  selectedBookingId: string | null
  onSelectBooking: (id: string) => void
  label: string
  isToday: boolean
}) {
  const positioned = useMemo(
    () => layoutDay(bookings, dayStart, timeZone),
    [bookings, dayStart, timeZone],
  )
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div
        className={cn(
          'border-b border-border/60 px-2 py-1 text-center text-xs font-medium',
          isToday ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {label}
      </div>
      <div
        className="relative border-r border-border/60"
        style={{ height: HOUR_COUNT * HOUR_PX }}
      >
        {Array.from({ length: HOUR_COUNT }, (_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-border/30"
            style={{ top: i * HOUR_PX }}
            aria-hidden="true"
          />
        ))}
        {positioned.map(({ booking, top, height, column, columns }) => {
          const widthPct = 100 / columns
          return (
            <button
              key={booking.id}
              type="button"
              onClick={() => onSelectBooking(booking.id)}
              className={cn(
                'absolute left-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-left text-xs leading-tight transition-shadow',
                bookingColorClass(booking),
                booking.status === 'cancelled' && 'opacity-50 line-through',
                selectedBookingId === booking.id &&
                  'ring-2 ring-ring ring-offset-1',
              )}
              style={{
                top,
                height,
                width: `calc(${widthPct}% - 4px)`,
                left: `calc(${column * widthPct}% + 2px)`,
              }}
            >
              <div className="truncate font-medium">{booking.title}</div>
              <div className="truncate opacity-80">
                {formatTimeInZone(new Date(booking.startsAt), timeZone)}
                {booking.status === 'cancelled' ? ' · cancelled' : ''}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WeekOrDayView({
  view,
  cursor,
  timeZone,
  bookings,
  selectedBookingId,
  onSelectBooking,
}: Omit<CalendarGridProps, 'resources'>) {
  const days = dayColumns(view, cursor, timeZone)
  const today = new Date()
  return (
    <div
      role="grid"
      aria-label={view === 'day' ? 'Day calendar' : 'Week calendar'}
      className="flex min-h-0 flex-1 overflow-auto"
    >
      <HourAxis />
      {days.map((dayStart, i) => {
        const dayBookings = bookings.filter((b) =>
          isSameDayInZone(new Date(b.startsAt), dayStart, timeZone),
        )
        const label =
          view === 'day' ? '' : `${WEEKDAY_LABELS[i]} ${dayStart.getUTCDate()}`
        return (
          <DayColumn
            key={dayStart.toISOString()}
            dayStart={dayStart}
            timeZone={timeZone}
            bookings={dayBookings}
            selectedBookingId={selectedBookingId}
            onSelectBooking={onSelectBooking}
            label={label}
            isToday={isSameDayInZone(today, dayStart, timeZone)}
          />
        )
      })}
    </div>
  )
}

function MonthView({
  cursor,
  timeZone,
  bookings,
  selectedBookingId,
  onSelectBooking,
}: Omit<CalendarGridProps, 'view' | 'resources'>) {
  const days = dayColumns('month', cursor, timeZone)
  const today = new Date()
  const currentMonth = cursor.getUTCMonth()
  return (
    <div
      role="grid"
      aria-label="Month calendar"
      className="flex min-h-0 flex-1 flex-col overflow-auto"
    >
      <div className="grid grid-cols-7 border-b border-border/60">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-1 text-center text-xs font-medium text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {days.map((dayStart) => {
          const inMonth = dayStart.getUTCMonth() === currentMonth
          const dayBookings = bookings
            .filter((b) =>
              isSameDayInZone(new Date(b.startsAt), dayStart, timeZone),
            )
            .slice(0, 3)
          const isToday = isSameDayInZone(today, dayStart, timeZone)
          return (
            <div
              key={dayStart.toISOString()}
              className={cn(
                'min-h-[88px] border-b border-r border-border/40 p-1',
                !inMonth && 'bg-muted/30 text-muted-foreground',
              )}
            >
              <div
                className={cn(
                  'mb-1 text-right text-xs',
                  isToday && 'font-bold text-primary',
                )}
              >
                {dayStart.getUTCDate()}
              </div>
              <div className="flex flex-col gap-0.5">
                {dayBookings.map((booking) => (
                  <button
                    key={booking.id}
                    type="button"
                    onClick={() => onSelectBooking(booking.id)}
                    className={cn(
                      'truncate rounded px-1 py-0.5 text-left text-xs leading-tight',
                      bookingColorClass(booking),
                      booking.status === 'cancelled' &&
                        'line-through opacity-60',
                      selectedBookingId === booking.id && 'ring-1 ring-ring',
                    )}
                  >
                    {booking.title}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CalendarGrid({
  view,
  cursor,
  timeZone,
  bookings,
  resources,
  selectedBookingId,
  onSelectBooking,
}: CalendarGridProps) {
  void resources
  if (view === 'month') {
    return (
      <MonthView
        cursor={cursor}
        timeZone={timeZone}
        bookings={bookings}
        selectedBookingId={selectedBookingId}
        onSelectBooking={onSelectBooking}
      />
    )
  }
  return (
    <WeekOrDayView
      view={view}
      cursor={cursor}
      timeZone={timeZone}
      bookings={bookings}
      selectedBookingId={selectedBookingId}
      onSelectBooking={onSelectBooking}
    />
  )
}
