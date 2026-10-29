import { createFileRoute } from '@tanstack/react-router'

import { LabelTemplatesPanel } from '#/components/v3/settings/label-templates-panel'
import { SettingsHeader } from '#/components/v3/settings/settings-page'
import { StorageLocationsPanel } from '#/components/v3/settings/storage-locations-panel'
import { Tabs } from '#/components/v3/ui/tabs'
import { canManageSettings } from '#/lib/settings-access'
import { t } from '#/copy'

/**
 * Settings → Storage and labels: where samples are kept (sites down to boxes)
 * and the label templates they print with. Which roles may open and change it
 * is the workspace's choice under Members and roles; the settings layout shows
 * the section read-only for a role that can only view, and the database refuses
 * a write from one that cannot manage.
 */
export const Route = createFileRoute('/settings/storage')({
  validateSearch: (search: Record<string, unknown>): { tab?: 'labels' } =>
    search.tab === 'labels' ? { tab: 'labels' } : {},
  component: StorageSettings,
})

function StorageSettings() {
  const { context } = Route.useRouteContext()
  const { tab } = Route.useSearch()
  const workspaceId = context.workspace?.id ?? ''
  const canManage = canManageSettings(context.workspace, 'storage')
  const current = tab === 'labels' ? 'labels' : 'locations'
  return (
    <>
      <SettingsHeader
        title={t('settings.storage.storageLabels')}
        border={false}
      >
        {t('settings.storage.whereSamplesKept')}
      </SettingsHeader>
      <Tabs
        mode="url"
        label={t('settings.storage.storageLabelsSections')}
        className="border-b border-border px-4 md:px-6"
        value={current}
        items={[
          {
            key: 'locations',
            label: t('settings.storage.storageLocations'),
            link: { to: '/settings/storage', search: {} },
          },
          {
            key: 'labels',
            label: t('settings.storage.labelTemplates'),
            link: { to: '/settings/storage', search: { tab: 'labels' } },
          },
        ]}
      />
      {current === 'locations' ? (
        <StorageLocationsPanel
          workspaceId={workspaceId}
          canManage={canManage}
        />
      ) : (
        <LabelTemplatesPanel workspaceId={workspaceId} canManage={canManage} />
      )}
    </>
  )
}
