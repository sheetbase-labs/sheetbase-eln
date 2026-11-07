import { createFileRoute } from '@tanstack/react-router'

import { OpenTablesSection } from '#/components/open-data/open-tables'
import {
  OntologySection,
  RepositoriesSection,
} from '#/components/open-data/ontology-and-repositories'
import { SettingsBody, SettingsHeader } from '#/components/settings/settings-page'
import { useDataAccess } from '#/lib/data-access'
import { canManageSettings } from '#/lib/settings-access'
import { t } from '#/copy'

/** Open tables, ontology lookup and publishing repositories. */
export const Route = createFileRoute('/settings/workspace/open-data')({
  component: OpenData,
})

function OpenData() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const canManage = canManageSettings(context.workspace, 'integrations')
  const dataAccess = useDataAccess()
  return (
    <>
      <SettingsHeader title={t('openData.page.title')}>
        {t('openData.page.description')}
      </SettingsHeader>
      <SettingsBody>
        <OpenTablesSection workspaceId={workspaceId} canManage={canManage} dataAccess={dataAccess} />
        <OntologySection workspaceId={workspaceId} canManage={canManage} />
        <RepositoriesSection workspaceId={workspaceId} canManage={canManage} />
      </SettingsBody>
    </>
  )
}
