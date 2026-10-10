/**
 * Shell chrome data (SHELL). The top bar's notification bell and the
 * sidebar's pinned projects are per-user; both are read here on the server so
 * the shell renders them during SSR instead of flashing an empty rail.
 */
import { db } from '#/db/client.server'

import type { Notification, NotificationTarget } from '#/components/v3/types'

/** A pinned project as the sidebar renders it. */
export interface ShellPinned {
  id: string
  name: string
  tone: 'progress' | 'review'
}

interface PinnedRow {
  id: string
  title: string
  status: string | null
}

interface NotificationRow {
  id: string
  event_type: string
  title: string
  body: string | null
  record_id: string | null
  project_id: string | null
  created_at: Date
  read_at: Date | null
}

/** How many pinned projects the sidebar shows, as the design does. */
const PINNED_LIMIT = 3

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The caller's most recently pinned open projects, newest first. Tone is the
 * design's two-way split: work in progress (blue), work awaiting review
 * (violet).
 */
export async function getShellPinned(
  workspaceId: string,
  userId: string,
): Promise<ShellPinned[]> {
  const result = await db.$client.query<PinnedRow>(
    `select p.id, p.title, p.status
       from api.user_favourites f
       join api.projects p on p.id = f.object_id
      where f.workspace_id = $1
        and f.user_id = $2
        and f.object_kind = 'project'
        and p.archived_at is null
      order by f.created_at desc
      limit $3`,
    [workspaceId, userId, PINNED_LIMIT],
  )
  return result.rows.map((row) => ({
    id: row.id,
    name: row.title,
    // Work in progress reads blue; work awaiting review reads violet, as the
    // design's pinned rail shows.
    tone: row.status === 'in_review' ? 'review' : 'progress',
  }))
}

function notificationTarget(row: NotificationRow): NotificationTarget {
  const id = row.record_id ?? row.project_id ?? row.id
  if (row.event_type.includes('pipeline')) return { kind: 'pipeline-run', id }
  if (row.event_type.includes('dataset')) return { kind: 'dataset', id }
  if (row.event_type.includes('sample')) return { kind: 'sample', id }
  if (row.event_type.includes('sheet')) return { kind: 'sheet', id }
  return { kind: 'review', id }
}

function relativeWhen(createdAt: Date, now: Date): string {
  const seconds = Math.max(
    0,
    Math.round((now.getTime() - createdAt.getTime()) / 1000),
  )
  if (seconds < 60) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

/** The caller's most recent notifications, newest first. */
export async function getShellNotifications(
  workspaceId: string,
  userId: string,
): Promise<Notification[]> {
  const result = await db.$client.query<NotificationRow>(
    `select id, event_type, title, body, record_id, project_id,
            created_at, read_at
       from internal.notifications
      where workspace_id = $1 and user_id = $2
      order by created_at desc
      limit 12`,
    [workspaceId, userId],
  )
  const now = new Date()
  return result.rows.map((row) => ({
    id: row.id,
    to: notificationTarget(row),
    unread: row.read_at === null,
    html: escapeHtml(row.body ? `${row.title} — ${row.body}` : row.title),
    when: relativeWhen(row.created_at, now),
  }))
}
