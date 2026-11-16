import { createFileRoute } from '@tanstack/react-router'

import { AiPreferencesPanel } from '#/components/settings/ai-preferences-panel'
import { SettingsHeader } from '#/components/settings/settings-page'
import { t } from '#/copy'
import { canManageSettings } from '#/lib/settings-access'

/**
 * Account > AI preferences: what the assistant remembers about how you and
 * your lab like things done. Yours are private to you; the lab's are for
 * everyone and are changed by someone who manages the AI settings.
 */
export const Route = createFileRoute('/settings/account/ai-preferences')({
  component: AiPreferencesSettings,
})

function AiPreferencesSettings() {
  const { context } = Route.useRouteContext()

  return (
    <>
      <SettingsHeader title={t('features.aiPreferences.page.title')}>
        {t('features.aiPreferences.page.subtitle')}
      </SettingsHeader>
      <AiPreferencesPanel
        workspaceId={context.workspace?.id ?? ''}
        canManageLab={canManageSettings(context.workspace, 'ai')}
      />
    </>
  )
}
