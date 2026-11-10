import { createFileRoute } from '@tanstack/react-router'

import { SettingsHeader } from '#/components/settings/settings-page'
import { StorageLocationsPanel } from '#/components/settings/storage-locations-panel'
import { canManageSettings } from '#/lib/settings-access'
import { t } from '#/copy'

/**
 * Settings → Lab setup → Storage locations: where samples are kept (sites down
 * to boxes). Which roles may open and change it is the workspace's choice under
 * Members and roles; the settings layout shows the section read-only for a role
 * that can only view, and the database refuses a write from one that cannot
 * manage.
 */
export const Route = createFileRoute('/settings/lab/storage')({
  component: StorageSettings,
})

function StorageSettings() {
  const { context } = Route.useRouteContext()

  return (
    <>
      <SettingsHeader title={t('settings.storage.storageLocations')}>
        {t('settings.storage.whereSamplesKept')}
      </SettingsHeader>
      <StorageLocationsPanel
        workspaceId={context.workspace?.id ?? ''}
        canManage={canManageSettings(context.workspace, 'storage')}
      />
    </>
  )
}
