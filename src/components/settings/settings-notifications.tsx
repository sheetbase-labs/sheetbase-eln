import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import { toast } from '#/components/ui/sonner'
import { Tooltip } from '#/components/ui/tooltip'
import { SettingsSaveBar } from './settings-page'
import { PhoneAlerts } from './phone-alerts'
import { PluginChannels } from './plugin-channels'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid, bandRow } from '#/components/inventory/registry-grid'
import type {
  RegistryColumn,
  RegistryRow,
} from '#/components/inventory/registry-grid'
import {
  defaultPreferences,
  fetchNotificationPreferences,
  fetchNotificationTiming,
  notificationPreferencesQueryKeys,
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_LABELS,
  saveNotificationPreference,
  saveNotificationTiming,
} from '#/lib/notification-preferences'
import { emailStatusQueryKeys, fetchEmailStatusFn } from '#/lib/email-status'
import type { NotificationPreference } from '#/lib/notification-preferences'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import { t } from '#/copy'

function matchesPreference(
  before: NotificationPreference | undefined,
  row: NotificationPreference,
) {
  return (
    before?.inApp === row.inApp &&
    before.email === row.email &&
    before.digest === row.digest &&
    before.push === row.push
  )
}

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

  const emailStatus = useQuery({
    queryKey: emailStatusQueryKeys.status(),
    queryFn: () => fetchEmailStatusFn(),
    staleTime: 5 * 60_000,
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

  const savedRows = preferencesQuery.data ?? defaultPreferences()
  const savedByEvent = new Map(savedRows.map((row) => [row.eventType, row]))

  const save = useMutation({
    mutationFn: async () => {
      for (const row of rows) {
        const before = savedByEvent.get(row.eventType)

        if (matchesPreference(before, row)) continue
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Preserve fail-stop saves: a refused preference prevents later preference writes and the final timing write.
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
      toast(t('settings.notifications.notificationSettingsSavedToast'))
    },
  })

  // The form is dirty only against what the server last returned, so Save is
  // inert until something actually changes. Times are wall-clock values in the
  // person's own zone; the delivery and digest queries read them there.
  const dirty =
    rows.some((row) => {
      const before = savedByEvent.get(row.eventType)

      return !matchesPreference(before, row)
    }) ||
    quietStart !== (timingQuery.data?.quietHoursStart ?? null) ||
    quietEnd !== (timingQuery.data?.quietHoursEnd ?? null) ||
    digestTime !== (timingQuery.data?.digestTime ?? null)

  const rowsByEvent = new Map(rows.map((row) => [row.eventType, row]))

  const groups = NOTIFICATION_EVENTS.reduce<
    Array<{ name: string; rows: NotificationPreference[] }>
  >((acc, event) => {
    const row = rowsByEvent.get(event.key)

    if (!row) return acc
    const last = acc.at(-1)

    if (last && last.name === event.group) last.rows.push(row)
    else acc.push({ name: event.group, rows: [row] })

    return acc
  }, [])

  const toggle = (
    eventType: NotificationPreference['eventType'],
    channel: 'inApp' | 'email' | 'digest' | 'push',
  ) => {
    setRows((current) =>
      current.map((row) =>
        row.eventType === eventType
          ? { ...row, [channel]: !row[channel] }
          : row,
      ),
    )
  }

  const gridRows: RegistryRow<NotificationPreference>[] = groups.flatMap(
    (group) => [bandRow(group.name), ...group.rows],
  )

  const centered = {
    headerClassName: 'text-center',
    cellClassName: 'text-center',
  }

  const channelColumns = (
    [
      ['inApp', 'app', 'appHint'],
      ['email', 'email', 'emailHint'],
      ['push', 'phone', 'phoneHint'],
      ['digest', 'dailyDigest', 'digestHint'],
    ] as const
  ).map(([channel, label, hint]): RegistryColumn<NotificationPreference> => ({
    id: channel,
    enableSorting: false,
    size: 120,
    meta: centered,
    header: () => (
      <Tooltip content={t(`settings.notifications.${hint}`)}>
        <span className="cursor-help underline decoration-dotted underline-offset-2">
          {t(`settings.notifications.${label}`)}
        </span>
      </Tooltip>
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={`${NOTIFICATION_EVENT_LABELS[row.original.eventType]} ${channel}`}
        checked={row.original[channel]}
        onCheckedChange={() => toggle(row.original.eventType, channel)}
      />
    ),
  }))

  const columns: RegistryColumn<NotificationPreference>[] = [
    {
      id: 'event',
      header: t('settings.notifications.event'),
      enableSorting: false,
      cell: ({ row }) => NOTIFICATION_EVENT_LABELS[row.original.eventType],
    },
    ...channelColumns,
  ]

  return (
    <div className="flex flex-col gap-6">
      {save.isError ? (
        <Notice tone="bad">
          {save.error instanceof Error
            ? save.error.message
            : t('settings.notifications.couldSaveNotification')}
        </Notice>
      ) : null}

      {emailStatus.data && !emailStatus.data.configured ? (
        <Notice tone="warn">{t('settings.notifications.emailNotSetUp')}</Notice>
      ) : null}

      <PhoneAlerts />

      <PluginChannels />

      <TableBox>
        <RegistryGrid
          label={t('settings.notifications.notificationChannelsAria')}
          rows={gridRows}
          columns={columns}
          getRowId={(row) => row.eventType}
          selectable={false}
        />
      </TableBox>

      <NotificationTimingFields
        quietStart={quietStart}
        quietEnd={quietEnd}
        digestTime={digestTime}
        onQuietStartChange={setQuietStart}
        onQuietEndChange={setQuietEnd}
        onDigestTimeChange={setDigestTime}
      />
      <SettingsSaveBar
        dirty={dirty}
        pending={save.isPending}
        disabled={preferencesQuery.isLoading || timingQuery.isLoading}
        onSave={() => save.mutate()}
      />
    </div>
  )
}

function NotificationTimingFields({
  quietStart,
  quietEnd,
  digestTime,
  onQuietStartChange,
  onQuietEndChange,
  onDigestTimeChange,
}: {
  quietStart: string | null
  quietEnd: string | null
  digestTime: string | null
  onQuietStartChange: (value: string | null) => void
  onQuietEndChange: (value: string | null) => void
  onDigestTimeChange: (value: string | null) => void
}) {
  const zone = useDisplayTimeZone()

  return (
    <>
      <div className="flex flex-col gap-2">
        <h3 className="text-label font-medium text-fg">
          {t('settings.notifications.quietHours')}
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-body">
          <span className="text-fg-muted">
            {t('settings.notifications.holdEmailBetween')}
          </span>
          <Input
            type="time"
            aria-label={t('settings.notifications.quietHoursStartAria')}
            className="w-32"
            value={quietStart ?? ''}
            onChange={(event) => onQuietStartChange(event.target.value || null)}
          />
          <span className="text-fg-muted">and</span>
          <Input
            type="time"
            aria-label={t('settings.notifications.quietHoursEndAria')}
            className="w-32"
            value={quietEnd ?? ''}
            onChange={(event) => onQuietEndChange(event.target.value || null)}
          />
        </div>
        <p className="m-0 text-label text-fg-muted">
          {t('settings.notifications.reviewsDueToday', { zone })}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-label font-medium text-fg">
          {t('settings.notifications.digest')}
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-body">
          <span className="text-fg-muted">
            {t('settings.notifications.send')}
          </span>
          <Input
            type="time"
            aria-label={t('settings.notifications.digestTimeAria')}
            className="w-32"
            value={digestTime ?? ''}
            onChange={(event) => onDigestTimeChange(event.target.value || null)}
          />
          <span className="text-fg-muted">
            {t('settings.notifications.everyDay', { zone })}
          </span>
        </div>
        <p className="m-0 text-label text-fg-muted">
          {t('settings.notifications.digestGoesOut')}
        </p>
      </div>
    </>
  )
}
