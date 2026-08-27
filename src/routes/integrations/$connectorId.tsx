/** INT-01/INT-02 — connector detail: config, run history, instrument ingestion. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Pause, Play } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { ConnectorCredentialsCard } from '#/components/integrations/credentials-card'
import { EnterpriseSourcePanel } from '#/components/integrations/enterprise-source-panel'
import { IngestPanel } from '#/components/integrations/ingest-panel'
import { RunHistory } from '#/components/integrations/run-history'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Separator,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import {
  connectorQueryKeys,
  describeConnectorsError,
  getConnector,
  updateConnector,
} from '#/lib/connectors/client'
import { hasCapability } from '#/lib/capability'
import { getParser } from '#/lib/connectors/registry'
import {
  POSTGRES_SECRET_NAMES,
  S3_SECRET_NAMES,
  enterpriseAdapterId,
} from '#/lib/connectors/enterprise/types'

export const Route = createFileRoute('/integrations/$connectorId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
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
        connectorId,
        status,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connectors'] })
    },
  })

  const connector = connectorQuery.data
  const canManage = hasCapability(context.workspace?.role, 'integrations.manage')
  const parser = connector?.parser_id ? getParser(connector.parser_id) : undefined

  if (!connector) {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-4 pt-4">
        <PageHeader
          eyebrow="Integrations"
          title="Connector"
          description="This connector could not be loaded."
        />
        {connectorQuery.error instanceof Error && (
          <p role="alert" className="text-destructive text-sm">
            {describeConnectorsError(connectorQuery.error)}
          </p>
        )}
      </div>
    )
  }

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  useShell({
    context: shellContext,
    breadcrumbs: [
      { label: 'Home', to: '/' },
      { label: 'Integrations', to: '/integrations' },
      { label: connector.name },
    ],
    primaryAction:
      canManage && connector.status !== 'archived' ? (
        <Button
          size="sm"
          variant={connector.status === 'active' ? 'outline' : 'default'}
          disabled={statusMutation.isPending}
          onClick={() =>
            statusMutation.mutate(connector.status === 'active' ? 'paused' : 'active')
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
      ) : undefined,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-4">
        <PageHeader
          eyebrow={context.workspace?.name ?? undefined}
          title={connector.name}
          description={`${connector.connector_type} · ${connector.direction} · key ${connector.key}`}
          className="border-0 pb-4"
        >
          <Badge variant={connector.status === 'active' ? 'default' : 'secondary'}>
            {connector.status}
          </Badge>
        </PageHeader>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-auto px-4 pb-8 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Parser identity:</span>{' '}
                {connector.parser_id ??
                  'none (non-ingestion connector)'}
                {parser ? ` (${parser.label}, version ${parser.version})` : ''}
              </p>
              <p>
                <span className="text-muted-foreground">Settings:</span> config
                is non-secret only; third-party credentials are sealed secrets
                managed by stewards.
              </p>
              <Separator />
              <p className="text-muted-foreground text-xs">
                Registered{' '}
                {new Date(connector.created_at).toLocaleString()} · updated{' '}
                {new Date(connector.updated_at).toLocaleString()}
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

          {enterpriseAdapterId(connector) && connector.status === 'active' && (
            <EnterpriseSourcePanel
              workspaceId={workspaceId}
              connector={connector}
            />
          )}

          {enterpriseAdapterId(connector) && (
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
          )}
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
