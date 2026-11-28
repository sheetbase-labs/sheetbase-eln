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

/** One line of a record's activity, whatever the feed it came from. */
export interface ActivityEntry {
  id: string
  /** When it happened, as an ISO timestamp: the entries group by its day. */
  at: string
  title: string
  target?: string
  actor?: string
  /** The time as the line says it: "4h ago". */
  when: string
}

/** One day of activity, with the day said as people say it. */
export interface ActivityDay {
  day: string
  label: string
  items: ActivityEntry[]
}

/** The first `limit` entries, in the order given, grouped by day. */
export function groupActivityByDay(
  entries: readonly ActivityEntry[],
  limit = RECENT_ACTIVITY_LIMIT,
): ActivityDay[] {
  const groups: ActivityDay[] = []

  for (const entry of entries.slice(0, limit)) {
    const key = dayKey(entry.at)
    const last = groups.at(-1)

    if (last?.day === key) last.items.push(entry)
    else
      groups.push({
        day: key,
        label: activityDayLabel(entry.at),
        items: [entry],
      })
  }

  return groups
}

/** The newest few days of activity, and how many events there are in all. */
export interface RecentActivity {
  groups: ActivityDay[]
  total: number
}

/** The last few events, newest first, grouped by day. */
export function recentActivityGroups(
  events: readonly TimelineEventWire[],
  nameOf: (userId: string) => string | undefined,
  limit = RECENT_ACTIVITY_LIMIT,
): RecentActivity {
  const newest = [...events].sort((a, b) => b.ts.localeCompare(a.ts))
  const mapped = mapTimelineEvents(newest, undefined, undefined, nameOf)

  const ts = new Map(
    newest.map((event) => [`${event.type}-${event.id}`, event.ts]),
  )

  const entries = mapped.map<ActivityEntry>((event) => ({
    id: event.id,
    at: ts.get(event.id) ?? '',
    title: event.title,
    target: event.target,
    actor: event.actor?.name,
    when: event.timestamp,
  }))

  return { groups: groupActivityByDay(entries, limit), total: mapped.length }
}
