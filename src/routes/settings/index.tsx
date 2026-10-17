import { Link, createFileRoute } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { SettingsGeneral } from '#/components/v3/settings/settings-general'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { WORKSPACE_ADMIN_ROLES, canSeeNavItem } from '#/lib/nav-visibility'

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
  if (
    !canSeeNavItem(
      { roles: WORKSPACE_ADMIN_ROLES },
      { role: context.workspace?.role },
    )
  ) {
    return (
      <>
        <SettingsHeader title="General" />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title="Only workspace admins can see workspace settings"
            description="The workspace name, time zone, display formats and identifier prefixes apply to everyone in the workspace. Ask a workspace admin to change them."
            action={
              <Button
                nativeButton={false}
                render={<Link to="/settings/profile" />}
              >
                Open your profile settings
              </Button>
            }
          />
        </div>
      </>
    )
  }
  return (
    <>
      <SettingsHeader title="General">
        {context.workspace?.name ?? 'Workspace'} · changes apply to everyone in
        it
      </SettingsHeader>
      <SettingsBody>
        <SettingsGeneral workspaceId={workspaceId} />
      </SettingsBody>
    </>
  )
}
