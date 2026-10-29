import { Link, createFileRoute } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { RolesAndPermissions } from '#/components/v3/settings/roles-and-permissions'
import { SettingsHeader } from '#/components/v3/settings/settings-page'
import { t } from '#/copy'

/** Settings → Members and roles → Roles and permissions: what each role does
 * and which settings sections each role can open or change. */
export const Route = createFileRoute('/settings/roles')({
  component: Roles,
})

function Roles() {
  const { context } = Route.useRouteContext()
  return (
    <>
      <SettingsHeader
        title={t('settings.roles.rolesPermissions')}
        actions={
          <Button nativeButton={false} render={<Link to="/settings/members" />}>
            {t('settings.roles.backMembers')}
          </Button>
        }
      >
        {context.workspace?.name ?? 'Workspace'}
        {t('settings.roles.rolesDecideWhat')}
      </SettingsHeader>
      <RolesAndPermissions
        workspaceId={context.workspace?.id ?? ''}
        canEdit={context.workspace?.role === 'owner'}
      />
    </>
  )
}
