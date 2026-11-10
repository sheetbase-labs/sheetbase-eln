import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { Button } from '#/components/ui/button'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/settings/settings-page'
import { ParserSettings } from '#/components/settings/parser-settings'
import { InstrumentGateSetting } from '#/components/settings/instrument-gate-setting'
import { canManageSettings } from '#/lib/settings-access'
import { t } from '#/copy'

export const Route = createFileRoute('/settings/lab/instruments')({
  validateSearch: (search) =>
    z
      .object({
        fileId: z.string().optional().catch(undefined),
        versionId: z.string().optional().catch(undefined),
        instrumentId: z.string().optional().catch(undefined),
      })
      .parse(search),
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
              render={<Link to="/settings/workspace/integrations" />}
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
