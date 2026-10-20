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

import { DataClientError } from '../data-client'
import type { DataClient } from '../data-client'
import { notebookDataClient } from '../notebook-data'
import type { InboxCounts } from './predicate'

export type WorkItemKind =
  | 'review_requested'
  | 'witness_requested'
  | 'run_failed'
  | 'run_waiting'
  | 'data_issue'
  | 'material_expiring'
  | 'cell_conflict'
  | 'approval_requested'
  | 'review_returned'
  | 'approval_unsigned'
  | 'witness_signed'
  | 'access_requested'
  | 'access_decided'
  | 'agent_proposal'
  | 'invitation_accepted'
  | 'verification_requested'
  | 'verification_granted'
  | 'sample_awaiting_release'
  | 'sample_hold_exceeded'
  | 'calibration_overdue'
  | 'qualification_requested'
  | 'qualification_granted'
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
  source_type?: string | null
  source_id?: string | null
  parser_version_id?: string | null
  connector_id?: string | null
  revision_id?: string | null
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
  sourceType?: string | null
  sourceId?: string | null
  parserVersionId?: string | null
  connectorId?: string | null
  revisionId?: string | null
}

const KINDS: readonly WorkItemKind[] = [
  'review_requested',
  'witness_requested',
  'run_failed',
  'run_waiting',
  'data_issue',
  'material_expiring',
  'cell_conflict',
  'approval_requested',
  'review_returned',
  'approval_unsigned',
  'witness_signed',
  'access_requested',
  'access_decided',
  'agent_proposal',
  'invitation_accepted',
  'verification_requested',
  'verification_granted',
  'sample_awaiting_release',
  'sample_hold_exceeded',
  'calibration_overdue',
  'qualification_requested',
  'qualification_granted',
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
    ...(row.revision_id ? { revisionId: row.revision_id } : {}),
    ...(row.source_type
      ? {
          sourceType: row.source_type,
          sourceId: row.source_id,
          parserVersionId: row.parser_version_id,
          connectorId: row.connector_id,
        }
      : {}),
  }
}

// ---------------------------------------------------------------------------
// Query keys and fetch.
// ---------------------------------------------------------------------------

export const workItemsQueryKeys = {
  list: () => ['work-items', 'list'] as const,
  seen: () => ['work-items', 'seen'] as const,
}

export const WORK_ITEMS_FETCH_LIMIT = 200

/**
 * QA2-Inbox-2 — a stalled read must fail, not spin forever. The Inbox route
 * has an error branch with a Try again control, but only a settled read reaches
 * it; without a bound the tab row sat on counters of 0 indefinitely.
 */
const WORK_ITEMS_TIMEOUT_MS = 30_000

async function fetchWithTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new DataClientError(
                'timeout',
                'Your inbox did not answer in time.',
                0,
              ),
            ),
          WORK_ITEMS_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchWorkItems(
  client: DataClient = notebookDataClient,
  limit: number = WORK_ITEMS_FETCH_LIMIT,
): Promise<WorkItem[]> {
  const rows = await fetchWithTimeout(
    client.list<WorkItemWire>(
      'my_work_items',
      `?select=kind,record_id,identifier,title,project_id,reason,due_at,state,created_at,source_type,source_id,parser_version_id,connector_id,revision_id&order=due_at.asc,created_at.desc&limit=${limit}`,
    ),
  )
  return rows.map((row) => toWorkItem(row))
}

/** The caller's seen item keys, the other half of the Inbox predicate. */
export async function fetchSeenItemKeys(
  client: DataClient = notebookDataClient,
): Promise<Set<string>> {
  const rows = await client.list<{ item_key: string }>(
    'work_item_views',
    '?select=item_key',
  )
  return new Set(rows.map((row) => row.item_key))
}

/**
 * The server-side count the sidebar badge is built from, over the same two
 * read models the list reads: `api.my_work_items` (the predicate's rows) and
 * `api.work_item_views` (the caller's seen keys). `fetchWorkItems` is a
 * `limit=200` preview, so its length understates a workspace with more than
 * 200 waiting items; this counts every row the caller can see, so Home states
 * the same number as the sidebar however large the workspace is.
 *
 * The predicate itself is restated in the function
 * (`drizzle/0433_inbox_needs_action_counts.sql`), which is the only place both
 * the seen state and the item identity are known without transferring rows.
 */
export async function fetchNeedsActionCounts(
  client: DataClient = notebookDataClient,
): Promise<InboxCounts> {
  const rows = await client.rpc<InboxCounts[]>('inbox_needs_action_counts', {})
  // An answer with no row is a failed count, not a zero: the same rule the
  // `count=exact` reads follow, so a degraded read cannot read as calm.
  if (rows.length === 0) {
    throw new DataClientError(
      'invalid_count',
      'The server did not return an exact count.',
      0,
    )
  }
  const [counts] = rows
  return { total: counts.total, reviews: counts.reviews }
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
    witness_requested: 0,
    run_failed: 0,
    run_waiting: 0,
    data_issue: 0,
    material_expiring: 0,
    cell_conflict: 0,
    approval_requested: 0,
    review_returned: 0,
    approval_unsigned: 0,
    witness_signed: 0,
    access_requested: 0,
    access_decided: 0,
    agent_proposal: 0,
    invitation_accepted: 0,
    verification_requested: 0,
    verification_granted: 0,
    sample_awaiting_release: 0,
    sample_hold_exceeded: 0,
    calibration_overdue: 0,
    qualification_requested: 0,
    qualification_granted: 0,
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
