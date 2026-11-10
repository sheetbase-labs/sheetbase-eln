/**
 * React hooks over a joined collaboration room: who else is here, my own
 * presence, and the connection state. Everything reads from the provider that
 * `CollaborationRoom` mounts; outside a room the hooks report an empty room.
 */
import * as React from 'react'

import type { CollabProvider, CollabStatus } from './provider'
import type { CollaborationPresence } from './types'

export const RoomProviderContext = React.createContext<CollabProvider | null>(
  null,
)

/** The joined room's provider, or null outside a room / before it connects. */
export function useRoomProvider(): CollabProvider | null {
  return React.useContext(RoomProviderContext)
}

export interface RoomPeer {
  /** The Yjs client id of this connection (one person can have several). */
  connectionId: number
  /** The signed-in user the connection belongs to. */
  id: string
  info: { name: string; avatar?: string; color: string }
  presence: CollaborationPresence
}

/** Everyone else in the room, one entry per open tab. */
export function useOthers(): readonly RoomPeer[] {
  const provider = useRoomProvider()

  const cache = React.useRef<{ key: string; peers: RoomPeer[] }>({
    key: '',
    peers: [],
  })

  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (!provider) return () => {}

      provider.awareness.on('change', notify)

      return () => provider.awareness.off('change', notify)
    },
    [provider],
  )

  const getSnapshot = React.useCallback(() => {
    if (!provider) return cache.current.peers
    const peers: RoomPeer[] = []
    provider.awareness.getStates().forEach((state, clientId) => {
      if (clientId === provider.doc.clientID) return

      // SAFETY: y-protocols awareness stores whatever each client published; `CollabProvider.publishPresence` in this module's provider is the only writer and publishes exactly these fields under `user`.
      const user = state.user as
        | { id?: string; name?: string; avatar?: string | null; color?: string }
        | undefined

      if (!user?.id) return
      peers.push({
        connectionId: clientId,
        id: user.id,
        info: {
          name: user.name ?? '',
          avatar: user.avatar ?? undefined,
          color: user.color ?? '#6b7280',
        },
        // SAFETY: the same publisher writes `presence` from `CollabProvider.setPresence`, whose argument is a `Partial<CollaborationPresence>` merged into one.
        presence: (state.presence ?? {}) as CollaborationPresence,
      })
    })
    peers.sort((a, b) => a.connectionId - b.connectionId)
    const key = JSON.stringify(peers)

    if (key === cache.current.key) return cache.current.peers
    cache.current = { key, peers }

    return peers
  }, [provider])

  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Merge fields into my presence. Safe to call before the room connects. */
export function useUpdateMyPresence(): (
  patch: Partial<CollaborationPresence>,
) => void {
  const provider = useRoomProvider()

  return React.useCallback((patch) => provider?.setPresence(patch), [provider])
}

export interface RoomConnection {
  status: CollabStatus
  synced: boolean
  canWrite: boolean
}

const OFFLINE: RoomConnection = {
  status: 'disconnected',
  synced: false,
  canWrite: false,
}

/** Connection state of the joined room (disconnected outside a room). */
export function useRoomConnection(): RoomConnection {
  const provider = useRoomProvider()
  const cache = React.useRef<RoomConnection>(OFFLINE)

  const subscribe = React.useCallback(
    (notify: () => void) => provider?.subscribe(notify) ?? (() => {}),
    [provider],
  )

  const getSnapshot = React.useCallback(() => {
    if (!provider) return OFFLINE

    const next = {
      status: provider.status,
      synced: provider.synced,
      canWrite: provider.canWrite,
    }

    const prev = cache.current

    if (
      prev.status === next.status &&
      prev.synced === next.synced &&
      prev.canWrite === next.canWrite
    ) {
      return prev
    }

    cache.current = next

    return next
  }, [provider])

  return React.useSyncExternalStore(subscribe, getSnapshot, () => OFFLINE)
}
