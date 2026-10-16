import { AvatarStack } from '#/components/v3/ui/avatar'
import { useOthers } from '#/lib/collaboration/liveblocks.config'

import { useCollaborationRoomReady } from './collaboration-room'

/**
 * COLLAB-01 avatar stack of the other users currently in the room. Purely
 * awareness: names, tooltips, a +N overflow and an "N here" accessible
 * label. Usable on any surface inside a `CollaborationRoom`; renders null
 * before the room provider mounts (SSR-stable) and when nobody else is in.
 */

/** Minimal structural shape of a Liveblocks "other" the stack reads. */
export interface PresenceStackPeer {
  connectionId?: number
  info?: { name?: string; avatar?: string }
}

export function PresenceStack({
  max = 4,
  className,
}: {
  /** How many avatars to show before collapsing into +N. */
  max?: number
  className?: string
}) {
  const ready = useCollaborationRoomReady()
  // Same gate as ThreadPanel: suspense room hooks throw outside a mounted
  // RoomProvider, so the pre-ready render must stay hook-free (and stable
  // across SSR and the first client paint).
  if (!ready) return null
  return <PresenceStackInner max={max} className={className} />
}

function PresenceStackInner({
  max,
  className,
}: {
  max: number
  className?: string
}) {
  const others = useOthers()
  // Liveblocks' `Other` type degrades when the global Presence override
  // fails its JsonObject validation (it does for this interface-based
  // contract), so read through a structural local type instead.
  const peers = others as readonly PresenceStackPeer[]
  if (peers.length === 0) return null
  const countLabel = `${peers.length} here`
  return (
    <AvatarStack
      label={countLabel}
      max={max}
      className={className}
      people={peers.map((peer, index) => ({
        id: `peer-${peer.connectionId ?? index}`,
        name: peer.info?.name?.trim() || 'Someone',
      }))}
    />
  )
}
