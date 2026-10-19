/**
 * WORK-03.3 — the caller's notifications (api.my_notifications), with a
 * mark-all-read action. Read-only from the caller's own rows.
 */
import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'
import { objectPath, recordPath } from './navigation'

export interface NotificationItem {
  id: string
  eventType: string
  title: string
  body: string | null
  recordId: string | null
  projectId: string | null
  createdAt: string
  readAt: string | null
}

interface NotificationWire {
  id: string
  event_type: string
  title: string
  body: string | null
  record_id: string | null
  project_id: string | null
  created_at: string
  read_at: string | null
}

export const notificationsQueryKeys = {
  list: () => ['notifications', 'list'] as const,
}

export const NOTIFICATIONS_FETCH_LIMIT = 50

function toItem(row: NotificationWire): NotificationItem {
  return {
    id: row.id,
    eventType: row.event_type,
    title: row.title,
    body: row.body,
    recordId: row.record_id,
    projectId: row.project_id,
    createdAt: row.created_at,
    readAt: row.read_at,
  }
}

export async function fetchMyNotifications(
  client: DataClient = notebookDataClient,
  limit: number = NOTIFICATIONS_FETCH_LIMIT,
): Promise<NotificationItem[]> {
  const rows = await client.list<NotificationWire>(
    'my_notifications',
    `?select=id,event_type,title,body,record_id,project_id,created_at,read_at&order=created_at.desc&limit=${limit}`,
  )
  return rows.map((row) => toItem(row))
}

export async function markNotificationsRead(
  client: DataClient = notebookDataClient,
  ids: string[] | null = null,
): Promise<number> {
  return client.rpc<number>('mark_notifications_read', { p_ids: ids })
}

/** Notification types that are about a review of a record. */
const REVIEW_EVENTS: ReadonlySet<string> = new Set([
  'review_requested',
  'review_returned_or_signed',
  'signature_requested',
])

export function isReviewNotification(item: NotificationItem): boolean {
  return REVIEW_EVENTS.has(item.eventType) && item.recordId !== null
}

/** The newest review submission of a record, as the bell needs it. */
export interface LatestReview {
  revisionId: string
  state: string
}

/**
 * The newest review submission for each record the review notifications are
 * about, so the bell can open the review itself and not only the record.
 */
export async function fetchLatestReviews(
  items: readonly NotificationItem[],
  client: DataClient = notebookDataClient,
): Promise<Map<string, LatestReview>> {
  const recordIds = [
    ...new Set(
      items
        .filter(isReviewNotification)
        .map((item) => item.recordId)
        .filter((id): id is string => id !== null),
    ),
  ]
  const latest = new Map<string, LatestReview>()
  if (recordIds.length === 0) return latest
  const rows = await client.list<{
    record_id: string
    revision_id: string
    state: string
  }>(
    'review_submissions',
    `?record_id=in.(${recordIds.map(encodeURIComponent).join(',')})&select=record_id,revision_id,state&order=submitted_at.desc`,
  )
  // Newest first: keep the first row seen for each record.
  for (const row of rows) {
    if (!latest.has(row.record_id)) {
      latest.set(row.record_id, {
        revisionId: row.revision_id,
        state: row.state,
      })
    }
  }
  return latest
}

/**
 * Where a notification opens. It follows the Inbox's rules: a review request
 * or a signature request opens the review for its revision, a review that came
 * back opens the notebook where the changes are made, and anything else opens
 * the record it is about.
 */
export function notificationDestination(
  item: NotificationItem,
  latestReviews: ReadonlyMap<string, LatestReview> = new Map(),
): string | undefined {
  if (!item.recordId) return undefined
  if (REVIEW_EVENTS.has(item.eventType)) {
    const review = latestReviews.get(item.recordId)
    if (review && review.state !== 'returned') {
      return (
        objectPath('review', review.revisionId) ?? recordPath(item.recordId)
      )
    }
  }
  return recordPath(item.recordId)
}
