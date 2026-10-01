/**
 * WORK-01.5 — the Inbox work-items data layer.
 *
 * Reads the `api.my_work_items` security-invoker view (WORK-01.2), which
 * already applies the caller's RLS, and presents it as the Inbox list: typed
 * items, type counts and due-date groups (today, next 7 days, later) plus the
 * following bucket. The list is invalidated by change events in
 * `src/lib/live-events.ts`.
 */
import { useQuery } from '@tanstack/react-query'

import type { DataClient } from '../data-client'
import { notebookDataClient } from '../notebook-data'

export type WorkItemKind =
  | 'review_requested'
  | 'run_failed'
  | 'data_issue'
  | 'material_expiring'
  | 'following'
export type WorkItemState =
  'needs_action' | 'following' | 'overdue' | 'done_today'

/** Wire shape of `api.my_work_items` (snake_case via PostgREST). */
export interface WorkItemWire {
  kind: string
  record_id: string | null
  identifier: string | null
  title: string | null
  project_id: string | null
  reason: string
  due_at: string | null
  state: string
  created_at: string | null
}

/** A resolved work item ready to render. */
export interface WorkItem {
  kind: WorkItemKind
  recordId: string | null
  identifier: string | null
  title: string
  projectId: string | null
  reason: string
  dueAt: string | null
  state: WorkItemState
  createdAt: string | null
}

const KINDS: readonly WorkItemKind[] = [
  'review_requested',
  'run_failed',
  'data_issue',
  'material_expiring',
  'following',
]
const STATES: readonly WorkItemState[] = [
  'needs_action',
  'following',
  'overdue',
  'done_today',
]

function asKind(value: string): WorkItemKind {
  return (KINDS as readonly string[]).includes(value)
    ? (value as WorkItemKind)
    : 'following'
}

function asState(value: string): WorkItemState {
  return (STATES as readonly string[]).includes(value)
    ? (value as WorkItemState)
    : 'needs_action'
}

export function toWorkItem(
  row: WorkItemWire,
  now: Date = new Date(),
): WorkItem {
  const dueAt = row.due_at
  let state = asState(row.state)
  // The view computes overdueness from the due date; keep it authoritative but
  // never let a client clock disagree about a future due date.
  if (state === 'needs_action' && dueAt && Date.parse(dueAt) < now.getTime()) {
    state = 'overdue'
  }
  return {
    kind: asKind(row.kind),
    recordId: row.record_id,
    identifier: row.identifier,
    title: row.title ?? row.identifier ?? 'Untitled',
    projectId: row.project_id,
    reason: row.reason,
    dueAt,
    state,
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Query keys and fetch.
// ---------------------------------------------------------------------------

export const workItemsQueryKeys = {
  list: () => ['work-items', 'list'] as const,
}

export const WORK_ITEMS_FETCH_LIMIT = 200

export async function fetchWorkItems(
  client: DataClient = notebookDataClient,
  limit: number = WORK_ITEMS_FETCH_LIMIT,
): Promise<WorkItem[]> {
  const rows = await client.list<WorkItemWire>(
    'my_work_items',
    `?select=kind,record_id,identifier,title,project_id,reason,due_at,state,created_at&order=created_at.desc&limit=${limit}`,
  )
  return rows.map((row) => toWorkItem(row))
}

/** The Inbox list, refetched when a change event invalidates its key. */
export function useWorkItems(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: workItemsQueryKeys.list(),
    queryFn: () => fetchWorkItems(client),
    staleTime: 30_000,
    retry: false,
  })
}

// ---------------------------------------------------------------------------
// Counts and grouping.
// ---------------------------------------------------------------------------

export function countByKind(
  items: readonly WorkItem[],
): Record<WorkItemKind, number> {
  const counts: Record<WorkItemKind, number> = {
    review_requested: 0,
    run_failed: 0,
    data_issue: 0,
    material_expiring: 0,
    following: 0,
  }
  for (const item of items) counts[item.kind] += 1
  return counts
}

export interface WorkItemGroups {
  /** Needs action, due today or overdue. */
  today: WorkItem[]
  /** Needs action, due within the next seven days. */
  nextSevenDays: WorkItem[]
  /** Needs action, due later or with no due date. */
  later: WorkItem[]
  /** Items the user follows (no action needed). */
  following: WorkItem[]
}

const DAY_MS = 86_400_000

function startOfDay(date: Date): number {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy.getTime()
}

/**
 * Groups needs-action items by due date (today, next seven days, later) and
 * keeps follows separate, matching the Inbox design's sections.
 */
export function groupWorkItems(
  items: readonly WorkItem[],
  now: Date = new Date(),
): WorkItemGroups {
  const today = startOfDay(now)
  const tomorrow = today + DAY_MS
  const nextWeek = today + 8 * DAY_MS
  const groups: WorkItemGroups = {
    today: [],
    nextSevenDays: [],
    later: [],
    following: [],
  }
  for (const item of items) {
    if (item.state === 'following' || item.kind === 'following') {
      groups.following.push(item)
      continue
    }
    const due = item.dueAt ? Date.parse(item.dueAt) : Number.NaN
    if (Number.isNaN(due)) {
      groups.later.push(item)
    } else if (due < tomorrow) {
      groups.today.push(item)
    } else if (due < nextWeek) {
      groups.nextSevenDays.push(item)
    } else {
      groups.later.push(item)
    }
  }
  return groups
}
