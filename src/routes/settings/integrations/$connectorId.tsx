import { formatNotebookDateTime } from '#/lib/notebook-data'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { Icon } from '#/components/icons'
import { PageHeader, Section } from '#/components/v3/ui/layout'
import { Notice } from '#/components/v3/ui/alert'
import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { ConnectorConfigCard } from '#/components/v3/integrations/config-card'
import { PickupCard } from '#/components/v3/integrations/pickup-card'
import { ConnectorCredentialsCard } from '#/components/v3/integrations/credentials-card'
import { EnterpriseSourcePanel } from '#/components/v3/integrations/enterprise-source-panel'
import { IntakeProblems } from '#/components/v3/integrations/intake-problems'
import { IngestPanel } from '#/components/v3/integrations/ingest-panel'
import { RunHistory } from '#/components/v3/integrations/run-history'
import { createDataClient } from '#/lib/data-client'
import { canManageSettings } from '#/lib/settings-access'
import {
  connectorQueryKeys,
  describeConnectorsError,
  getConnector,
  updateConnector,
} from '#/lib/connectors/client'
import {
  fetchParserSettings,
  parserSettingsQueryKeys,
} from '#/lib/parser-settings'
import {
  POSTGRES_SECRET_NAMES,
  S3_SECRET_NAMES,
  enterpriseAdapterId,
} from '#/lib/connectors/enterprise/types'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'

/** UI port (roadmap-4/ui-app3): connector detail under Settings — config, run
 * history and instrument ingestion, with pause/activate through the connector
 * RPCs. */
export const Route = createFileRoute('/settings/integrations/$connectorId')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: ConnectorDetailRoute,
})

const dataClient = createDataClient()

function ConnectorDetailRoute() {
  const { context } = Route.useRouteContext()
  const { connectorId } = Route.useParams()
  const workspaceId = context.workspace?.id ?? ''
  const queryClient = useQueryClient()

  const connectorQuery = useQuery({
    queryKey: connectorQueryKeys.connector(connectorId),
    queryFn: () => getConnector(dataClient, connectorId),
    enabled: Boolean(workspaceId),
  })

  const statusMutation = useMutation({
    mutationFn: (status: 'active' | 'paused') =>
      updateConnector(dataClient, {
        workspaceId,
        connectorId: connectorQuery.data?.id ?? connectorId,
        status,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['connectors'] }),
  })

  const connector = connectorQuery.data
  const canManage = canManageSettings(context.workspace, 'integrations')
  const parsers = useQuery({
    queryKey: parserSettingsQueryKeys.list(workspaceId),
    queryFn: () => fetchParserSettings(dataClient, workspaceId),
    enabled: Boolean(workspaceId && connector?.parser_id),
  })
  const parserName = connector?.parser_id
    ? (parsers.data?.find((p) => p.key === connector.parser_id)?.name ??
      connector.parser_id)
    : null

  if (!connector) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('settings.integrationsConnectorid.integrations'),
              link: { to: '/settings/integrations' },
            },
          ]}
          title={t('settings.integrationsConnectorid.connector')}
        />
        {connectorQuery.error instanceof Error ? (
          <p
            role="alert"
            className="px-4 pt-3 text-label text-danger-text md:px-6"
          >
            {describeConnectorsError(connectorQuery.error)}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          {
            label: t('settings.integrationsConnectorid.integrations'),
            link: { to: '/settings/integrations' },
          },
          { label: connector.key, mono: true },
        ]}
        title={connector.name}
        meta={
          <>
            <span>
              <Status tone={connector.status === 'active' ? 'ok' : 'stored'}>
                {connector.status}
              </Status>
            </span>
            <span>
              {connector.connector_type} · {connector.direction}
            </span>
          </>
        }
        actions={
          canManage && connector.status !== 'archived' ? (
            <Button
              variant={connector.status === 'active' ? 'secondary' : 'primary'}
              disabled={statusMutation.isPending}
              onClick={() =>
                statusMutation.mutate(
                  connector.status === 'active' ? 'paused' : 'active',
                )
              }
            >
              {connector.status === 'active' ? (
                <>
                  <Icon name="pause" className="size-4" />
                  {t('settings.integrationsConnectorid.pause')}
                </>
              ) : (
                <>
                  <Icon name="play" className="size-4" />
                  {t('settings.integrationsConnectorid.activate')}
                </>
              )}
            </Button>
          ) : null
        }
      />

      {statusMutation.isError ? (
        <div className="px-4 pt-3 md:px-6">
          <Notice tone="bad">
            {describeConnectorsError(statusMutation.error)}
            {t('settings.integrationsConnectorid.connectorStill', {
              status: connector.status,
            })}
          </Notice>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 md:p-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-4">
          <Section title={t('settings.integrationsConnectorid.configuration')}>
            {parserName ? (
              <p className="m-0 text-body">
                <span className="text-fg-muted">
                  {t('settings.integrationsConnectorid.parserIdentity')}
                </span>{' '}
                {parserName}
              </p>
            ) : null}
            <p className="m-0 text-body">
              <span className="text-fg-muted">
                {t('settings.integrationsConnectorid.settings')}
              </span>
              {t('settings.integrationsConnectorid.configNonSecret')}
            </p>
            <p className="m-0 border-t border-border pt-2 text-label text-fg-muted">
              {t('settings.integrationsConnectorid.registeredUpdated', {
                created: formatNotebookDateTime(connector.created_at, {
                  zone: true,
                }),
                updated: formatNotebookDateTime(connector.updated_at, {
                  zone: true,
                }),
              })}
            </p>
          </Section>

          {connector.connector_type === 'instrument' &&
            connector.parser_id &&
            connector.status === 'active' && (
              <IngestPanel
                connectorId={connector.id}
                parserKey={connector.parser_id}
                parserName={parserName ?? connector.parser_id}
              />
            )}

          {connector.connector_type === 'instrument' ? (
            <IntakeProblems
              workspaceId={workspaceId}
              connectorId={connector.id}
              canManage={canManage}
            />
          ) : null}

          {connector.connector_type === 'instrument' ? (
            <PickupCard
              workspaceId={workspaceId}
              connector={connector}
              canManage={canManage}
            />
          ) : null}

          {enterpriseAdapterId(connector) ? (
            <ConnectorConfigCard
              workspaceId={workspaceId}
              connector={connector}
              adapter={enterpriseAdapterId(connector)!}
              canManage={canManage}
            />
          ) : null}

          {enterpriseAdapterId(connector) && connector.status === 'active' ? (
            <EnterpriseSourcePanel
              workspaceId={workspaceId}
              connector={connector}
            />
          ) : null}

          {enterpriseAdapterId(connector) ? (
            <ConnectorCredentialsCard
              workspaceId={workspaceId}
              connectorId={connector.id}
              requiredSecrets={
                enterpriseAdapterId(connector) === 'postgres'
                  ? POSTGRES_SECRET_NAMES
                  : S3_SECRET_NAMES
              }
              canManage={canManage}
            />
          ) : null}
        </div>

        <Section
          title={t('settings.integrationsConnectorid.runHistory')}
          className="self-start"
        >
          <RunHistory connectorId={connector.id} />
        </Section>
      </div>
    </div>
  )
}
