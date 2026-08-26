'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { formatDistanceToNowStrict } from 'date-fns'
import { Bell } from 'lucide-react'

import type { CommentBody, InboxNotificationData } from '@liveblocks/client'

import {
  useCollaborationEnabled,
  useInboxNotificationThread,
  useInboxNotifications,
  useMarkAllInboxNotificationsAsRead,
  useMarkInboxNotificationAsRead,
  useUnreadInboxNotificationsCount,
} from '#/lib/collaboration/liveblocks.config'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyIcon,
  EmptyTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
} from '#/components/ui'
import { cn } from '#/lib/utils'

/**
 * COLLAB-03 in-app notification centre: a compact bell in the app-shell
 * top bar that opens an inbox popover backed by Liveblocks inbox
 * notifications.
 *
 * Safety scaffolding mirrors CollaborationRoom:
 *
 * 1. Hydration mount guard — nothing renders before the first client
 *    render, so SSR markup is stable and no inbox hooks can run on the
 *    server.
 * 2. A capability gate on `useCollaborationEnabled()` — public and
 *    unconfigured deployments never render the bell at all.
 * 3. An error boundary with a quiet fallback plus a Suspense boundary —
 *    the suspense-flavoured inbox hooks suspend here, and a Liveblocks
 *    outage must never take the surrounding page down.
 *
 * Display names come from `/api/collaboration/resolve/users` and object
 * context / deep links from `/api/collaboration/resolve/rooms` via
 * react-query. Both endpoints are permission-filtered server-side: a room
 * the caller cannot access resolves to nothing, and the item degrades to
 * a generic "New activity" row without a link — so the inbox can never
 * leak the existence of inaccessible objects.
 */

interface ResolvedRoom {
  id: string
  name: string
  url: string
}

interface ResolvedUser {
  id: string
  name: string
  avatar?: string | null
}

/** Batch-resolves room names and permission-aware deep links, keyed by id. */
function useResolvedRooms(roomIds: string[]): Record<string, ResolvedRoom> {
  const ids = [...new Set(roomIds)].sort().join(',')
  const { data } = useQuery({
    queryKey: ['collaboration', 'resolve', 'rooms', ids],
    queryFn: async () => {
      if (!ids) return {}
      const response = await fetch(
        `/api/collaboration/resolve/rooms?ids=${encodeURIComponent(ids)}`,
      )
      if (!response.ok) {
        throw new Error(`Room resolution failed (${response.status})`)
      }
      const data = (await response.json()) as { rooms: ResolvedRoom[] }
      return Object.fromEntries(data.rooms.map((room) => [room.id, room]))
    },
    enabled: ids.length > 0,
    staleTime: 60_000,
  })
  return data ?? {}
}

/** Batch-resolves actor display names and avatars, keyed by user id. */
function useResolvedUsers(userIds: string[]): Record<string, ResolvedUser> {
  const ids = [...new Set(userIds)].sort().join(',')
  const { data } = useQuery({
    queryKey: ['collaboration', 'resolve', 'users', ids],
    queryFn: async () => {
      if (!ids) return {}
      const response = await fetch(
        `/api/collaboration/resolve/users?ids=${encodeURIComponent(ids)}`,
      )
      if (!response.ok) {
        throw new Error(`User resolution failed (${response.status})`)
      }
      const data = (await response.json()) as { users: ResolvedUser[] }
      return Object.fromEntries(data.users.map((user) => [user.id, user]))
    },
    enabled: ids.length > 0,
    staleTime: 60_000,
  })
  return data ?? {}
}

const EXCERPT_KEYS = ['excerpt', 'message', 'body', 'content', 'title']

function truncate(text: string, max = 120): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/**
 * The latest custom-kind activity payload. Workspace-defined activity data
 * is a scalar record by contract (`ActivityData`), but it crosses the
 * Liveblocks cache boundary generically, so read it defensively.
 */
