import { formatInstant } from './display-time-zone'

/**
 * A stored instant the way the workspace's date format reads it ("25 Sep 2026",
 * the setting's default), on the display time zone. Pass `time` for the clock
 * as well ("25 Sep 2026, 09:40"). Browsers and Node disagree on the en-GB month
 * for September ("Sept" or "Sep"), so it is normalised here once.
 */
export function formatDate(
  value: string | Date | null | undefined,
  options: { time?: boolean; year?: boolean } = {},
): string {
  if (!value) return '—'

  // A bare day ("2026-09-25") is a calendar date, not an instant: read it at
  // noon so no time zone moves it to the neighbouring day.
  let iso: string

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The declared parameter union is exactly string | Date; typeof takes the string alternative so a Date keeps its own toISOString instant.
  if (typeof value === 'string') {
    iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value
  } else {
    iso = value.toISOString()
  }

  const { time = false, year = true } = options

  const format: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
  }

  if (year) format.year = 'numeric'

  if (time) {
    format.hour = '2-digit'
    format.minute = '2-digit'
  }

  return formatInstant(iso, format).replace('Sept', 'Sep')
}

/**
 * A stored instant as a time of day on the person's own clock ("09:40", or
 * "9:40 am" when they chose a 12 hour clock), on the display time zone.
 */
export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The declared parameter union is exactly string | Date; typeof takes the string alternative so a Date keeps its own toISOString instant.
  const iso = typeof value === 'string' ? value : value.toISOString()

  return formatInstant(iso, { hour: '2-digit', minute: '2-digit' })
}
