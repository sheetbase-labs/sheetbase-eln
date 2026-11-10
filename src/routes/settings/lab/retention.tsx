import { createFileRoute } from '@tanstack/react-router'

import { RetentionPanel } from '#/components/settings/retention-panel'
import { SettingsHeader } from '#/components/settings/settings-page'
import { canManageSettings } from '#/lib/settings-access'
import { t } from '#/copy'

/**
 * Settings → Retention and holds: how long records are kept, what is due for
 * archiving and the legal holds that freeze records (migrations 0082-0083).
 * A lab switches it on under General; the database refuses every write from
 * a role that cannot manage the General area.
 */
export const Route = createFileRoute('/settings/lab/retention')({
  component: RetentionSettings,
})

function RetentionSettings() {
  const { context } = Route.useRouteContext()

  return (
    <>
      <SettingsHeader title={t('quality.retention.title')}>
        {t('quality.retention.subtitle')}
      </SettingsHeader>
      <RetentionPanel
        workspaceId={context.workspace?.id ?? ''}
        canManage={canManageSettings(context.workspace, 'general')}
      />
    </>
  )
}
