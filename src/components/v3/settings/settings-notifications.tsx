import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Checkbox } from '#/components/v3/ui/checkbox'
import { Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { toast } from '#/components/v3/ui/sonner'
import { SettingsSaveBar } from './settings-page'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
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
import { useDisplayTimeZone } from '#/lib/display-time-zone'

/**
 * WORK-03.1 — SettingsNotifications: choose where each event reaches the
 * caller, quiet hours and the daily digest time. UI port: app-3's v3 kit.
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

  const zone = useDisplayTimeZone()
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
      // Only on a resolved save, so the confirmation cannot claim a write that
      // failed — the panel's own Notice reports failures.
      toast('Notification settings saved')
    },
  })

  // The form is dirty only against what the server last returned, so Save is
  // inert until something actually changes. Times are wall-clock values in the
  // person's own zone; the delivery and digest queries read them there.
  const savedRows = preferencesQuery.data ?? defaultPreferences()
  const dirty =
    rows.some((row) => {
      const before = savedRows.find((s) => s.eventType === row.eventType)
      return (
        !before ||
        before.inApp !== row.inApp ||
        before.email !== row.email ||
        before.digest !== row.digest
      )
    }) ||
    quietStart !== (timingQuery.data?.quietHoursStart ?? null) ||
    quietEnd !== (timingQuery.data?.quietHoursEnd ?? null) ||
    digestTime !== (timingQuery.data?.digestTime ?? null)

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
    <div className="flex flex-col gap-6">
      {save.isError ? (
        <Notice tone="bad">
          {save.error instanceof Error
            ? save.error.message
            : 'Could not save your notification settings.'}
        </Notice>
      ) : null}

      <TableBox className="max-w-2xl">
        <Table aria-label="Notification channels">
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead className="text-center">In app</TableHead>
              <TableHead className="text-center">Email</TableHead>
              <TableHead className="text-center">Daily digest</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.eventType}>
                <TableCell>
                  {NOTIFICATION_EVENT_LABELS[row.eventType]}
                </TableCell>
                {(['inApp', 'email', 'digest'] as const).map((channel) => (
                  <TableCell key={channel} className="text-center">
                    <Checkbox
                      aria-label={`${NOTIFICATION_EVENT_LABELS[row.eventType]} ${channel}`}
                      checked={row[channel]}
                      onCheckedChange={() => toggle(row.eventType, channel)}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableBox>

      <div className="flex flex-col gap-2">
        <h3 className="text-label font-medium text-fg">Quiet hours</h3>
        <div className="flex flex-wrap items-center gap-2 text-body">
          <span className="text-fg-muted">Hold email between</span>
          <Input
            type="time"
            aria-label="Quiet hours start"
            className="w-32"
            value={quietStart ?? ''}
            onChange={(event) => setQuietStart(event.target.value || null)}
          />
          <span className="text-fg-muted">and</span>
          <Input
            type="time"
            aria-label="Quiet hours end"
            className="w-32"
            value={quietEnd ?? ''}
            onChange={(event) => setQuietEnd(event.target.value || null)}
          />
        </div>
        <p className="m-0 text-label text-fg-muted">
          Reviews due today and signature requests always come through. An end
          earlier than the start runs overnight. Times are in your time zone (
          {zone}), which you can change in your profile.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-label font-medium text-fg">Digest</h3>
        <div className="flex flex-wrap items-center gap-2 text-body">
          <span className="text-fg-muted">Send at</span>
          <Input
            type="time"
            aria-label="Digest time"
            className="w-32"
            value={digestTime ?? ''}
            onChange={(event) => setDigestTime(event.target.value || null)}
          />
          <span className="text-fg-muted">every day, {zone}</span>
        </div>
        <p className="m-0 text-label text-fg-muted">
          The digest goes out when the clock in your time zone reaches that
          time.
        </p>
      </div>
      <SettingsSaveBar
        dirty={dirty}
        pending={save.isPending}
        disabled={preferencesQuery.isLoading || timingQuery.isLoading}
        onSave={() => save.mutate()}
      />
    </div>
  )
}
