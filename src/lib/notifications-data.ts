/**
 * WORK-03.3 — the caller's notifications (api.my_notifications), with a
 * mark-all-read action. Read-only from the caller's own rows.
 */
import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'

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
