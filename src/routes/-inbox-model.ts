/**
 * The Inbox's vocabulary and its list derivation.
 *
 * Kept out of the route module so the page composes state, rows and rendering
 * instead of owning the tab names, the type chips and the due-date sections as
 * well. Everything here is pure: the same inputs give the same rows.
 */
import { z } from 'zod'

import type { Tone } from '#/components/ui/status'
import { t } from '#/copy'
import type {
  WorkItem,
  WorkItemGroups,
  WorkItemKind,
} from '#/lib/work-items/data'
import { itemKey } from '#/lib/work-items/predicate'
import type { InboxTab, WorkItemType } from '#/lib/work-items/predicate'
import { rowKey } from '#/lib/work-items/inbox-rows'
import { collapseRepeats } from '#/lib/work-items/repeats'
import type { InboxEntry } from '#/lib/work-items/repeats'

export type InboxType = WorkItemType

/** The due-date bucket a Needs-action row is listed under. */
export type InboxGroup = 'overdue' | 'today' | 'nextSevenDays' | 'later'

/** One section of the list: its bucket (null for a single list), its rows and
 * the rows folded into repeat groups. */
export type InboxSection = [InboxGroup | null, WorkItem[], InboxEntry[]]

export const INBOX_TABS = ['needs-action', 'following', 'done-today'] as const

export const INBOX_TYPES = [
  'reviews',
  'data',
  'runs',
  'materials',
  'lab',
  'admin',
  'agents',
  'following',
] as const

/** The tab names as plain strings, for the guard below. */
const INBOX_TAB_NAMES: readonly string[] = INBOX_TABS

/** Whether a tab control's value names an Inbox tab. */
export function isInboxTab(value: string): value is InboxTab {
  return INBOX_TAB_NAMES.includes(value)
}

/** The Inbox's URL state: the tab, the type chip and the selected row. */
export const inboxSearchSchema = z.object({
  // The selected item lives in the URL, so a reload, Back and a shared link
  // land on the same row.
  item: z.string().min(1).optional().catch(undefined),
  tab: z.enum(INBOX_TABS).optional().catch(undefined),
  type: z.enum(INBOX_TYPES).optional().catch(undefined),
})

export type InboxSearch = z.infer<typeof inboxSearchSchema>

export const tabLabels = new Map<InboxTab, string>()

export const tabs: [InboxTab, string][] = [
  ['needs-action', t('projects.inbox.tabs.needsAction')],
  ['following', t('projects.inbox.tabs.following')],
  ['done-today', t('projects.inbox.tabs.doneToday')],
]

for (const [name, label] of tabs) tabLabels.set(name, label)

export const types: [InboxType, string, Tone, WorkItemKind][] = [
  ['reviews', t('projects.inbox.types.reviews'), 'review', 'review_requested'],
  ['data', t('projects.inbox.types.data'), 'bad', 'data_issue'],
  ['runs', t('projects.inbox.types.runs'), 'analysis', 'run_failed'],
  [
    'materials',
    t('projects.inbox.types.materials'),
    'warn',
    'material_expiring',
  ],
  ['lab', t('projects.inbox.types.lab'), 'lab', 'sample_awaiting_release'],
  ['admin', t('projects.inbox.types.admin'), 'stored', 'access_requested'],
  ['agents', t('projects.inbox.types.agents'), 'progress', 'agent_proposal'],
]

export function toneFor(kind: WorkItemKind): Tone {
  if (kind === 'review_requested' || kind === 'witness_requested')
    return 'review'

  if (kind === 'data_issue') return 'bad'

  if (kind === 'run_failed') return 'bad'

  // A run waiting for a person is actionable, not broken.
  if (kind === 'run_waiting') return 'warn'

  if (
    kind === 'material_expiring' ||
    kind === 'reorder_requested' ||
    kind === 'reorder_incoming'
  )
    return 'warn'

  // A returned review, an unsigned approval and an overdue calibration are
  // waiting on the person, not broken.
  if (kind === 'review_returned' || kind === 'approval_unsigned') return 'warn'

  // Lab items share the Lab filter's own colour, apart from Materials.
  if (
    kind === 'sample_awaiting_release' ||
    kind === 'sample_hold_exceeded' ||
    kind === 'calibration_overdue' ||
    kind === 'qualification_requested' ||
    kind === 'qualification_granted'
  )
    return 'lab'

  if (kind === 'agent_proposal' || kind === 'agent_action_request')
    return 'progress'

  if (kind === 'watcher_finding' || kind === 'qc_violation') return 'warn'

  if (kind === 'witness_signed') return 'review'

  // A conflict is actionable: two edits need a person to choose between them.
  if (kind === 'cell_conflict') return 'warn'

  return 'stored'
}

