import type { CalendarBooking } from '#/lib/calendar'
import { formatTime } from '#/lib/format-date'
import { cn } from '#/lib/utils'

export type TodayBooking = Pick<
  CalendarBooking,
  'id' | 'title' | 'location' | 'startsAt'
>

/** Today's bookings, each stated the same way: when, what and where. */
export function TodayBookingsList({
  bookings,
  timeZone,
  className,
}: {
  bookings: readonly TodayBooking[]
  timeZone: string
  className?: string
}): React.ReactElement {
  return (
    <ul className={cn('m-0 flex list-none flex-col p-0', className)}>
      {bookings.map((b) => (
        <li
          key={b.id}
          className="flex min-h-11 items-center gap-3 border-b border-border-subtle py-2 last:border-0"
        >
          <span className="num w-10 shrink-0 font-medium text-link">
            {formatTime(b.startsAt, { timeZone })}
          </span>
          <div className="min-w-0">
            <div className="font-medium">{b.title}</div>
            {b.location ? (
              <div className="text-label text-fg-muted">{b.location}</div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}
