import * as React from 'react'

import { buildRoomId } from '#/lib/collaboration/room-ids'
import type { CollaborationObjectKind } from '#/lib/collaboration/types'
import { RoomProvider } from '#/lib/collaboration/liveblocks.config'

/**
 * COLLAB-02 room boundary. Wraps a subtree in a single Liveblocks room with
 * the safety scaffolding every collaboration surface needs:
 *
 * 1. Hydration mount guard — the provider (and therefore the websocket
 *    client) only exists after hydration, so SSR markup is identical to the
 *    first client render and no room hooks can run on the server.
 * 2. An error boundary with a quiet fallback — a Liveblocks outage must
 *    never take the surrounding page down.
 * 3. A Suspense boundary — the suspense-flavoured room hooks suspend here.
 *
 * When `roomId` is null (collaboration disabled or no canonical identity)
 * children render unchanged, so callers can wrap whole pages unconditionally.
 *
 * Room-hook consumers (ThreadPanel etc.) must additionally gate themselves
 * with `useCollaborationRoomReady()`: it flips true only once the provider
 * is actually mounted, which keeps them rendering null — never crashing —
 * during SSR and the pre-hydration paint.
 */

const RoomReadyContext = React.createContext(false)

/** True when the enclosing CollaborationRoom has mounted its RoomProvider. */
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

class CollaborationErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    // Quiet by design: collaboration failures are non-authoritative and
    // must never break the scientific record surfaces around them.
    console.error('Collaboration room error', error)
  }
  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}

export function CollaborationRoom({
  roomId,
  children,
}: {
  roomId: string | null
  children: React.ReactNode
}) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  if (!mounted || !roomId) {
    return (
      <RoomReadyContext.Provider value={false}>
        {children}
      </RoomReadyContext.Provider>
    )
  }

  return (
    <RoomReadyContext.Provider value={true}>
      <CollaborationErrorBoundary>
        <React.Suspense fallback={null}>
          <RoomProvider
            id={roomId}
            // CollaborationPresence is an interface, so it does not
            // structurally satisfy Liveblocks' JsonObject constraint even
            // though every field is JSON-serialisable; cast past the brand.
            initialPresence={
              {
                selection: null,
                activeBlockId: null,
                activeFieldId: null,
              } as never
            }
          >
            {children}
          </RoomProvider>
        </React.Suspense>
      </CollaborationErrorBoundary>
    </RoomReadyContext.Provider>
  )
}
