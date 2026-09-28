import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui'
import {
  defaultPreferences,
  fetchNotificationPreferences,
  fetchNotificationTiming,
  notificationPreferencesQueryKeys,
  NOTIFICATION_EVENT_LABELS,
  saveNotificationPreference,
  saveNotificationTiming,
} from '#/lib/notification-preferences'
import type { NotificationPreference } from '#/lib/notification-preferences'

/**
 * WORK-03.1 — SettingsNotifications: choose where each event reaches the
 * caller, quiet hours and the daily digest time.
 */
export function SettingsNotifications() {
  const queryClient = useQueryClient()
  const preferencesQuery = useQuery({
    queryKey: notificationPreferencesQueryKeys.preferences(),
    queryFn: () => fetchNotificationPreferences(),
  })
  const timingQuery = useQuery({
    queryKey: notificationPreferencesQueryKeys.timing(),
    queryFn: () => fetchNotificationTiming(),
  })

  const [rows, setRows] = useState<NotificationPreference[]>(defaultPreferences)
  const [quietStart, setQuietStart] = useState<string | null>(null)
  const [quietEnd, setQuietEnd] = useState<string | null>(null)
  const [digestTime, setDigestTime] = useState<string | null>(null)

  useEffect(() => {
    if (preferencesQuery.data) setRows(preferencesQuery.data)
  }, [preferencesQuery.data])

  useEffect(() => {
    if (!timingQuery.data) return
    setQuietStart(timingQuery.data.quietHoursStart)
    setQuietEnd(timingQuery.data.quietHoursEnd)
    setDigestTime(timingQuery.data.digestTime)
  }, [timingQuery.data])

  const save = useMutation({
    mutationFn: async () => {
      for (const row of rows) {
        await saveNotificationPreference(row)
      }
      await saveNotificationTiming({
        quietHoursStart: quietStart,
        quietHoursEnd: quietEnd,
        digestTime,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: notificationPreferencesQueryKeys.preferences(),
      })
      void queryClient.invalidateQueries({
        queryKey: notificationPreferencesQueryKeys.timing(),
      })
    },
  })

  const toggle = (
    eventType: NotificationPreference['eventType'],
    channel: 'inApp' | 'email' | 'digest',
  ) => {
    setRows((current) =>
      current.map((row) =>
        row.eventType === eventType
          ? { ...row, [channel]: !row[channel] }
          : row,
      ),
    )
  }

  return (
    <section aria-label="Notifications" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-section text-foreground">Notifications</h3>
          <p className="text-caption text-muted-foreground">
            Choose where each kind of event reaches you.
          </p>
        </div>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || preferencesQuery.isLoading}
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      {save.isError ? (
        <p role="alert" className="text-caption text-danger-text">
          {save.error instanceof Error
            ? save.error.message
            : 'Could not save your notification settings.'}
        </p>
      ) : null}

      <table className="w-full text-body">
        <thead>
          <tr className="border-b border-border text-left text-caption text-muted-foreground">
            <th className="py-2">Event</th>
            <th className="w-20 py-2 text-center">In app</th>
            <th className="w-20 py-2 text-center">Email</th>
            <th className="w-24 py-2 text-center">Daily digest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.eventType} className="border-b border-border">
              <td className="py-2 pr-3">
                {NOTIFICATION_EVENT_LABELS[row.eventType]}
              </td>
              {(['inApp', 'email', 'digest'] as const).map((channel) => (
                <td key={channel} className="py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${NOTIFICATION_EVENT_LABELS[row.eventType]} ${channel}`}
                    checked={row[channel]}
                    onChange={() => toggle(row.eventType, channel)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="space-y-2">
        <h4 className="text-label text-foreground">Quiet hours</h4>
        <div className="flex items-center gap-2 text-body">
          <span className="text-muted-foreground">Hold email between</span>
          <input
            type="time"
            aria-label="Quiet hours start"
            className="h-8 rounded-md border border-input bg-card px-2"
            value={quietStart ?? ''}
            onChange={(event) => setQuietStart(event.target.value || null)}
          />
          <span className="text-muted-foreground">and</span>
          <input
            type="time"
            aria-label="Quiet hours end"
            className="h-8 rounded-md border border-input bg-card px-2"
            value={quietEnd ?? ''}
            onChange={(event) => setQuietEnd(event.target.value || null)}
          />
        </div>
        <p className="text-caption text-muted-foreground">
          Reviews due today and signature requests always come through.
        </p>
      </div>

      <div className="space-y-2">
        <h4 className="text-label text-foreground">Digest</h4>
        <label className="flex items-center gap-2 text-body">
          <span className="text-muted-foreground">Send at</span>
          <input
            type="time"
            aria-label="Digest time"
            className="h-8 rounded-md border border-input bg-card px-2"
            value={digestTime ?? ''}
            onChange={(event) => setDigestTime(event.target.value || null)}
          />
          <span className="text-muted-foreground">weekdays</span>
        </label>
      </div>
    </section>
  )
}
