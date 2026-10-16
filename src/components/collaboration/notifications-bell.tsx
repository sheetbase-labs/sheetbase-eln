'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Icon } from '#/components/icons'
import { Button } from '#/components/v3/ui/button'
import { Row, RowList } from '#/components/v3/ui/row'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/v3/ui/popover'
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
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="quiet"
            size="icon"
            className="relative"
            aria-label={
              unread.length > 0
                ? `Notifications, ${unread.length} unread`
                : 'Notifications'
            }
          />
        }
      >
        <Icon name="bell" className="size-4" />
        {unread.length > 0 ? (
          <span
            className="absolute right-1 top-1 size-1.5 rounded-full bg-danger-text"
            aria-hidden="true"
          />
        ) : null}
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
          <RowList divided className="max-h-80 overflow-y-auto">
            {notifications.map((item) => (
              <Row
                key={item.id}
                to={item.recordId ? recordPath(item.recordId) : undefined}
                leading={
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{
                      background:
                        item.readAt === null ? 'var(--accent)' : 'transparent',
                    }}
                    aria-hidden="true"
                  />
                }
                title={<span className="text-body">{item.title}</span>}
                meta={item.body ?? undefined}
              />
            ))}
          </RowList>
        )}
        <div className="flex items-center gap-3 border-t border-border bg-surface-muted px-3 py-2 text-caption">
          <Link
            to="/inbox"
            className="text-primary-text no-underline hover:underline"
          >
            Open inbox
          </Link>
          <Link
            to="/settings"
            className="text-primary-text no-underline hover:underline"
          >
            Notification settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
