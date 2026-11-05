/**
 * Calendar subscriptions (migration 0079): a private link that puts the
 * Schedule's bookings in the calendar a person already uses. The secret in the
 * link is shown once, when it is made, and is not kept.
 */
import type { DataClient } from '#/lib/data-client'

export const calendarFeedKeys = {
  all: ['calendar-feeds'] as const,
}

export type FeedScope = 'mine' | 'instrument' | 'all'

export interface CalendarFeedRow {
  id: string
  scope: FeedScope
  resource_id: string | null
  label: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export async function fetchCalendarFeeds(
  client: DataClient,
): Promise<CalendarFeedRow[]> {
  return client.list<CalendarFeedRow>(
    'calendar_feeds',
    '?revoked_at=is.null&order=created_at.desc&select=id,scope,resource_id,label,created_at,last_used_at,revoked_at',
  )
}

export async function createCalendarFeed(
  client: DataClient,
  input: { scope: FeedScope; resourceId: string | null; label: string },
): Promise<{ id: string; token: string }> {
  return client.rpc<{ id: string; token: string }>('create_calendar_feed', {
    p_scope: input.scope,
    p_resource_id: input.scope === 'instrument' ? input.resourceId : null,
    p_label: input.label.trim() || null,
  })
}

export async function revokeCalendarFeed(
  client: DataClient,
  feedId: string,
): Promise<void> {
  await client.rpc<unknown>('revoke_calendar_feed', { p_feed_id: feedId })
}

/** The address a calendar app subscribes to. */
export function feedUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/api/calendar/feed/${token}.ics`
}

/** Calendar apps that take a webcal link open the subscription directly. */
export function webcalUrl(url: string): string {
  return url.replace(/^https?:/, 'webcal:')
}
