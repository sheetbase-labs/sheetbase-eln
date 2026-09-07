/**
 * Typed Sheetbase collaboration configuration (COLLAB). The single module
 * that knows about Liveblocks: product code imports hooks and types from
 * here, never from `@liveblocks/*` directly.
 *
 * Liveblocks carries presence, comments/threads, mentions and collaboration
 * notifications only. All canonical scientific state stays in PostgreSQL;
 * thread metadata holds stable identity anchors, never content.
 */

import type { ClientOptions } from '@liveblocks/client'
import * as React from 'react'

import type {
  CollaborationPresence,
  CollaborationUserMeta,
  ThreadAnchorMetadata,
} from '#/lib/collaboration/types'

declare global {
  interface Liveblocks {
    Presence: CollaborationPresence
    UserMeta: CollaborationUserMeta
    /** Flat stable-id anchors only (Liveblocks metadata is scalar-valued). */
    ThreadMetadata: ThreadAnchorMetadata
    RoomInfo: { name: string; url: string }
  }
}

/**
 * The browser client options. Auth always round-trips through Sheetbase:
 * `/api/collaboration/auth` resolves the Better Auth session, membership and
 * object access server-side and mints a least-privilege room token. The
 * resolver callbacks hit Sheetbase endpoints so names, deep links and mention
 * candidates are permission-filtered, never raw directories.
 */
export const collaborationClientOptions = {
  authEndpoint: '/api/collaboration/auth',
  throttle: 80,
  resolveUsers: async ({ userIds }: { userIds: string[] }) => {
    const response = await fetch(
      `/api/collaboration/resolve/users?ids=${encodeURIComponent(userIds.join(','))}`,
    )
    if (!response.ok) return userIds.map(() => undefined)
    const data = (await response.json()) as {
      users: Array<{ id: string; name: string; avatar: string | null }>
    }
    return userIds.map((id) => {
      const user = data.users.find((u) => u.id === id)
      return user
        ? { name: user.name, avatar: user.avatar ?? undefined }
        : undefined
    })
  },
  resolveRoomsInfo: async ({ roomIds }: { roomIds: string[] }) => {
    const response = await fetch(
      `/api/collaboration/resolve/rooms?ids=${encodeURIComponent(roomIds.join(','))}`,
    )
    if (!response.ok) return roomIds.map(() => undefined)
    const data = (await response.json()) as {
      rooms: Array<{ id: string; name: string; url: string }>
    }
    return roomIds.map((id) => data.rooms.find((r) => r.id === id) ?? undefined)
  },
  resolveMentionSuggestions: async ({
    text,
    roomId,
  }: {
    text: string
    roomId: string
  }) => {
    const params = new URLSearchParams({ room: roomId, text })
    const response = await fetch(`/api/collaboration/mentions?${params}`)
    if (!response.ok) return []
    const data = (await response.json()) as { userIds: string[] }
    return data.userIds
  },
} satisfies ClientOptions

// Re-exported suspense hooks: the only Liveblocks import surface for
// components. Every consumer renders inside <Suspense>.
export {
  LiveblocksProvider,
  RoomProvider,
  useCreateThread,
  useInboxNotificationThread,
  useInboxNotifications,
  useMarkAllInboxNotificationsAsRead,
  useMarkInboxNotificationAsRead,
  useMarkThreadAsResolved,
  useMarkThreadAsUnresolved,
  useMyPresence,
  useOthers,
  useRoom,
  useSelf,
  useThreads,
  useUnreadInboxNotificationsCount,
  useUpdateMyPresence,
  useUser,
} from '@liveblocks/react/suspense'

/**
 * Server-provided capability flag threaded through the router context.
 * Defaults to disabled so public/SSR shells never open a connection; the
 * root route sets it once from `auth.collaborationEnabled`.
 */
export const CollaborationEnabledContext = React.createContext(false)

/** True when the current deployment has collaboration enabled. */
export function useCollaborationEnabled(): boolean {
  return React.useContext(CollaborationEnabledContext)
}
