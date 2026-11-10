import { createFileRoute } from '@tanstack/react-router'

import { canReleaseSample } from '#/components/samples/sample-state'
import { ReleaseRulesPanel } from '#/components/settings/release-rules-panel'
import { SettingsHeader } from '#/components/settings/settings-page'
import { canManageSettings } from '#/lib/settings-access'
import { t } from '#/copy'

/** Settings → Lab setup → Sample release: the checks before a sample is released. */
export const Route = createFileRoute('/settings/lab/release')({
  component: ReleaseSettings,
})

function ReleaseSettings() {
  const { context } = Route.useRouteContext()

  const canManage =
    canManageSettings(context.workspace, 'storage') &&
    canReleaseSample(context.workspace?.role)

  return (
    <>
      <SettingsHeader title={t('settings.storage.releaseChecks')} />
      <ReleaseRulesPanel
        workspaceId={context.workspace?.id ?? ''}
        canManage={canManage}
      />
    </>
  )
}
