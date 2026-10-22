/**
 * Cron expressions for pipeline triggers (pure, deterministic).
 *
 * Five fields — minute, hour, day of month, month, day of week — each a list
 * of `*`, a number, an `a-b` range, optionally with a `/step`. Day of week is
 * 0–7 (0 and 7 are Sunday). When both day-of-month and day-of-week are
 * restricted a day matches if EITHER does, as in every cron since Vixie's.
 *
 * Evaluation happens on the wall clock of an explicit IANA zone, so "09:00
 * every weekday" stays at 09:00 across daylight-saving changes. The database
 * mirrors this in api.pipeline_cron_next so the RPCs can stamp next_run_at;
 * this module drives the sweep, the form's preview and the plain-language
 * label.
 */

export interface CronFields {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  daysOfWeek: number[]
  /** The day-of-month field started with `*`. */
  anyDayOfMonth: boolean
  /** The day-of-week field started with `*`. */
  anyDayOfWeek: boolean
}

const FIELD_RE = /^(\*|\d{1,3}(?:-\d{1,3})?)(?:\/([1-9]\d{0,2}))?$/

function parseField(field: string, min: number, max: number): number[] | null {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const match = FIELD_RE.exec(part)
    if (!match) return null
    const [, range, stepText] = match
    const step = stepText ? Number(stepText) : 1
    let lo: number
    let hi: number
    if (range === '*') {
      lo = min
      hi = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number)
      lo = a
      hi = b
    } else {
      lo = Number(range)
      hi = stepText ? max : lo
    }
    if (lo < min || hi > max || lo > hi) return null
    for (let value = lo; value <= hi; value += step) values.add(value)
  }
  return [...values].sort((a, b) => a - b)
}

/** The parsed expression, or null when it is not a valid 5-field cron. */
export function parseCron(expression: unknown): CronFields | null {
  if (typeof expression !== 'string') return null
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const minutes = parseField(parts[0], 0, 59)
  const hours = parseField(parts[1], 0, 23)
  const daysOfMonth = parseField(parts[2], 1, 31)
  const months = parseField(parts[3], 1, 12)
  const rawDays = parseField(parts[4], 0, 7)
  if (!minutes || !hours || !daysOfMonth || !months || !rawDays) return null
  const daysOfWeek = [...new Set(rawDays.map((d) => d % 7))].sort(
    (a, b) => a - b,
  )
  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    anyDayOfMonth: parts[2].startsWith('*'),
    anyDayOfWeek: parts[4].startsWith('*'),
  }
}

/** How many calendar days ahead a search looks: four years, so 29 February fires. */
const MAX_DAYS = 1500

function dayMatches(
  fields: CronFields,
  y: number,
  mo: number,
  d: number,
): boolean {
  if (!fields.months.includes(mo)) return false
  const dayOfWeek = new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
  const domOk = fields.daysOfMonth.includes(d)
  const dowOk = fields.daysOfWeek.includes(dayOfWeek)
  if (fields.anyDayOfMonth && fields.anyDayOfWeek) return true
  if (fields.anyDayOfMonth) return dowOk
  if (fields.anyDayOfWeek) return domOk
  return domOk || dowOk
}

/** Offset of `zone` at an instant: wall clock read as UTC minus the instant. */
function offsetAt(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(at))
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  return (
    Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    ) - at
  )
}

/** The calendar date on `zone`'s wall clock at an instant. */
function zonedDate(at: number, zone: string) {
  const offset = offsetAt(at, zone)
  const local = new Date(at + offset)
  return {
    y: local.getUTCFullYear(),
    mo: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
  }
}

/** The instant a wall-clock time falls on in `zone` (gap times move forward). */
function instantOf(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  zone: string,
): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  const first = wall - offsetAt(wall, zone)
  return wall - offsetAt(first, zone)
}

/**
 * The first instant strictly after `from` that matches, or null when the
 * expression is invalid or never fires within four years.
 */
export function nextCronAfter(
  expression: string,
  zone: string,
  from: Date,
): Date | null {
  const fields = parseCron(expression)
  if (!fields) return null
  const start = zonedDate(from.getTime(), zone)
  for (let i = 0; i < MAX_DAYS; i += 1) {
    const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + i))
    const y = day.getUTCFullYear()
    const mo = day.getUTCMonth() + 1
    const d = day.getUTCDate()
    if (!dayMatches(fields, y, mo, d)) continue
    for (const hour of fields.hours) {
      for (const minute of fields.minutes) {
        const at = instantOf(y, mo, d, hour, minute, zone)
        if (at > from.getTime()) return new Date(at)
      }
    }
  }
  return null
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

function clock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * A cron expression in plain language when it is one of the shapes the form
 * offers, otherwise the expression itself. Never invents a reading.
 */
export function describeCron(expression: string): string {
  const fields = parseCron(expression)
  if (!fields) return expression
  const single = (values: number[]) => (values.length === 1 ? values[0] : null)
  const hour = single(fields.hours)
  const minute = single(fields.minutes)
  const everyMonth = fields.months.length === 12
  if (hour !== null && minute !== null && everyMonth) {
    const at = clock(hour, minute)
    if (fields.anyDayOfMonth && fields.anyDayOfWeek) return `Daily at ${at}`
    if (fields.anyDayOfMonth) {
      const days = fields.daysOfWeek
      if (days.join() === '1,2,3,4,5') return `Weekdays at ${at}`
      if (days.join() === '0,6') return `Weekends at ${at}`
      if (days.length === 1) return `Every ${WEEKDAY_NAMES[days[0]]} at ${at}`
    }
    if (fields.anyDayOfWeek && fields.daysOfMonth.length === 1) {
      const day = fields.daysOfMonth[0]
      return `Monthly on day ${day} at ${at}`
    }
  }
  return expression
}
