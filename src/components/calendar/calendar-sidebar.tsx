/**
 * OPS-004 — Calendar left sub-column: mini date picker, upcoming bookings,
 * booking conflicts and available-now instruments. Mirrors the mockup's
 * left sub-column.
 */
import { AlertTriangle, CalendarDays, CheckCircle2, Clock } from 'lucide-react'

import { cn } from '#/lib/utils'
import {
  WEEKDAY_LABELS,
  addDays,
  isSameDayInZone,
  startOfWeekInZone,
} from '#/lib/calendar'
import type {
  CalendarBooking,
  CalendarResource,
  CalendarView,
} from '#/lib/calendar'

export interface CalendarSidebarProps {
  cursor: Date
  timeZone: string
  view: CalendarView
  bookings: CalendarBooking[]
  resources: CalendarResource[]
  selectedBookingId: string | null
  onPickDate: (date: Date) => void
  onSelectBooking: (id: string) => void
}

/** Detect overlapping active bookings across all resources. */
export function detectConflicts(
  bookings: CalendarBooking[],
): Array<{ a: CalendarBooking; b: CalendarBooking }> {
  const active = bookings.filter((b) => b.status !== 'cancelled')
  const conflicts: Array<{ a: CalendarBooking; b: CalendarBooking }> = []
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]
      const b = active[j]
      if (a.resourceId !== b.resourceId) continue
      const aStart = new Date(a.startsAt).getTime()
      const aEnd = new Date(a.endsAt).getTime()
      const bStart = new Date(b.startsAt).getTime()
      const bEnd = new Date(b.endsAt).getTime()
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.push({ a, b })
      }
    }
  }
  return conflicts
}

function MiniMonthPicker({
  cursor,
  timeZone,
  onPickDate,
}: {
  cursor: Date
  timeZone: string
  onPickDate: (date: Date) => void
}) {
  const start = startOfWeekInZone(
    new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1)),
    timeZone,
  )
  const today = new Date()
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7">
        {WEEKDAY_LABELS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-medium text-muted-foreground"
          >
            {d[0]}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((day) => {
          const inMonth = day.getUTCMonth() === cursor.getUTCMonth()
          const isToday = isSameDayInZone(today, day, timeZone)
          const isSelected = isSameDayInZone(cursor, day, timeZone)
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onPickDate(day)}
              className={cn(
                'rounded text-center text-[11px] leading-6 transition-colors',
                !inMonth && 'text-muted-foreground/50',
                inMonth && 'text-foreground hover:bg-muted',
                isToday && 'font-bold text-primary',
                isSelected &&
                  'bg-primary text-primary-foreground hover:bg-primary',
              )}
            >
              {day.getUTCDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function CalendarSidebar({
  cursor,
  timeZone,
  view,
  bookings,
  resources,
  selectedBookingId,
  onPickDate,
  onSelectBooking,
}: CalendarSidebarProps) {
  const now = new Date()
  const upcoming = bookings
    .filter((b) => b.status !== 'cancelled' && new Date(b.startsAt) >= now)
    .sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    )
    .slice(0, 5)
  const conflicts = detectConflicts(bookings)
  const availableNow = resources.filter((r) => {
    const active = bookings.filter(
      (b) =>
        b.status !== 'cancelled' &&
        b.resourceId === r.id &&
        new Date(b.startsAt) <= now &&
        new Date(b.endsAt) > now,
    )
    return active.length === 0
  })

  return (
    <div className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/60 p-3">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarDays className="size-3.5" />
          {view === 'day'
            ? 'Pick a day'
            : view === 'week'
              ? 'Pick a week'
              : 'Pick a month'}
        </div>
        <MiniMonthPicker
          cursor={cursor}
          timeZone={timeZone}
          onPickDate={onPickDate}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Clock className="size-3.5" />
          Upcoming bookings
        </div>
        {upcoming.length === 0 ? (
          <p className="text-xs text-muted-foreground">No upcoming bookings.</p>
        ) : (
          <ul className="space-y-1.5">
            {upcoming.map((b) => {
              const resource = resources.find((r) => r.id === b.resourceId)
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => onSelectBooking(b.id)}
                    className={cn(
                      'w-full rounded-md border border-border/60 px-2 py-1.5 text-left text-xs hover:bg-muted',
                      selectedBookingId === b.id && 'ring-1 ring-ring',
                    )}
                  >
                    <div className="truncate font-medium">{b.title}</div>
                    <div className="text-muted-foreground">
                      {resource?.name ?? '—'}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-destructive">
          <AlertTriangle className="size-3.5" />
          Booking conflicts
        </div>
        {conflicts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No conflicts detected.
          </p>
        ) : (
          <ul className="space-y-1 text-xs text-destructive">
            {conflicts.map(({ a, b }, i) => (
              <li key={i}>
                “{a.title}” overlaps with “{b.title}”
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600">
          <CheckCircle2 className="size-3.5" />
          Available now
        </div>
        {availableNow.length === 0 ? (
          <p className="text-xs text-muted-foreground">All resources in use.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {availableNow.map((r) => (
              <li key={r.id} className="flex items-center justify-between">
                <span>{r.name}</span>
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                  Free
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
