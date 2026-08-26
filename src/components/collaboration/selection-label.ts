import type { PresenceSelection } from '#/lib/collaboration/types'

/**
 * COLLAB-01 pure label helpers for remote sheet-selection chips. Kept free
 * of React and room hooks so the toolbar chip logic is directly testable.
 */

/** Minimal structural shape of a Liveblocks "other" the helpers read. */
export interface SelectionPeer {
  connectionId?: number
  info?: { name?: string; avatar?: string }
  selection?: PresenceSelection | null
}

export interface RemoteSelectionChip {
  /** Stable React key (connection id, falling back to list index). */
  key: string
  name: string
  rowsLabel: string
}

/**
 * Row-count label for one remote selection. Sheet selections are broadcast
 * as stable row keys (`sb-row-v1` hashes or local row UUIDs), which carry no
 * ordinal information — an exact count is only knowable for a single cell,
 * so ranges degrade honestly to "multiple rows" instead of inventing a
 * number. Absent selection data yields an empty label (chips skip it).
 */
export function selectionRowsLabel(
  selection: PresenceSelection | null | undefined,
): string {
  if (!selection || !selection.rowKey) return ''
  const isRange =
    typeof selection.endRowKey === 'string' &&
    selection.endRowKey !== '' &&
    selection.endRowKey !== selection.rowKey
  return isRange ? 'multiple rows' : '1 row'
}

/**
 * Compact chips for the sheet toolbar: at most one per other user whose
 * presence carries selection metadata. Users without selection data are
 * skipped, so absent COLLAB-02 broadcast data renders nothing rather than
 * empty shells.
 */
export function remoteSelectionChips(
  peers: readonly SelectionPeer[],
): RemoteSelectionChip[] {
  const chips: RemoteSelectionChip[] = []
  for (const [index, peer] of peers.entries()) {
    const rowsLabel = selectionRowsLabel(peer.selection)
    if (!rowsLabel) continue
    chips.push({
      key:
        peer.connectionId !== undefined
          ? String(peer.connectionId)
          : `peer-${index}`,
      name: peer.info?.name?.trim() || 'Someone',
      rowsLabel,
    })
  }
  return chips
}