function lastActivityData(
  notification: InboxNotificationData,
): Record<string, unknown> {
  if (!('activities' in notification)) return {}
  const data: unknown = notification.activities.at(-1)?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  // Scalar-record shape is guaranteed by Liveblocks' ActivityData contract;
  // the local alias just restores key-level access after the unknown guard.
  return data as Record<string, unknown>
}

/** First readable string field of the latest activity, truncated. */
function customActivityExcerpt(
  notification: InboxNotificationData,
): string | null {
  const data = lastActivityData(notification)
  for (const key of EXCERPT_KEYS) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return truncate(value)
  }
  return null
}

/** Plain-text projection of a Liveblocks comment body for excerpts. */
function commentBodyText(body: CommentBody | null | undefined): string | null {
  if (!body) return null
  const text = body.content
    // Relax-typed inline elements carry no usable discriminant; text nodes
    // are exactly the ones with a string `text` field.
    .map((block) =>
      block.children
        .map((child) =>
          'text' in child && typeof child.text === 'string' ? child.text : '',
        )
        .join(''),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? truncate(text) : null
}

/**
 * Actor user id derivable without extra reads: mention notifications carry
 * `createdBy`, custom kinds may stamp `userId` into their activity data.
 * Thread kinds resolve their actor through `useInboxNotificationThread`.
 */
function directActorId(notification: InboxNotificationData): string | null {
  if (notification.kind === 'textMention') return notification.createdBy
  const userId = lastActivityData(notification).userId
  return typeof userId === 'string' && userId ? userId : null
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

class InboxErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    // Quiet by design: notification failures must never break the shell.
    console.error('Notification inbox error', error)
  }
  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}

export function NotificationInbox() {
  const [mounted, setMounted] = React.useState(false)
  const enabled = useCollaborationEnabled()
  React.useEffect(() => setMounted(true), [])

  // Public routes share this shell; collaboration surfaces appear only on
  // capable deployments, and only after hydration.
  if (!mounted || !enabled) return null

  return (
    <InboxErrorBoundary>
      <React.Suspense fallback={<BellButton disabled />}>
        <NotificationInboxInner />
      </React.Suspense>
    </InboxErrorBoundary>
  )
}

function BellButton({
  unreadCount = 0,
  ...props
}: {
  unreadCount?: number
} & Omit<React.ComponentProps<typeof Button>, 'children'>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Notifications"
      className={cn('relative', props.className)}
      {...props}
    >
      <Bell className="size-3.5" aria-hidden="true" />
      {unreadCount > 0 ? (
        <Badge
          className="absolute -right-1.5 -top-1.5 h-3.5 min-w-3.5 px-0.5 text-[9px] leading-none"
          aria-hidden="true"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </Badge>
      ) : null}
    </Button>
  )
}

