import { Link, createFileRoute } from '@tanstack/react-router'

import { WorkspaceAdminsLine } from '#/components/v3/settings/workspace-admins-line'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { SettingsGeneral } from '#/components/v3/settings/settings-general'
import { SettingsHeader } from '#/components/v3/settings/settings-page'
import { canOpenSettings } from '#/lib/settings-access'

/** UI port (roadmap-4/ui-app3): General settings. The workspace name, site,
 * time zone, display formats and identifier prefixes are read and written
 * through the SET-01 RPCs, which refuse a non-admin. The whole surface is
 * workspace administration, so a role that cannot open it — the same rule that
 * omits it from the settings nav — is refused the page itself rather than shown
 * a form whose save is refused. */
export const Route = createFileRoute('/settings/')({
  component: General,
})

function General() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  if (!canOpenSettings(context.workspace, 'general')) {
    return (
      <>
        <SettingsHeader title={t('settings.home.general')} />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title={t('settings.home.onlyWorkspaceAdmins')}
            description={
              <>
                {t('settings.home.workspaceNameTime')}
                <WorkspaceAdminsLine workspaceId={workspaceId} />
              </>
            }
            action={
              <Button
                nativeButton={false}
                render={<Link to="/settings/profile" />}
              >
                {t('settings.home.openProfileSettings')}
              </Button>
            }
          />
        </div>
      </>
    )
  }
  return (
    <SettingsGeneral
      workspaceId={workspaceId}
      workspaceName={context.workspace?.name}
    />
  )
}
