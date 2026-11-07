/**
 * Shell chrome data (SHELL). The top bar's notification bell and the
 * sidebar's pins are per-user; both are read here on the server so
 * the shell renders them during SSR instead of flashing an empty rail.
 */
import { db } from '#/db/client.server'
import {
  notebookTemplatePath,
  objectPath,
  recordDestination,
} from '#/lib/navigation'

import type { Notification, NotificationTarget } from '#/components/types'

/**
 * A pin as the sidebar renders it: under the page it belongs to (`page` is a
 * sidebar page key such as `experiments` or `instruments`).
 */
export interface ShellPinned {
  kind: string
  id: string
  name: string
  page: string
  to: string
}

interface PinnedRow {
  kind: string
  id: string
  name: string | null
  page: string | null
  record_kind: string | null
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

/** The most pins the sidebar lists under any one page. */
const PINS_PER_PAGE = 8

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Every pin of the caller's, newest first, each placed under the sidebar page
 * that lists that kind of thing. A record goes under the page for its kind
 * (Experiments, Samples, ...) or the page its model is ticked for (Requests,
 * Incidents, Registry). Pins with no sidebar page, and archived or deleted
 * things, are left out.
 */
export async function getShellPinned(
  workspaceId: string,
  userId: string,
): Promise<ShellPinned[]> {
  const result = await db.$client.query<PinnedRow>(
    `select f.object_kind as kind, f.object_id as id, f.created_at,
            coalesce(r.title, r.identifier, p.title, d.name, s.name, t.name,
                     i.name, pd.name, av.name) as name,
            r.kind as record_kind,
            case f.object_kind
              when 'project' then 'projects'
              when 'dataset' then 'datasets'
              when 'sheet' then 'datasets'
              when 'notebook_template' then 'templates'
              when 'instrument' then 'instruments'
              when 'pipeline' then 'pipelines'
              when 'analysis_view' then 'analysis'
              when 'record' then case
                when r.kind = 'experiment' then 'experiments'
                when r.kind = 'sample' then 'samples'
                when r.kind = 'material' then 'materials'
                when r.kind = 'protocol_template' then 'protocols'
                when r.kind = 'report' then 'reports'
                when exists (select 1 from api.request_details q
                              where q.record_id = r.id) then 'requests'
                when exists (select 1 from api.model_incident_logs l
                              where l.workspace_id = r.workspace_id
                                and l.model_key = r.kind) then 'incidents'
                when exists (select 1 from api.record_models m
                              where m.workspace_id = r.workspace_id
                                and m.key = r.kind and m.is_registry) then 'registry'
              end
            end as page
       from api.user_favourites f
       left join api.records r
         on f.object_kind = 'record' and r.id = f.object_id
        and r.archived_at is null and r.deleted_at is null
       left join api.projects p
         on f.object_kind = 'project' and p.id = f.object_id
        and p.archived_at is null
       left join api.datasets d
         on f.object_kind = 'dataset' and d.id = f.object_id
        and d.archived_at is null
       left join api.sheet_instances s
         on f.object_kind = 'sheet' and s.id = f.object_id
       left join api.notebook_templates t
         on f.object_kind = 'notebook_template' and t.id = f.object_id
       left join api.instruments i
         on f.object_kind = 'instrument' and i.id = f.object_id
       left join api.pipeline_definitions pd
         on f.object_kind = 'pipeline' and pd.id = f.object_id
       left join api.analysis_views av
         on f.object_kind = 'analysis_view' and av.id = f.object_id
      where f.workspace_id = $1
        and f.user_id = $2
      order by f.created_at desc, f.object_kind, f.object_id`,
    [workspaceId, userId],
  )
  const perPage = new Map<string, number>()
  const pins: ShellPinned[] = []
  for (const row of result.rows) {
    if (!row.page || !row.name) continue
    const seen = perPage.get(row.page) ?? 0
    if (seen >= PINS_PER_PAGE) continue
    const to = pinPath(row)
    if (!to) continue
    perPage.set(row.page, seen + 1)
    pins.push({
      kind: row.kind,
      id: row.id,
      name: row.name,
      page: row.page,
      to,
    })
  }
  return pins
}

function pinPath(row: PinnedRow): string | null {
  switch (row.kind) {
    case 'record':
      return recordDestination(row.record_kind ?? 'record', row.id)
    case 'notebook_template':
      return notebookTemplatePath(row.id)
    case 'analysis_view':
      return objectPath('analysis', row.id)
    default:
      return objectPath(row.kind, row.id)
  }
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

/** The pages this lab took out of everyone's sidebar (Settings > Lab setup >
 * Sidebar). A read that fails hides nothing. */
export async function getShellHiddenPages(
  workspaceId: string,
): Promise<string[]> {
  try {
    const result = await db.$client.query<{ hidden_nav_pages: string[] }>(
      `select hidden_nav_pages from api.workspace_settings where workspace_id = $1`,
      [workspaceId],
    )
    return result.rows[0]?.hidden_nav_pages ?? []
  } catch {
    return []
  }
}
