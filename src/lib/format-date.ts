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
  const iso =
    typeof value === 'string'
      ? /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T12:00:00Z`
        : value
      : value.toISOString()
  const { time = false, year = true } = options
  return formatInstant(iso, {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' as const } : {}),
    ...(time
      ? { hour: '2-digit' as const, minute: '2-digit' as const, hour12: false }
      : {}),
  }).replace('Sept', 'Sep')
}
