/**
 * WORK-01.5 / QA2-Inbox-1 — the one Inbox predicate.
 *
 * "Needs action" is stated once here so the sidebar badge, Home's counts and
 * the Inbox list itself cannot disagree: an item needs action when it is
 * neither something the person follows nor something they have marked seen
 * (`api.work_item_views`) nor something the model already reports as done
 * today. The Inbox list filters its rows with these functions.
 *
 * The two *counts* — the sidebar badge and Home, which must state one number
 * however large the workspace is — cannot be a length of a page of rows, so
 * they are counted server-side by `api.inbox_needs_action_counts()`
 * (former migration 0433), which applies these same
 * rules in SQL over the same two read models and is covered against this file
 * by `tests/db/inbox-needs-action-counts.test.ts`.
 */

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
  | 'lab'
  | 'admin'
  | 'agents'
  | 'following'

/**
 * Stable key for an Inbox item across reloads: the identity
 * `mark_work_items_seen` stores and every surface reads back.
 */
export function itemKey(item: WorkItemIdentity): string {
  return `${item.kind}:${item.sourceId ?? item.recordId ?? item.identifier ?? item.title ?? 'Untitled'}`
}

/**
 * The kinds the Reviews filter shows. `api.inbox_needs_action_counts()`
 * counts the same list for Home's "to review" chip, so the two stay in step.
 */
const REVIEW_KINDS: ReadonlySet<string> = new Set([
  'review_requested',
  'witness_requested',
  'review_returned',
  'approval_unsigned',
  'witness_signed',
])

/** The Inbox type filter a kind belongs to. */
export function workItemType(kind: string): WorkItemType {
  if (REVIEW_KINDS.has(kind)) return 'reviews'
  if (kind === 'data_issue' || kind === 'cell_conflict') return 'data'
  if (kind === 'run_failed' || kind === 'run_waiting') return 'runs'
  if (kind === 'material_expiring') return 'materials'
  if (
    kind === 'sample_awaiting_release' ||
    kind === 'sample_hold_exceeded' ||
    kind === 'calibration_overdue' ||
    kind === 'qualification_granted'
  )
    return 'lab'
  if (
    kind === 'access_requested' ||
    kind === 'access_decided' ||
    kind === 'invitation_accepted' ||
    kind === 'verification_requested' ||
    kind === 'verification_granted' ||
    kind === 'qualification_requested'
  )
    return 'admin'
  if (kind === 'agent_proposal') return 'agents'
  return 'following'
}

/** Which Inbox tab an item belongs to. */
export function itemTab(
  item: WorkItemIdentity,
  seen: ReadonlySet<string>,
): InboxTab {
  if (item.state === 'following' || item.kind === 'following')
    return 'following'
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
