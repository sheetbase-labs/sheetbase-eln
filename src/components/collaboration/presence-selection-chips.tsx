import { cn } from '#/lib/utils'
import { useOthers } from '#/lib/collaboration/liveblocks.config'

import { useCollaborationRoomReady } from './collaboration-room'
import { remoteSelectionChips } from './selection-label'
import type { SelectionPeer } from './selection-label'

/**
 * COLLAB-01 compact chips showing where other users have a sheet selection.

 * Reads each other user's `presence.selection` (stable row keys only);
 * surfaces without selection broadcast simply render nothing, so the chips
 * are tolerant of the COLLAB-02 sheet work populating that data later.
 */
export function RemoteSelectionChips({
  onSelect,
  className,
}: {
  /** Optional click affordance (e.g. scroll to the selected range). */
  onSelect?: (connectionId: string) => void
  className?: string
}) {
  const ready = useCollaborationRoomReady()
  if (!ready) return null
  return <RemoteSelectionChipsInner onSelect={onSelect} className={className} />
}

function RemoteSelectionChipsInner({
  onSelect,
  className,
}: {
  onSelect?: (connectionId: string) => void
  className?: string
}) {
  const others = useOthers()
  // Structural read-through: see the note in presence-avatars.tsx on the
  // degraded Liveblocks `Other` type for this Presence contract.
  const peers = others as unknown as readonly SelectionPeer[]
  const chips = remoteSelectionChips(peers)
  if (chips.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {chips.map((chip) =>
        onSelect ? (
          <button
            key={chip.key}
            type="button"
            className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
            onClick={() => onSelect(chip.key)}
          >
            {chip.name} · {chip.rowsLabel}
          </button>
        ) : (
          <span
            key={chip.key}
            title={`${chip.name} · ${chip.rowsLabel}`}
            className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-primary/60"
            />
            {chip.name} · {chip.rowsLabel}
          </span>
        ),
      )}
    </div>
  )
}
