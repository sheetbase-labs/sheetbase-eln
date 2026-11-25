/**
 * Time of day and duration values, shared by every surface that reads or
 * writes them (record forms, sheets, imports, the assistant, pipelines).
 *
 * The database is the authority (`internal.lab_time_or_null`,
 * `internal.lab_duration_seconds`); these helpers apply the same rules so a
 * person sees the problem before saving.
 *
 * - A time is a 24-hour wall-clock time with no date or zone. It is stored
 *   as `HH:MM:SS` (09:10 is stored as `09:10:00`) so values sort correctly.
 * - A duration is stored as a number of seconds, zero or more. People type
 *   it with units (`2 h 30 min`, `90 s`, `1.5 h`) or as `h:mm:ss`.
 */

import { z } from 'zod'

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

/** The database's upper bound: just under 100 years. */
export const MAX_DURATION_SECONDS = 3_155_760_000

/** `HH:MM:SS` for a typed time, or null when it is not a 24-hour time. */
export function parseTimeOfDay(input: string): string | null {
  const trimmed = input.trim()

  const twelveHour =
    /^(\d{1,2})(?::([0-5]\d))?(?::([0-5]\d))?\s*([ap])\.?m\.?$/i.exec(trimmed)

  if (twelveHour) {
    const hour = Number(twelveHour[1])

    if (hour < 1 || hour > 12) return null
    const pm = twelveHour[4].toLowerCase() === 'p'
    const h24 = (hour % 12) + (pm ? 12 : 0)

    return `${pad(h24)}:${twelveHour.at(2) ?? '00'}:${twelveHour.at(3) ?? '00'}`
  }

  const match = TIME_RE.exec(trimmed)

  if (!match) return null

  return `${pad(Number(match[1]))}:${match[2]}:${match.at(3) ?? '00'}`
}

/** True for a stored time value (`HH:MM:SS`, or `HH:MM` from older callers). */
export function isTimeOfDay(value: string): boolean {
  return TIME_RE.test(value)
}

/** `09:10` for a stored `09:10:00`; seconds stay when they are not zero. */
export function formatTimeOfDay(value: string): string {
  const canonical = parseTimeOfDay(value)

  if (!canonical) return value

  return canonical.endsWith(':00') ? canonical.slice(0, 5) : canonical
}

const UNIT_SECONDS: ReadonlyArray<[RegExp, number]> = [
  [/^(d|day|days)$/, 86_400],
  [/^(h|hr|hrs|hour|hours)$/, 3_600],
  [/^(m|min|mins|minute|minutes)$/, 60],
  [/^(s|sec|secs|second|seconds)$/, 1],
  [/^(ms|millisecond|milliseconds)$/, 0.001],
]

function unitSeconds(unit: string): number | null {
  const lower = unit.toLowerCase()

  for (const [pattern, seconds] of UNIT_SECONDS)
    if (pattern.test(lower)) return seconds

  return null
}

/**
 * Seconds for a typed duration, or null when it can't be read. A bare number
 * is refused because it could be seconds, minutes or hours; a JSON number is
 * already seconds.
 */
export function parseDuration(input: string | number): number | null {
  const stored = z.number().safeParse(input)

  if (stored.success)
    return Number.isFinite(stored.data) &&
      stored.data >= 0 &&
      stored.data <= MAX_DURATION_SECONDS
      ? stored.data
      : null

  const trimmed = String(input).trim()

  if (trimmed === '') return null

  const clock = /^(\d+):([0-5]\d)(?::([0-5]\d(?:\.\d+)?))?$/.exec(trimmed)

  if (clock)
    return bounded(
      Number(clock[1]) * 3_600 + Number(clock[2]) * 60 + Number(clock.at(3) ?? 0),
    )

  const iso =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      trimmed,
    )

  if (iso && trimmed.length > 1 && !/T$/i.test(trimmed))
    return bounded(
      Number(iso.at(1) ?? 0) * 86_400 +
        Number(iso.at(2) ?? 0) * 3_600 +
        Number(iso.at(3) ?? 0) * 60 +
        Number(iso.at(4) ?? 0),
    )

  if (!/^(?:\d+(?:\.\d+)?\s*[a-z]+[\s,]*)+$/i.test(trimmed)) return null
  let total = 0

  for (const match of trimmed.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gi)) {
    const seconds = unitSeconds(match[2])

    if (seconds === null) return null
    total += Number(match[1]) * seconds
  }

  return bounded(total)
}

function bounded(seconds: number): number | null {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    seconds > MAX_DURATION_SECONDS
  )
    return null

  return Math.round(seconds * 1000) / 1000
}

/** `2 h 30 min`, `45 s`, `1 d 2 h`; `0 s` for zero. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return String(seconds)

  if (seconds === 0) return '0 s'
  const parts: string[] = []
  let rest = seconds
  const days = Math.floor(rest / 86_400)

  rest -= days * 86_400
  const hours = Math.floor(rest / 3_600)

  rest -= hours * 3_600
  const minutes = Math.floor(rest / 60)

  rest = Math.round((rest - minutes * 60) * 1000) / 1000

  if (days) parts.push(`${days} d`)

  if (hours) parts.push(`${hours} h`)

  if (minutes) parts.push(`${minutes} min`)

  if (rest) parts.push(`${rest} s`)

  return parts.join(' ')
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Typed or pasted input for a time or duration field, as its stored value.
 * Input that can't be read comes back unchanged so validation fails closed.
 */
export function coerceTimeOrDurationInput(
  logicalType: 'time' | 'duration',
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Record inputs, sheet cells and import cells arrive as raw text or JSON; anything that does not read is returned unchanged so validation fails closed.
  raw: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- The unread raw input is returned as it arrived.
): unknown {
  if (logicalType === 'time') {
    const text = z.string().safeParse(raw)

    return text.success ? (parseTimeOfDay(text.data) ?? raw) : raw
  }

  const typed = z.union([z.string(), z.number()]).safeParse(raw)

  return typed.success ? (parseDuration(typed.data) ?? raw) : raw
}

/** How a stored time or duration reads in a cell or on a record page. */
export function displayTimeOrDuration(
  logicalType: 'time' | 'duration',
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Stored JSON values are shown as they are when they are not the expected shape.
  value: unknown,
): string {
  if (value === null || value === undefined) return ''

  const time = z.string().safeParse(value)

  if (logicalType === 'time' && time.success) return formatTimeOfDay(time.data)

  const seconds = z.number().safeParse(value)

  if (logicalType === 'duration' && seconds.success)
    return formatDuration(seconds.data)

  return JSON.stringify(value)
}

/** Typed text for a time or duration field as its stored value, or the text unchanged. */
export function timeOrDurationFromText(
  logicalType: 'time' | 'duration',
  text: string,
): string | number {
  if (logicalType === 'time') return parseTimeOfDay(text) ?? text

  return parseDuration(text) ?? text
}
