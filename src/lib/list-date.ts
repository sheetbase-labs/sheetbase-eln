import { formatInstant } from './display-time-zone'

const DAY = { year: 'numeric', month: 'numeric', day: 'numeric' } as const

function dayOf(date: Date): string {
  return formatInstant(date.toISOString(), DAY)
}

/**
 * A date as the lists read it: the time for today ("09:40"), "Yesterday", the
 * day and month for this year ("22 Sep"), and the year as well for any other
 * ("1 Oct 2025"). `now` is the app clock, so the design clock pins it.
 */
export function formatListDate(
  iso: string | null | undefined,
  now: Date,
): string {
  if (!iso) return '—'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  if (dayOf(at) === dayOf(now))
    return formatInstant(iso, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  if (dayOf(at) === dayOf(new Date(now.getTime() - 24 * 60 * 60 * 1000)))
    return 'Yesterday'
  const sameYear =
    formatInstant(iso, { year: 'numeric' }) ===
    formatInstant(now.toISOString(), { year: 'numeric' })
  return formatInstant(iso, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).replace('Sept', 'Sep')
}
