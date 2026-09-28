import { createFileRoute } from '@tanstack/react-router'

import { SettingsGeneral } from '#/components/settings/settings-general'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'

/** UI port (roadmap-4/ui-app3): General settings. The workspace name, site,
 * time zone, display formats and identifier prefixes are read and written
 * through the SET-01 RPCs, which refuse a non-admin. */
export const Route = createFileRoute('/settings/')({
  component: General,
})

function General() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
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
