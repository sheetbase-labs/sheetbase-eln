import * as React from 'react'

import { CollabProvider, collabUrl } from '#/lib/collaboration/provider'
import { RoomProviderContext } from '#/lib/collaboration/room-hooks'
import { buildRoomId } from '#/lib/collaboration/room-ids'
import type { CollaborationObjectKind } from '#/lib/collaboration/types'

/**
 * COLLAB room boundary. Joins one room on the bundled co-editing server for the
 * subtree below it:
 *
 * 1. Hydration mount guard: the connection only exists after hydration, so SSR
 *    markup is identical to the first client render.
 * 2. Quiet failure: a dropped or refused connection never takes the page down.
 *    Presence and live editing simply go quiet while saving carries on as it
 *    always did, through the database.
 *
 * When `roomId` is null (collaboration off, or no canonical identity) children
 * render unchanged, so callers can wrap whole pages unconditionally.
 *
 * Consumers of room state use `useCollaborationRoomReady()`: it flips true only
 * once the connection object exists, and room hooks are safe to call anywhere
 * (they report an empty room until then).
 */

const RoomReadyContext = React.createContext(false)

/** True when the enclosing CollaborationRoom has joined its room. */
export function useCollaborationRoomReady(): boolean {
  return React.useContext(RoomReadyContext)
}

/**
 * Builds a canonical room id without throwing. Room ids require UUIDs; a
 * null result simply means "no collaboration for this surface".
 */
export function safeBuildRoomId(
  workspaceId: string | null | undefined,
  kind: CollaborationObjectKind,
  objectId: string | null | undefined,
): string | null {
  if (!workspaceId || !objectId) return null
  try {
    return buildRoomId(workspaceId, kind, objectId)
  } catch {
    return null
  }
}

export function CollaborationRoom({
  roomId,
  children,
}: {
  roomId: string | null
  children: React.ReactNode
}) {
  const [provider, setProvider] = React.useState<CollabProvider | null>(null)

  React.useEffect(() => {
    if (!roomId) return
    let joined: CollabProvider | null = null
    try {
      joined = new CollabProvider(collabUrl(roomId, window.location))
      setProvider(joined)
    } catch (error) {
      // Quiet by design: collaboration failures are non-authoritative and
      // must never break the scientific record surfaces around them.
      console.error('Collaboration room error', error)
    }
    return () => {
      joined?.destroy()
      setProvider(null)
    }
  }, [roomId])

  return (
    <RoomReadyContext.Provider value={provider !== null}>
      <RoomProviderContext.Provider value={provider}>
        {children}
      </RoomProviderContext.Provider>
    </RoomReadyContext.Provider>
  )
}
