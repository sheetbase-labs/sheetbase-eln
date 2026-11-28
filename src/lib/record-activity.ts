/**
 * A record page's recent activity: the newest few timeline events, grouped by
 * the day they happened, with the day said as people say it.
 */
import { mapTimelineEvents } from '#/components/audit/record-history-events'
import type { TimelineEventWire } from '#/lib/sign-002'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

/** How many events the side panel shows before "All history". */
export const RECENT_ACTIVITY_LIMIT = 5

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

/** "Today", "Yesterday" or the date, for a group of the day's events. */
export function activityDayLabel(iso: string, now = new Date()): string {
  const day = new Date(iso)

  const start = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

  const days = Math.round((start(now) - start(day)) / 86_400_000)

  if (days === 0) return t('notebook.recordPage.today')

  if (days === 1) return t('notebook.recordPage.yesterday')

  return formatDate(day, { year: day.getFullYear() !== now.getFullYear() })
}

/** The last few events, newest first, grouped by day. */
export function recentActivityGroups(
  events: readonly TimelineEventWire[],
  nameOf: (userId: string) => string | undefined,
  limit = RECENT_ACTIVITY_LIMIT,
) {
  const newest = [...events].sort((a, b) => b.ts.localeCompare(a.ts))
  const mapped = mapTimelineEvents(newest, undefined, undefined, nameOf)

  const ts = new Map(
    newest.map((event) => [`${event.type}-${event.id}`, event.ts]),
  )

  const groups: { day: string; label: string; items: typeof mapped }[] = []

  for (const event of mapped.slice(0, limit)) {
    const at = ts.get(event.id) ?? ''
    const key = dayKey(at)
    const last = groups.at(-1)

    if (last?.day === key) last.items.push(event)
    else groups.push({ day: key, label: activityDayLabel(at), items: [event] })
  }

  return { groups, total: mapped.length }
}
