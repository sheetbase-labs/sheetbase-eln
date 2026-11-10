/**
 * "Mon 2 Nov": a planned day, as a date without a time zone. One formatter for
 * every call: `Intl.DateTimeFormat` is immutable, so building it per day only
 * cost time.
 */
const SERIES_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

export function formatSeriesDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`)

  if (Number.isNaN(date.getTime())) return day

  return SERIES_DAY.format(date)
}
