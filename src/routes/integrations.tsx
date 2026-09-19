/** INT-01 — connector registry workspace surface. */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Plus, Plug } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { RegisterConnectorDialog } from '#/components/integrations/register-connector-dialog'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyIcon,
  EmptyTitle,
  PageHeader,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import {
  connectorQueryKeys,
  describeConnectorsError,
  listConnectors,
} from '#/lib/connectors/client'
import { hasCapability } from '#/lib/capability'
import type { ConnectorWire } from '#/lib/connectors/types'

// Register built-in instrument parsers before the catalogue renders.
import '#/lib/connectors/plate-reader'

export const Route = createFileRoute('/integrations')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: IntegrationsRoute,
})

const dataClient = createDataClient()

function IntegrationsRoute() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const [registerOpen, setRegisterOpen] = useState(false)

  const connectorsQuery = useQuery({
    queryKey: connectorQueryKeys.connectors,
    queryFn: () => listConnectors(dataClient),
    enabled: Boolean(workspaceId),
  })

  const connectors = connectorsQuery.data ?? []
  const canManage = hasCapability(
    context.workspace?.role,
    'integrations.manage',
  )

  useShell({
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: {
        name: context.user.name,
        email: context.user.email,
        role: context.workspace?.role,
      },
    },
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Integrations' }],
    primaryAction:
      canManage && connectors.length > 0 ? (
        <Button size="sm" onClick={() => setRegisterOpen(true)}>
          <Plus className="size-4" /> Register connector
        </Button>
      ) : undefined,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div>
        <PageHeader
          title="Integrations"
          description="Connect instruments and storage, check recent runs and resolve failures."
          className="border-0 pb-4"
        >
          {canManage && (
            <Button size="sm" onClick={() => setRegisterOpen(true)}>
              <Plus className="size-4" /> Register connector
            </Button>
          )}
        </PageHeader>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-8">
        {!canManage && (
          <p className="text-muted-foreground mb-4 text-sm">
            You can view integrations; only owners, admins and stewards register
            or pause connectors.
          </p>
        )}
        {connectorsQuery.error instanceof Error && (
          <p role="alert" className="text-destructive mb-4 text-sm">
            {describeConnectorsError(connectorsQuery.error)}
          </p>
        )}
        {connectorsQuery.isLoading ? (
          <p role="status" className="py-8 text-sm text-muted-foreground">
            Loading integrations…
          </p>
        ) : connectorsQuery.error ? null : connectors.length === 0 ? (
          <Empty>
            <EmptyIcon>
              <Plug aria-hidden="true" />
            </EmptyIcon>
            <EmptyTitle>No connectors yet</EmptyTitle>
            <EmptyDescription>
              Register an instrument or storage connection to start importing
              data.
            </EmptyDescription>
            {canManage && (
              <EmptyActions>
                <Button onClick={() => setRegisterOpen(true)}>
                  <Plus className="size-4" /> Register connector
                </Button>
              </EmptyActions>
            )}
          </Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {connectors.map((connector) => (
              <ConnectorCard key={connector.id} connector={connector} />
            ))}
          </div>
        )}
      </div>

      <RegisterConnectorDialog
        workspaceId={workspaceId}
        open={registerOpen}
        onOpenChange={setRegisterOpen}
      />
    </div>
  )
}

function ConnectorCard({ connector }: { connector: ConnectorWire }) {
  return (
    <Link
      to="/integrations/$connectorId"
      params={{ connectorId: connector.id }}
    >
      <Card className="h-full transition-colors hover:border-primary">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            {connector.name}
            <Badge
              variant={connector.status === 'active' ? 'default' : 'secondary'}
            >
              {connector.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-1 text-sm">
          <p className="font-mono text-xs">{connector.key}</p>
          <p>
            {connector.connector_type} · {connector.direction}
            {connector.parser_id ? ` · parser ${connector.parser_id}` : ''}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}
