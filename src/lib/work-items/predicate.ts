/**
 * WORK-01.5 / QA2-Inbox-1 — the one Inbox predicate.
 *
 * "Needs action" is stated once here so the sidebar badge, Home's counts and
 * the Inbox list itself cannot disagree: an item needs action when it is
 * neither something the person follows nor something they have marked seen
 * (`api.work_item_views`) nor something the model already reports as done
 * today. The server (`inbox-counts.server.ts`) and the Inbox/Hone components
 * all call these functions, so a change lands on every surface at once.
 */

/** The states `api.my_work_items` marks as needing a person. */
export const NEEDS_ACTION_STATES = ['needs_action', 'overdue'] as const

/** The fields every Inbox identity is computed from. */
export interface WorkItemIdentity {
  kind: string
  state: string
  recordId: string | null
  identifier: string | null
  title: string | null
  sourceId?: string | null
}

export type InboxTab = 'needs-action' | 'following' | 'done-today'

export type WorkItemType =
  | 'reviews'
  | 'data'
  | 'runs'
  | 'materials'
  | 'following'

/**
 * Stable key for an Inbox item across reloads: the identity
 * `mark_work_items_seen` stores and every surface reads back.
 */
export function itemKey(item: WorkItemIdentity): string {
  return `${item.kind}:${item.sourceId ?? item.recordId ?? item.identifier ?? item.title ?? 'Untitled'}`
}

/** The Inbox type filter a kind belongs to. */
export function workItemType(kind: string): WorkItemType {
  if (kind === 'review_requested' || kind === 'witness_requested')
    return 'reviews'
  if (kind === 'data_issue' || kind === 'cell_conflict') return 'data'
  if (kind === 'run_failed' || kind === 'run_waiting') return 'runs'
  if (kind === 'material_expiring') return 'materials'
  return 'following'
}

/** Which Inbox tab an item belongs to. */
export function itemTab(
  item: WorkItemIdentity,
  seen: ReadonlySet<string>,
): InboxTab {
  if (item.state === 'following' || item.kind === 'following') return 'following'
  if (seen.has(itemKey(item)) || item.state === 'done_today')
    return 'done-today'
  return 'needs-action'
}

/** Whether an item is still waiting on the person. */
export function needsAction(
  item: WorkItemIdentity,
  seen: ReadonlySet<string>,
): boolean {
  return itemTab(item, seen) === 'needs-action'
}

export interface InboxCounts {
  /** Every needs-action item, the sidebar badge's number. */
  total: number
  /** The subset the Inbox's Reviews filter (and Home's "to review" chip) shows. */
  reviews: number
}

/** Count needs-action items, and their Reviews subset, with the shared predicate. */
export function countNeedsAction<T extends WorkItemIdentity>(
  items: readonly T[],
  seen: ReadonlySet<string>,
): InboxCounts {
  let total = 0
  let reviews = 0
  for (const item of items) {
    if (!needsAction(item, seen)) continue
    total += 1
    if (workItemType(item.kind) === 'reviews') reviews += 1
  }
  return { total, reviews }
}
