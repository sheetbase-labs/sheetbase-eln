/**
 * The stretch of time a report covers, and the money and hours it adds up.
 *
 * Reports are built the same way on screen and in the email worker, so the
 * period arithmetic lives here and takes the time zone it should read the
 * calendar in. A period is a half-open range: `from` is included, `to` is not.
 */

export type ReportPeriod =
  | 'this_month'
  | 'last_month'
  | 'last_7_days'
  | 'last_30_days'
  | 'previous_week'
  | 'previous_month'
  | 'custom'

/** The periods a scheduled report can use: always a full, finished stretch. */
export const SCHEDULED_PERIODS = [
  'previous_week',
  'previous_month',
  'last_7_days',
  'last_30_days',
] as const
export type ScheduledPeriod = (typeof SCHEDULED_PERIODS)[number]

export interface DateRange {
  from: Date
  to: Date
}

interface LocalDay {
  year: number
  month: number
  day: number
}

function localDay(instant: Date, timeZone: string): LocalDay {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

/** How far the zone's clock is ahead of UTC at an instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour'),
    pick('minute'),
    pick('second'),
  )
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** The instant a calendar day starts in a time zone. */
export function startOfDay(day: LocalDay, timeZone: string): Date {
  const guess = Date.UTC(day.year, day.month - 1, day.day)
  const first = guess - zoneOffsetMs(new Date(guess), timeZone)
  // One more pass settles the days the clocks change on.
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone))
}

function addDays(day: LocalDay, days: number): LocalDay {
  const moved = new Date(Date.UTC(day.year, day.month - 1, day.day + days))
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  }
}

/** Monday is 0. */
function weekdayIndex(day: LocalDay): number {
  const dow = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()
  return (dow + 6) % 7
}

/** The calendar days the period covers, read in the given time zone. */
export function resolvePeriod(
  period: Exclude<ReportPeriod, 'custom'>,
  now: Date,
  timeZone: string,
): DateRange {
  const today = localDay(now, timeZone)
  const tomorrow = startOfDay(addDays(today, 1), timeZone)
  switch (period) {
    case 'this_month':
      return {
        from: startOfDay({ ...today, day: 1 }, timeZone),
        to: tomorrow,
      }
    case 'last_month':
    case 'previous_month': {
      const first = { year: today.year, month: today.month, day: 1 }
      const prev =
        today.month === 1
          ? { year: today.year - 1, month: 12, day: 1 }
          : { year: today.year, month: today.month - 1, day: 1 }
      return {
        from: startOfDay(prev, timeZone),
        to: startOfDay(first, timeZone),
      }
    }
    case 'last_7_days':
      return {
        from: startOfDay(addDays(today, -7), timeZone),
        to: startOfDay(today, timeZone),
      }
    case 'last_30_days':
      return {
        from: startOfDay(addDays(today, -30), timeZone),
        to: startOfDay(today, timeZone),
      }
    case 'previous_week': {
      const monday = addDays(today, -weekdayIndex(today))
      return {
        from: startOfDay(addDays(monday, -7), timeZone),
        to: startOfDay(monday, timeZone),
      }
    }
  }
}

/** A `YYYY-MM-DD` day from a person's date field, as the start of that day. */
export function dayStart(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return startOfDay(
    { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) },
    timeZone,
  )
}

/** The end of a `YYYY-MM-DD` day, as the start of the next. */
export function dayEnd(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return startOfDay(
    addDays(
      {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      },
      1,
    ),
    timeZone,
  )
}

/** `YYYY-MM-DD` for an instant in a time zone. */
export function isoDay(instant: Date, timeZone: string): string {
  const d = localDay(instant, timeZone)
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/** `YYYY-MM` for an instant in a time zone: the month a line belongs to. */
export function monthKey(instant: Date | string, timeZone: string): string {
  const d = localDay(
    typeof instant === 'string' ? new Date(instant) : instant,
    timeZone,
  )
  return `${d.year}-${String(d.month).padStart(2, '0')}`
}

/** Weekdays (Monday to Friday) the range touches, counting each calendar day. */
export function weekdaysIn(range: DateRange, timeZone: string): number {
  let day = localDay(range.from, timeZone)
  const last = localDay(new Date(range.to.getTime() - 1), timeZone)
  const end = Date.UTC(last.year, last.month - 1, last.day)
  let count = 0
  for (let guard = 0; guard < 4000; guard++) {
    if (Date.UTC(day.year, day.month - 1, day.day) > end) break
    if (weekdayIndex(day) < 5) count += 1
    day = addDays(day, 1)
  }
  return count
}

// Money ----------------------------------------------------------------------

/** An amount in a currency: "£1,250.00", "€300.00". */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

/** Totals kept per currency, since a lab may buy in more than one. */
export type MoneyTotals = Record<string, number>

export function addMoney(
  totals: MoneyTotals,
  amount: number,
  currency: string,
): void {
  totals[currency] = Math.round(((totals[currency] ?? 0) + amount) * 100) / 100
}

/** "£1,200.00 · €300.00", or an empty string when there is nothing to show. */
export function formatTotals(totals: MoneyTotals): string {
  return Object.keys(totals)
    .sort()
    .map((currency) => formatMoney(totals[currency] ?? 0, currency))
    .join(' · ')
}

/** Hours as the lab reads them: "12.5". */
export function formatHours(hours: number): string {
  return hours.toLocaleString('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })
}

/** A share between 0 and 1 as a whole-number percentage. */
export function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`
}

/** "1 Nov 2026 to 30 Nov 2026": the days a period covers, last day included. */
export function formatRange(range: DateRange, timeZone: string): string {
  const day = (instant: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
      .format(instant)
      .replace('Sept', 'Sep')
  const last = new Date(range.to.getTime() - 1)
  const from = day(range.from)
  const to = day(last)
  return from === to ? from : `${from} to ${to}`
}

/** "Nov 2026" for a `YYYY-MM` month key. */
export function formatMonthKey(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return key
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'short',
    year: 'numeric',
  })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)))
    .replace('Sept', 'Sep')
}
