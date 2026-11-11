import { paneKind } from '#/lib/workspace-state'
import type { WorkspaceTab } from '#/lib/workspace-state'
import { LINK_MIME } from './use-record-links'

/** The row selected in the pane that drives this one, when this one follows. */
export function followedSelectionFor(
  tab: WorkspaceTab,
  paneId: string,
  selected: Record<string, string | undefined>,
): string | undefined {
  const link = tab.links.find((entry) => entry.followerIds.includes(paneId))

  return link ? selected[link.driverId] : undefined
}

/** The largest scrolling region inside a pane, for linked scrolling. */
export function mainScroller(pane: Element): HTMLElement | null {
  let best: HTMLElement | null = null
  let extent = 1

  for (const element of pane.querySelectorAll<HTMLElement>('*')) {
    const overflow = getComputedStyle(element).overflowY

    if (overflow !== 'auto' && overflow !== 'scroll') continue
    const room = element.scrollHeight - element.clientHeight

    if (room > extent) {
      best = element
      extent = room
    }
  }

  return best
}

/** Whether a drag carries one of this workspace's record links. */
export function carriesRecordLink(transfer: DataTransfer): boolean {
  return transfer.types.includes(LINK_MIME)
}

/** The name a page gives itself when it is kept without a title. */
export function pageTitleFor(href: string) {
  return paneKind(href).label
}
