import { createFileRoute } from '@tanstack/react-router'

import { LabWatchersPanel } from '#/components/settings/lab-watchers-panel'
import { SettingsHeader } from '#/components/settings/settings-page'
import { t } from '#/copy'

/**
 * Account > Lab watchers: the reviews you turned on, how often each looks, and
 * what they have found. Findings also arrive in the Inbox.
 */
export const Route = createFileRoute('/settings/account/watchers')({
  component: WatchersSettings,
})

function WatchersSettings() {
  const { context } = Route.useRouteContext()

  return (
    <>
      <SettingsHeader title={t('agents.watchers.title')}>
        {t('agents.watchers.subtitle')}
      </SettingsHeader>
      <LabWatchersPanel workspaceId={context.workspace?.id ?? ''} />
    </>
  )
}
