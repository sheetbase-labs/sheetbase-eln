import { createFileRoute } from '@tanstack/react-router'

import { SettingsNotifications } from '#/components/v3/settings/settings-notifications'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { t } from '#/copy'

/** UI port (roadmap-4/ui-app3): notification preferences, read and written
 * through the notification-preferences module. */
export const Route = createFileRoute('/settings/notifications')({
  component: Notifications,
})

function Notifications() {
  return (
    <>
      <SettingsHeader title={t('settings.notifications.notifications')}>
        {t('settings.notifications.chooseWhereEach')}
      </SettingsHeader>
      <SettingsBody>
        <SettingsNotifications />
      </SettingsBody>
    </>
  )
}