function NotificationInboxInner() {
  // Suspense-flavoured inbox hooks resolve synchronously once mounted, so
  // their isLoading guards are always false by the time this renders.
  const { inboxNotifications: notifications } = useInboxNotifications()
  const { count: unreadCount } = useUnreadInboxNotificationsCount()
  const markAsRead = useMarkInboxNotificationAsRead()
  const markAllAsRead = useMarkAllInboxNotificationsAsRead()
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)

  const rooms = useResolvedRooms(
    notifications.flatMap((n) => (n.roomId ? [n.roomId] : [])),
  )
  const users = useResolvedUsers(
    notifications
      .map((n) => directActorId(n))
      .filter((id): id is string => Boolean(id)),
  )

  const openRoomUrl = (notification: InboxNotificationData) => {
    markAsRead(notification.id)
    const roomInfo = notification.roomId
      ? rooms[notification.roomId]
      : undefined
    const url = roomInfo?.url
    if (url) {
      setOpen(false)
      void navigate({ to: url })
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <BellButton unreadCount={unreadCount} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-1.5 py-0.5 text-xs text-muted-foreground"
              onClick={() => markAllAsRead()}
            >
              Mark all read
            </Button>
          ) : null}
        </div>
        {notifications.length === 0 ? (
          <Empty className="min-h-40 border-0">
            <EmptyIcon>
              <Bell aria-hidden="true" />
            </EmptyIcon>
            <EmptyTitle>No notifications</EmptyTitle>
            <EmptyDescription>
              Activity from your collaborators will show up here.
            </EmptyDescription>
          </Empty>
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="divide-y" data-testid="notification-list">
              {notifications.map((notification) =>
                notification.kind === 'thread' ? (
                  <React.Suspense
                    key={notification.id}
                    fallback={<ItemSkeleton />}
                  >
                    <ThreadNotificationItem
                      notification={notification}
                      room={
                        notification.roomId
                          ? rooms[notification.roomId]
                          : undefined
                      }
                      onOpen={openRoomUrl}
                    />
                  </React.Suspense>
                ) : (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    excerpt={
                      notification.kind === 'textMention'
                        ? null
                        : customActivityExcerpt(notification)
                    }
                    actorId={directActorId(notification)}
                    resolvedUsers={users}
                    room={
                      notification.roomId
                        ? rooms[notification.roomId]
                        : undefined
                    }
                    onOpen={openRoomUrl}
                  />
                ),
              )}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ItemSkeleton() {
  return (
    <li className="px-3 py-2.5" aria-hidden="true">
      <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
    </li>
  )
}

/**
 * Thread-kind items read the thread to surface its latest comment as both
 * actor and excerpt; suspends until the thread cache hydrates.
 */
function ThreadNotificationItem({
  notification,
  room,
  onOpen,
}: {
  notification: Extract<InboxNotificationData, { kind: 'thread' }>
  room?: ResolvedRoom
  onOpen: (notification: InboxNotificationData) => void
}) {
  const thread = useInboxNotificationThread(notification.threadId)
  const lastComment = thread.comments.at(-1)
  const actorId =
    typeof lastComment?.userId === 'string' && lastComment.userId
      ? lastComment.userId
      : null
  const users = useResolvedUsers(actorId ? [actorId] : [])
  const excerpt =
    lastComment && !('deletedAt' in lastComment)
      ? commentBodyText(lastComment.body)
      : null

  return (
    <NotificationItem
      notification={notification}
      excerpt={excerpt}
      actorId={actorId}
      resolvedUsers={users}
      room={room}
      onOpen={onOpen}
    />
  )
}

function NotificationItem({
  notification,
  excerpt,
  actorId,
  resolvedUsers,
  room,
  onOpen,
}: {
  notification: InboxNotificationData
  /** Latest activity summary; null falls back to the kind's default label. */
  excerpt: string | null
  actorId: string | null
  resolvedUsers: Record<string, ResolvedUser>
  room?: ResolvedRoom
  onOpen: (notification: InboxNotificationData) => void
}) {
  const user = actorId ? resolvedUsers[actorId] : undefined
  const unread = notification.readAt == null
  const label = room ? room.name : 'New activity'
  const detail =
    excerpt ??
    (notification.kind === 'textMention' ? 'Mentioned you' : 'New activity')

  return (
    <li>
      <button
        type="button"
        className={cn(
          'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none',
          unread && 'bg-muted/20',
        )}
        onClick={() => onOpen(notification)}
      >
        {unread ? (
          <span
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
            aria-label="Unread"
          />
        ) : (
          <span className="mt-1.5 size-1.5 shrink-0" aria-hidden="true" />
        )}
        {user ? (
          <Avatar className="size-6 shrink-0">
            {user.avatar ? <AvatarImage src={user.avatar} alt="" /> : null}
            <AvatarFallback className="text-[10px]">
              {initialsOf(user.name)}
            </AvatarFallback>
          </Avatar>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{label}</span>
          <span className="truncate text-xs text-muted-foreground">
            {user ? <span className="font-medium">{user.name}</span> : null}
            {user ? ' — ' : ''}
            {detail}
          </span>
          <span className="text-[11px] text-muted-foreground/70">
            {formatDistanceToNowStrict(new Date(notification.notifiedAt), {
              addSuffix: true,
            })}
          </span>
        </span>
      </button>
    </li>
  )
}
