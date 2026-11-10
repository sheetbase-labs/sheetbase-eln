import { createFileRoute } from '@tanstack/react-router'

import { LabelTemplatesPanel } from '#/components/settings/label-templates-panel'
import { SettingsHeader } from '#/components/settings/settings-page'
import { canManageSettings } from '#/lib/settings-access'
import { t } from '#/copy'

/** Settings → Lab setup → Label templates: what a printed sample label shows. */
export const Route = createFileRoute('/settings/lab/labels')({
  component: LabelSettings,
})

function LabelSettings() {
  const { context } = Route.useRouteContext()

  return (
    <>
      <SettingsHeader title={t('settings.storage.labelTemplates')} />
      <LabelTemplatesPanel
        workspaceId={context.workspace?.id ?? ''}
        canManage={canManageSettings(context.workspace, 'storage')}
      />
    </>
  )
}
