import { t } from '#/copy'
import { Icon } from '#/components/icons'

import { cn } from '#/lib/utils'
import { useOthers } from '#/lib/collaboration/room-hooks'

import { useCollaborationRoomReady } from './room-ready'
import { coEditingPeerNames } from './co-editing-peers'
import type { CoEditingPeer } from './co-editing-peers'

/**
 * COLLAB-01 block-level co-editing awareness for Notebook blocks. While the
 * local user is editing a block, shows a subtle inline badge naming other
 * users whose presence reports the same `activeBlockId` with mode
 * 'editing'. Awareness only — no blocking, no lock UI; presence is never
 * authoritative.
 */

export function BlockCoEditBadge({
  blockId,
  active,
  className,
}: {
  /** Stable id of the block being edited locally. */
  blockId: string
  /** True while the local user is editing this block. */
  active: boolean
  className?: string
}) {
  const ready = useCollaborationRoomReady()

  if (!ready) return null

  return (
    <BlockCoEditBadgeInner
      blockId={blockId}
      active={active}
      className={className}
    />
  )
}

function BlockCoEditBadgeInner({
  blockId,
  active,
  className,
}: {
  blockId: string
  active: boolean
  className?: string
}) {
  const others: readonly CoEditingPeer[] = useOthers()

  if (!active) return null
  const names = coEditingPeerNames(others, blockId)

  if (names.length === 0) return null

  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary-text',
        className,
      )}
    >
      <Icon name="edit" className="size-3" aria-hidden="true" />
      {t('notebook.presenceCoEditing.editingHere', { names: names.join(', ') })}
    </span>
  )
}
