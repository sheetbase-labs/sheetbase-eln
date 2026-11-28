import { formatDay } from './format-date'

/** "Mon 2 Nov": a planned day, as a date without a time zone. */
export function formatSeriesDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`)

  if (Number.isNaN(date.getTime())) return day

  return formatDay(date, { weekday: true, timeZone: 'UTC' })
}
