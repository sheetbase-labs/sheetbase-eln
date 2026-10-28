import { getDisplayTimeZone } from './display-time-zone'

const DAY_MS = 86_400_000

/**
 * The calendar day an instant falls on, on the display time zone's clock, as a
 * day number (days since 1970-01-01). Counting days between two of these is
 * what a person means by "7 days overdue": 18 Sep to 25 Sep is seven days
 * whatever the hour either side. `null` when the value does not parse.
 */
export function calendarDay(value: string | Date): number | null {
  // A bare date ("2026-09-30") is already a calendar day; no zone moves it.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Math.round(Date.parse(value) / DAY_MS)
  }
  const instant =
    typeof value === 'string' ? Date.parse(value) : value.getTime()
  if (Number.isNaN(instant)) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: getDisplayTimeZone(),
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(instant))
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value)
  return Math.round(
    Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS,
  )
}

/**
 * Whole calendar days from `now` to `due`: positive for a date still ahead,
 * zero for today, negative once it has passed. Every "due in" and "overdue"
 * label goes through this so two pages never disagree by a day.
 */
export function daysUntilDate(due: string | Date, now: Date): number | null {
  const dueDay = calendarDay(due)
  const today = calendarDay(now)
  if (dueDay === null || today === null) return null
  return dueDay - today
}
