import { createFileRoute } from '@tanstack/react-router'

import { SettingsHeader } from '#/components/settings/settings-page'
import { SidebarPagesPanel } from '#/components/settings/sidebar-pages-panel'
import { canManageSettings } from '#/lib/settings-access'
import { t } from '#/copy'

/**
 * Settings → Lab setup → Sidebar: which pages the lab lists in everyone's
 * sidebar (migration 0084). The database refuses a change from a role that
 * cannot manage the General area.
 */
export const Route = createFileRoute('/settings/lab/sidebar')({
  component: SidebarSettings,
})

function SidebarSettings() {
  const { context } = Route.useRouteContext()

  return (
    <>
      <SettingsHeader title={t('settings.sidebarPages.title')}>
        {t('settings.sidebarPages.subtitle')}
      </SettingsHeader>
      <SidebarPagesPanel
        workspaceId={context.workspace?.id ?? ''}
        canManage={canManageSettings(context.workspace, 'general')}
      />
    </>
  )
}
