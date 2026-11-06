/** "Mon 2 Nov": a planned day, as a date without a time zone. */
export function formatSeriesDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date)
}
