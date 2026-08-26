import { PencilLine } from 'lucide-react'

import { cn } from '#/lib/utils'
import { useOthers } from '#/lib/collaboration/liveblocks.config'

import { useCollaborationRoomReady } from './collaboration-room'

/**
 * COLLAB-01 block-level co-editing awareness for Notebook blocks. While the
 * local user is editing a block, shows a subtle inline badge naming other
 * users whose presence reports the same `activeBlockId` with mode
 * 'editing'. Awareness only — no blocking, no lock UI; presence is never
 * authoritative.
 */

/** Minimal structural shape of a Liveblocks "other" the badge reads. */
export interface CoEditingPeer {
  connectionId?: number
  info?: { name?: string }
  presence?: {
    activeBlockId?: string | null
    mode?: 'viewing' | 'editing'
  }
}

/** Pure: names of peers actively editing the given block. */
export function coEditingPeerNames(
  peers: readonly CoEditingPeer[],
  blockId: string,
): string[] {
  const names: string[] = []
  for (const peer of peers) {
    if (peer.presence?.mode !== 'editing') continue
    if (peer.presence.activeBlockId !== blockId) continue
    names.push(peer.info?.name?.trim() || 'Someone')
  }
  return names
}

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
  const others = useOthers() as unknown as readonly CoEditingPeer[]
  if (!active) return null
  const names = coEditingPeerNames(others, blockId)
  if (names.length === 0) return null
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary',
        className,
      )}
    >
      <PencilLine className="size-3" aria-hidden="true" />
      {names.join(', ')} {names.length === 1 ? 'is' : 'are'} editing here
    </span>
  )
}
