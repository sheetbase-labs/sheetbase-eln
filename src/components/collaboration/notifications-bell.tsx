'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Bell } from 'lucide-react'

import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui'
import {
  fetchMyNotifications,
  markNotificationsRead,
  notificationsQueryKeys,
} from '#/lib/notifications-data'
import { recordPath } from '#/lib/navigation'

/**
 * WORK-03.3 — the bell popover reading api.my_notifications: an unread dot,
 * a list of the caller's notifications linking to their records, mark all
 * read, and links to the Inbox and notification settings.
 */
export function NotificationsBell() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: notificationsQueryKeys.list(),
    queryFn: () => fetchMyNotifications(),
    staleTime: 30_000,
    retry: false,
  })
  const notifications = query.data ?? []
  const unread = notifications.filter((item) => item.readAt === null)

  const markRead = useMutation({
    mutationFn: () => markNotificationsRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: notificationsQueryKeys.list(),
      })
    },
  })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="quiet"
          size="icon-sm"
          className="relative"
          aria-label={
            unread.length > 0
              ? `Notifications, ${unread.length} unread`
              : 'Notifications'
          }
        >
          <Bell className="size-4" />
          {unread.length > 0 ? (
            <span
              className="absolute right-1 top-1 size-1.5 rounded-full bg-danger-text"
              aria-hidden="true"
            />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <Button
            variant="quiet"
            size="sm"
            disabled={unread.length === 0 || markRead.isPending}
            onClick={() => markRead.mutate()}
          >
            Mark all read
          </Button>
        </div>
        {query.isLoading ? (
          <p className="p-3 text-body text-muted-foreground">Loading…</p>
        ) : notifications.length === 0 ? (
          <p className="p-3 text-body text-muted-foreground">
            Nothing new right now.
          </p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {notifications.map((item) => (
              <li key={item.id}>
                {item.recordId ? (
                  <Link
                    to={recordPath(item.recordId)}
                    className="flex items-start gap-2 px-3 py-2 no-underline hover:bg-accent/40"
                  >
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full"
                      style={{
                        background:
                          item.readAt === null
                            ? 'var(--accent)'
                            : 'transparent',
                      }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body text-foreground">
                        {item.title}
                      </span>
                      {item.body ? (
                        <span className="block truncate text-caption text-muted-foreground">
                          {item.body}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                ) : (
                  <div className="flex items-start gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 text-body text-foreground">
                      {item.title}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-3 border-t border-border bg-surface-muted px-3 py-2 text-caption">
          <Link
            to="/inbox"
            className="text-primary no-underline hover:underline"
          >
            Open inbox
          </Link>
          <Link
            to="/settings"
            className="text-primary no-underline hover:underline"
          >
            Notification settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
