import { createFileRoute } from '@tanstack/react-router'

import { SettingsNotifications } from '#/components/settings/settings-notifications'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'

/** UI port (roadmap-4/ui-app3): notification preferences, read and written
 * through the notification-preferences module. */
export const Route = createFileRoute('/settings/notifications')({
  component: Notifications,
})

function Notifications() {
  return (
    <>
      <SettingsHeader title="Notifications">
        Choose where each kind of event reaches you
      </SettingsHeader>
      <SettingsBody>
        <SettingsNotifications />
      </SettingsBody>
    </>
  )
}
