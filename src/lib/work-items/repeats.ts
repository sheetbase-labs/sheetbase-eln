import type { WorkItem } from './data'

/**
 * Inbox items that say the same thing about the same object: a connector
 * whose imports keep failing the same way, a reminder raised twice. They are
 * separate work items (each run failed on its own), but listing them one
 * under another makes the Inbox look busier than it is.
 */
export function repeatKey(item: WorkItem): string {
  return [
    item.kind,
    item.connectorId ?? item.recordId ?? item.datasetId ?? item.identifier,
    item.title,
    item.reason,
  ].join('\u0000')
}

export interface InboxEntry {
  item: WorkItem
  /** The repeat group this row belongs to. */
  group: string
  /** How many items the group holds; set on the row that stands for it. */
  count: number
  /** The rows of the group: the first stands for it, the rest are repeats. */
  members: WorkItem[]
  /** A repeat shown under its group's first row, because it is expanded. */
  repeat: boolean
}

/**
 * Fold repeats into the first (newest-listed) item of each group, in list
 * order. An expanded group lists its other items straight after the first.
 */
export function collapseRepeats(
  items: readonly WorkItem[],
  expanded: ReadonlySet<string>,
): InboxEntry[] {
  const groups = new Map<string, WorkItem[]>()

  for (const item of items) {
    const key = repeatKey(item)
    const members = groups.get(key)

    if (members) members.push(item)
    else groups.set(key, [item])
  }

  const entries: InboxEntry[] = []

  for (const [group, members] of groups) {
    const [first, ...rest] = members
    entries.push({
      item: first,
      group,
      count: members.length,
      members,
      repeat: false,
    })

    if (expanded.has(group)) {
      for (const item of rest) {
        entries.push({ item, group, count: 1, members, repeat: true })
      }
    }
  }

  return entries
}
