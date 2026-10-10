import { Avatar } from '#/components/v3/ui/avatar'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { cn } from '#/lib/utils'
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

/** Pure splitter so overflow maths is testable without rendering. */
export function presenceStackEntries(
  peers: readonly PresenceStackPeer[],
  max: number,
): { visible: PresenceStackPeer[]; overflow: number } {
  return {
    visible: peers.slice(0, Math.max(0, max)),
    overflow: Math.max(0, peers.length - max),
  }
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join('')
  return initials || '?'
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
  const { visible, overflow } = presenceStackEntries(peers, max)
  const countLabel = `${peers.length} here`
  return (
    <div
      role="group"
      aria-label={countLabel}
      title={countLabel}
      className={cn('flex items-center -space-x-1.5', className)}
    >
      {visible.map((other, index) => {
        const name = other.info?.name?.trim() || 'Someone'
        return (
          <Tooltip key={other.connectionId ?? index} content={name}>
            <span
              aria-label={name}
              title={name}
              className="inline-flex ring-2 ring-surface"
            >
              <Avatar initials={initialsFor(name)} size="sm" />
            </span>
          </Tooltip>
        )
      })}
      {overflow > 0 ? (
        <span
          aria-hidden="true"
          title={`${overflow} more`}
          className="inline-flex size-6 items-center justify-center rounded-full bg-surface-muted text-[10px] font-medium ring-2 ring-surface"
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}
