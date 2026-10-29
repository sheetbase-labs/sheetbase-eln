import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '#/components/v3/ui/button'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { ParserSettings } from '#/components/v3/settings/parser-settings'
import { InstrumentGateSetting } from '#/components/v3/settings/instrument-gate-setting'
import { canManageSettings } from '#/lib/settings-access'
import { t } from '#/copy'

export const Route = createFileRoute('/settings/instruments')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { fileId?: string; versionId?: string; instrumentId?: string } => ({
    fileId: typeof search.fileId === 'string' ? search.fileId : undefined,
    versionId:
      typeof search.versionId === 'string' ? search.versionId : undefined,
    instrumentId:
      typeof search.instrumentId === 'string' ? search.instrumentId : undefined,
  }),
  component: Instruments,
})

function Instruments() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <SettingsHeader
        title={t('settings.instruments.instrumentsParsers')}
        actions={
          <>
            <Button nativeButton={false} render={<Link to="/instruments" />}>
              {t('settings.instruments.openInstruments')}
            </Button>
            <Button
              nativeButton={false}
              render={<Link to="/settings/integrations" />}
            >
              {t('settings.instruments.manageConnections')}
            </Button>
          </>
        }
      >
        {t('settings.instruments.manageHowEach')}
      </SettingsHeader>
      <SettingsBody>
        <InstrumentGateSetting
          workspaceId={context.workspace?.id ?? ''}
          canManage={canManageSettings(context.workspace, 'instruments')}
        />
        <ParserSettings
          workspaceId={context.workspace?.id ?? ''}
          role={context.workspace?.role}
          {...search}
        />
      </SettingsBody>
    </div>
  )
}
