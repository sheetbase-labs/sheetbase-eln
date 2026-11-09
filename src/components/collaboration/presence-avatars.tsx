import { AvatarStack } from '#/components/ui/avatar'
import { useOthers } from '#/lib/collaboration/room-hooks'

import { useCollaborationRoomReady } from './collaboration-room'

/**
 * COLLAB-01 avatar stack of the other users currently in the room. Purely
 * awareness: names, tooltips, a +N overflow and an "N here" accessible
 * label. Usable on any surface inside a `CollaborationRoom`; renders null
 * before the room provider mounts (SSR-stable) and when nobody else is in.
 */

/** Minimal structural shape of a peer the stack reads. */
export interface PresenceStackPeer {
  connectionId?: number
  /** The signed-in user the connection belongs to. */
  id?: string
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

  // Stable across SSR and the first client paint: nothing renders until the
  // room is joined.
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
  const peers: readonly PresenceStackPeer[] = others

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
        userId: peer.id,
      }))}
    />
  )
}