/** The type label is always the type; how late it is reads in the due column. */
export function labelFor(kind: WorkItemKind): string {
  switch (kind) {
    case 'calibration_overdue':
      return t('projects.inbox.kinds.calibration_overdue')
    case 'qualification_requested':
      return t('projects.inbox.kinds.qualification_requested')
    case 'qualification_granted':
      return t('projects.inbox.kinds.qualification_granted')
    case 'witness_requested':
      return t('projects.inbox.kinds.witness_requested')
    case 'review_requested':
      return t('projects.inbox.kinds.review_requested')
    case 'data_issue':
      return t('projects.inbox.kinds.data_issue')
    case 'run_failed':
      return t('projects.inbox.kinds.run_failed')
    case 'run_waiting':
      return t('projects.inbox.kinds.run_waiting')
    case 'material_expiring':
      return t('projects.inbox.kinds.material_expiring')
    case 'reorder_requested':
      return t('projects.inbox.kinds.reorder_requested')
    case 'reorder_incoming':
      return t('projects.inbox.kinds.reorder_incoming')
    case 'cell_conflict':
      return t('projects.inbox.kinds.cell_conflict')
    case 'review_returned':
      return t('projects.inbox.kinds.review_returned')
    case 'approval_unsigned':
      return t('projects.inbox.kinds.approval_unsigned')
    case 'witness_signed':
      return t('projects.inbox.kinds.witness_signed')
    case 'access_requested':
      return t('projects.inbox.kinds.access_requested')
    case 'access_decided':
      return t('projects.inbox.kinds.access_decided')
    case 'agent_proposal':
      return t('projects.inbox.kinds.agent_proposal')
    case 'agent_action_request':
      return t('projects.inbox.kinds.agent_action_request')
    case 'watcher_finding':
      return t('projects.inbox.kinds.watcher_finding')
    case 'qc_violation':
      return t('projects.inbox.kinds.qc_violation')
    case 'pipeline_item':
      return t('projects.inbox.kinds.pipeline_item')
    case 'plugin_note':
      return t('projects.inbox.kinds.plugin_note')
    case 'invitation_accepted':
      return t('projects.inbox.kinds.invitation_accepted')
    case 'verification_requested':
      return t('projects.inbox.kinds.verification_requested')
    case 'verification_granted':
      return t('projects.inbox.kinds.verification_granted')
    case 'sample_awaiting_release':
      return t('projects.inbox.kinds.sample_awaiting_release')
    case 'sample_hold_exceeded':
      return t('projects.inbox.kinds.sample_hold_exceeded')
    case 'project_following':
      return t('account.follow.projectKind')
    default:
      return t('projects.inbox.kinds.following')
  }
}

/**
 * The second line of a row says what to do. A calibration's reason repeats the
 * due date the row's due column already shows, so it names the action instead.
 */
export function rowReason(item: WorkItem): string {
  return item.kind === 'calibration_overdue'
    ? t('projects.inbox.calibrationReason')
    : item.reason
}

/**
 * The Later bucket is the tab's only group when every visible row lives in it
 * (in this workspace every needs-action item is undated, so that is the whole
 * tab).
 */
export function laterHoldsEveryRow(
  visible: readonly WorkItem[],
  laterKeys: ReadonlySet<WorkItem>,
): boolean {
  return visible.length > 0 && visible.every((item) => laterKeys.has(item))
}

/** The rows the Later collapse hides, before the person expands it. */
export function visibleInboxRows({
  visible,
  laterExpanded,
  laterKeys,
}: {
  visible: readonly WorkItem[]
  laterExpanded: boolean
  laterKeys: ReadonlySet<WorkItem>
}): WorkItem[] {
  return visible.filter((item) => laterExpanded || !laterKeys.has(item))
}

/**
 * The sections the list draws: due-date buckets on Needs action, one list on
 * every other tab.
 */
export function inboxDueSections({
  tab,
  groups,
  visibleKeys,
  laterExpanded,
  shown,
}: {
  tab: InboxTab
  groups: WorkItemGroups
  visibleKeys: ReadonlySet<string>
  laterExpanded: boolean
  shown: WorkItem[]
}): [InboxGroup | null, WorkItem[]][] {
  if (tab !== 'needs-action') return [[null, shown]]

  const inView = (item: WorkItem) => visibleKeys.has(itemKey(item))

  return [
    ['overdue', groups.overdue.filter(inView)],
    ['today', groups.today.filter(inView)],
    ['nextSevenDays', groups.nextSevenDays.filter(inView)],
    ['later', laterExpanded ? groups.later.filter(inView) : []],
  ]
}

/** Items that repeat one another fold into one row per section. */
export function inboxSections(
  dueSections: readonly [InboxGroup | null, WorkItem[]][],
  expandedRepeats: ReadonlySet<string>,
): InboxSection[] {
  return dueSections.map(([group, rows]) => [
    group,
    rows,
    collapseRepeats(rows, expandedRepeats),
  ])
}

/** Every row the sections list, in on-screen order. */
export function orderedInboxRows(
  sections: readonly InboxSection[],
): WorkItem[] {
  return sections.flatMap(([, , entries]) => entries.map((entry) => entry.item))
}

/** The row the URL names, or the first one when it names none of them. */
export function selectedInboxRow(
  orderedRows: readonly WorkItem[],
  selectedKey: string | null,
): WorkItem | undefined {
  return (
    orderedRows.find((item) => rowKey(item) === selectedKey) ?? orderedRows[0]
  )
}

/**
 * What the toolbar and the bulk actions count. A folded repeat is still
 * selected with its group, so the counts and the bulk action read every listed
 * item, not only the rows on screen (QA3-inbox-1).
 */
export interface InboxSelectionCounts {
  /** How many listed items are checked, folded repeats included. */
  selectedCount: number
  /** The item keys "Mark selected seen" sends. */
  selectedSeenKeys: string[]
  /** The item keys "Mark all seen" sends. */
  markableKeys: string[]
}

export function inboxSelectionCounts({
  visible,
  selection,
  tab,
}: {
  visible: readonly WorkItem[]
  selection: ReadonlySet<string>
  tab: InboxTab
}): InboxSelectionCounts {
  return {
    selectedCount: visible.filter((item) => selection.has(rowKey(item))).length,
    // Bulk select: the checked rows that still need action are what "Mark
    // selected seen" acts on.
    selectedSeenKeys: visible
      .filter((item) => selection.has(rowKey(item)) && tab === 'needs-action')
      .map(itemKey),
    // QA3-inbox-1 — "Mark all seen" acts on the items the current tab shows,
    // not on every needs-action item.
    markableKeys: tab === 'needs-action' ? visible.map(itemKey) : [],
  }
}
