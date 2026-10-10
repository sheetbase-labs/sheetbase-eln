import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '#/components/v3/ui/button'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { ParserSettings } from '#/components/v3/settings/parser-settings'

export const Route = createFileRoute('/settings/instruments')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { fileId?: string; versionId?: string } => ({
    fileId: typeof search.fileId === 'string' ? search.fileId : undefined,
    versionId:
      typeof search.versionId === 'string' ? search.versionId : undefined,
  }),
  component: Instruments,
})

function Instruments() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <SettingsHeader
        title="Instruments and parsers"
        actions={
          <>
            <Button nativeButton={false} render={<Link to="/instruments" />}>
              Open instruments
            </Button>
            <Button
              nativeButton={false}
              render={<Link to="/settings/integrations" />}
            >
              Manage connections
            </Button>
          </>
        }
      >
        Manage canonical instrument-linked definitions, retained-file validation
        and QA approval. Connections and calibration remain on their existing
        surfaces.
      </SettingsHeader>
      <SettingsBody>
        <ParserSettings
          workspaceId={context.workspace?.id ?? ''}
          role={context.workspace?.role}
          {...search}
        />
      </SettingsBody>
    </div>
  )
}
