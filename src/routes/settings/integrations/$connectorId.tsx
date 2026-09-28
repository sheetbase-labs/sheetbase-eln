import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Pause, Play } from 'lucide-react'

import { PageHeader } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { ConnectorCredentialsCard } from '#/components/integrations/credentials-card'
import { EnterpriseSourcePanel } from '#/components/integrations/enterprise-source-panel'
import { IngestPanel } from '#/components/integrations/ingest-panel'
import { RunHistory } from '#/components/integrations/run-history'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import { hasCapability } from '#/lib/capability'
import {
  connectorQueryKeys,
  describeConnectorsError,
  getConnector,
  updateConnector,
} from '#/lib/connectors/client'
import { getParser } from '#/lib/connectors/registry'
import {
  POSTGRES_SECRET_NAMES,
  S3_SECRET_NAMES,
  enterpriseAdapterId,
} from '#/lib/connectors/enterprise/types'

/** UI port (roadmap-4/ui-app3): connector detail under Settings — config, run
 * history and instrument ingestion, with pause/activate through the connector
 * RPCs. */
export const Route = createFileRoute('/settings/integrations/$connectorId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
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
      updateConnector(dataClient, { workspaceId, connectorId, status }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['connectors'] }),
  })

  const connector = connectorQuery.data
  const canManage = hasCapability(
    context.workspace?.role,
    'integrations.manage',
  )
  const parser = connector?.parser_id
    ? getParser(connector.parser_id)
    : undefined

  if (!connector) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={
            <Link to="/settings/integrations" className="text-link">
              Integrations
            </Link>
          }
          title="Connector"
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
        crumbs={
          <>
            <Link to="/settings/integrations" className="text-link">
              Integrations
            </Link>{' '}
            / <span className="mono">{connector.key}</span>
          </>
        }
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
                  <Pause className="size-4" /> Pause
                </>
              ) : (
                <>
                  <Play className="size-4" /> Activate
                </>
              )}
            </Button>
          ) : null
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 md:p-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Parser identity:</span>{' '}
                {connector.parser_id ?? 'none (non-ingestion connector)'}
                {parser ? ` (${parser.label}, version ${parser.version})` : ''}
              </p>
              <p>
                <span className="text-muted-foreground">Settings:</span> config
                is non-secret only; third-party credentials are sealed secrets
                managed by stewards.
              </p>
              <Separator />
              <p className="text-muted-foreground text-xs">
                Registered {new Date(connector.created_at).toLocaleString()} ·
                updated {new Date(connector.updated_at).toLocaleString()}
              </p>
            </CardContent>
          </Card>

          {connector.connector_type === 'instrument' &&
            connector.parser_id &&
            connector.status === 'active' && (
              <IngestPanel
                workspaceId={workspaceId}
                connectorId={connector.id}
                parserId={connector.parser_id}
              />
            )}

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

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Run history</CardTitle>
          </CardHeader>
          <CardContent>
            <RunHistory connectorId={connector.id} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
