import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { ScheduledReportsPanel } from '#/components/facility/scheduled-reports'
import { SettingsHeader } from '#/components/settings/settings-page'
import { t } from '#/copy'
import { emailStatusQueryKeys, fetchEmailStatusFn } from '#/lib/email-status'

/**
 * Settings → Scheduled reports: reports emailed to people on a rhythm
 * (migration 0096). Setting one up needs the standing to run the report; the
 * database refuses it otherwise.
 */
export const Route = createFileRoute('/settings/lab/reports')({
  component: ScheduledReportsSettings,
})

function ScheduledReportsSettings() {
  const email = useQuery({
    queryKey: emailStatusQueryKeys.status(),
    queryFn: () => fetchEmailStatusFn(),
    staleTime: 60_000,
  })
  return (
    <>
      <SettingsHeader title={t('spend.schedule.title')}>
        {t('spend.schedule.subtitle')}
      </SettingsHeader>
      <ScheduledReportsPanel
        // Until the answer arrives, do not warn about email that may be fine.
        emailConfigured={email.data?.configured ?? true}
      />
    </>
  )
}
