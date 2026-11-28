import { t } from '#/copy'
import { now as appNow } from './clock'
import { formatInstant } from './display-time-zone'

/**
 * The one way the app writes a date or a time. Every surface reads a stored
 * instant through these, so a date reads "25 Sep 2026" (or "25 Sep" where the
 * year is plain), a time reads "09:40" on the person's own clock, and how long
 * ago something happened reads "6h ago" wherever it is shown.
 *
 * `pnpm check:dates` fails on a date formatted anywhere else.
 */

/** A stored ISO string, a Date, or milliseconds since the epoch. */
type DateInput = string | number | Date | null | undefined

export interface DateOptions {
  /** Add the time of day: "25 Sep 2026, 09:40". */
  time?: boolean
  /** Show the year (the default). "25 Sep" without it. */
  year?: boolean
  /** Lead with the weekday: "Fri 25 Sep". */
  weekday?: boolean
  /**
   * Read the instant on this zone instead of the person's display zone. The
   * server passes the zone it was handed; a calendar day stored as midnight
   * UTC passes `'UTC'` so no zone moves it to the neighbouring day.
   */
  timeZone?: string
  /** Name the zone after the time ("09:40 GMT") for audit and signature times. */
  zone?: boolean
}

/**
 * The instant behind a value. A bare day ("2026-09-25") is a calendar date,
 * not an instant: it is read at noon UTC so no time zone moves it.
 */
function toIso(value: string | number | Date): string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Milliseconds are the number alternative of the declared union.
  if (typeof value === 'number') value = new Date(value)

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The declared parameter union is exactly string | Date; typeof takes the string alternative so a Date keeps its own toISOString instant.
  if (typeof value === 'string')
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value

  return Number.isNaN(value.getTime()) ? '' : value.toISOString()
}

/**
 * A stored instant the way the workspace's date format reads it ("25 Sep 2026",
 * the setting's default), on the display time zone. Pass `time` for the clock
 * as well ("25 Sep 2026, 09:40"). Browsers and Node disagree on the en-GB month
 * for September ("Sept" or "Sep"), so it is normalised here once.
 */
export function formatDate(
  value: DateInput,
  options: DateOptions = {},
): string {
  if (value === null || value === undefined || value === '') return '—'
  const iso = toIso(value)

  if (!iso) return '—'
  const { time = false, year = true, weekday = false, timeZone, zone } = options

  const format: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
  }

  if (year) format.year = 'numeric'

  if (weekday) format.weekday = 'short'

  if (time) {
    format.hour = '2-digit'
    format.minute = '2-digit'
  }

  if (timeZone) format.timeZone = timeZone

  return formatInstant(iso, { ...format, zone }).replace('Sept', 'Sep')
}

/** Day and month only: "25 Sep". */
export function formatDay(
  value: DateInput,
  options: Omit<DateOptions, 'year'> = {},
): string {
  return formatDate(value, { ...options, year: false })
}

/** The month alone ("Sep"), or with its year ("Sep 2026"). */
export function formatMonth(
  value: DateInput,
  options: { year?: boolean; timeZone?: string } = {},
): string {
  if (value === null || value === undefined || value === '') return '—'
  const iso = toIso(value)

  if (!iso) return '—'

  const format: Intl.DateTimeFormatOptions = { month: 'short' }

  if (options.year) format.year = 'numeric'

  if (options.timeZone) format.timeZone = options.timeZone

  return formatInstant(iso, format).replace('Sept', 'Sep')
}

/**
 * A stored instant as a time of day on the person's own clock ("09:40", or
 * "9:40 am" when they chose a 12 hour clock), on the display time zone.
 */
export function formatTime(
  value: DateInput,
  options: { seconds?: boolean; timeZone?: string; zone?: boolean } = {},
): string {
  if (value === null || value === undefined || value === '') return '—'
  const iso = toIso(value)

  if (!iso) return '—'

  const format: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
  }

  if (options.seconds) format.second = '2-digit'

  if (options.timeZone) format.timeZone = options.timeZone

  return formatInstant(iso, { ...format, zone: options.zone })
}

/**
 * A span of time: "09:00–11:00" inside one day when `sameDayTimes` asks for
 * times only, "25 Sep, 09:00–11:00" for a booking, "25 Sep – 2 Oct" for days.
 */
export function formatRange(
  start: DateInput,
  end: DateInput,
  options: { time?: boolean; timesOnly?: boolean; timeZone?: string } = {},
): string {
  if (!start) return '—'

  if (!end) return formatDate(start, { time: options.time, year: false })
  const { timeZone } = options

  if (options.timesOnly)
    return `${formatTime(start, { timeZone })}–${formatTime(end, { timeZone })}`

  const startDay = formatDay(start, { timeZone })
  const endDay = formatDay(end, { timeZone })

  if (options.time) {
    return startDay === endDay
      ? `${startDay}, ${formatTime(start, { timeZone })}–${formatTime(end, { timeZone })}`
      : `${startDay}, ${formatTime(start, { timeZone })} – ${endDay}, ${formatTime(end, { timeZone })}`
  }

  return startDay === endDay ? startDay : `${startDay} – ${endDay}`
}

/**
 * How long ago an instant was, for a quick read: "just now", "6m ago",
 * "3h ago", "2d ago", "3w ago", then the date itself once it is over a month
 * old. A time still to come reads "in 3h". `now` is the app clock unless given.
 */
export function formatAgo(
  value: DateInput,
  now: Date | number = appNow(),
): string {
  if (value === null || value === undefined || value === '') return '—'
  const iso = toIso(value)
  const then = Date.parse(iso)

  if (Number.isNaN(then)) return '—'
  const nowMs = now instanceof Date ? now.getTime() : now
  const diff = Math.round((nowMs - then) / 1000)
  const future = diff < 0
  const seconds = Math.abs(diff)

  if (seconds < 60)
    return future ? t('common.when.anyMoment') : t('common.when.justNow')
  const minutes = Math.round(seconds / 60)
  const hours = Math.round(minutes / 60)
  const days = Math.round(hours / 24)
  const weeks = Math.round(days / 7)

  let amount: string

  if (minutes < 60) amount = t('common.when.minutes', { count: minutes })
  else if (hours < 24) amount = t('common.when.hours', { count: hours })
  else if (days < 7) amount = t('common.when.days', { count: days })
  else if (weeks < 5) amount = t('common.when.weeks', { count: weeks })
  else return formatDate(iso)

  return future
    ? t('common.when.in', { amount })
    : t('common.when.ago', { amount })
}

/** A day said in full, for a heading or a spoken label: "Saturday 28 November". */
export function formatLongDay(
  value: DateInput,
  options: { timeZone?: string } = {},
): string {
  if (value === null || value === undefined || value === '') return '—'
  const iso = toIso(value)

  if (!iso) return '—'

  const format: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }

  if (options.timeZone) format.timeZone = options.timeZone

  return formatInstant(iso, format)
}

/**
 * The weekday: "Mon", "Monday" when `long`, and "Mon 28" with `day` for a
 * week strip's column heading.
 */
export function formatWeekday(
  value: DateInput,
  options: { long?: boolean; day?: boolean; timeZone?: string } = {},
): string {
  if (value === null || value === undefined || value === '') return '—'
  const iso = toIso(value)

  if (!iso) return '—'

  const format: Intl.DateTimeFormatOptions = {
    weekday: options.long ? 'long' : 'short',
  }

  if (options.day) format.day = 'numeric'

  if (options.timeZone) format.timeZone = options.timeZone

  return formatInstant(iso, format)
}
