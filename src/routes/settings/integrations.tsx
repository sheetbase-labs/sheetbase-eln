import { useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  useRouterState,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted } from '#/components/v3/ui/layout'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import {
  IncomingWebhooks,
  OutgoingWebhooks,
} from '#/components/v3/settings/webhook-sections'
import { RegisterConnectorDialog } from '#/components/v3/integrations/register-connector-dialog'
import { createDataClient } from '#/lib/data-client'
import { sentenceCase } from '#/lib/sentence-case'
import { canManageSettings, canOpenSettings } from '#/lib/settings-access'
import {
  connectorQueryKeys,
  describeConnectorsError,
  listConnectors,
} from '#/lib/connectors/client'

// Register built-in instrument parsers before the catalogue renders.
import '#/lib/connectors/plate-reader'
import '#/lib/connectors/instrument-parsers'

/** UI port (roadmap-4/ui-app3): integrations moved under Settings. The connector
 * registry is real; only owners, admins and stewards register or pause. */
export const Route = createFileRoute('/settings/integrations')({
  component: IntegrationsRoute,
})

const dataClient = createDataClient()

function IntegrationsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/settings/integrations',
  })
  return isIndex ? <IntegrationsList /> : <Outlet />
}

type ConnectorRow = Awaited<ReturnType<typeof listConnectors>>[number]

const connectorColumns: RegistryColumn<ConnectorRow>[] = [
  {
    id: 'connector',
    header: 'Connector',
    cell: ({ row }) => (
      <Link
        to="/settings/integrations/$connectorId"
        params={{ connectorId: row.original.id }}
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    cell: ({ row }) => sentenceCase(row.original.connector_type),
  },
  {
    id: 'direction',
    header: 'Direction',
    cell: ({ row }) => sentenceCase(row.original.direction),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Status tone={row.original.status === 'active' ? 'ok' : 'stored'}>
        {sentenceCase(row.original.status)}
      </Status>
    ),
  },
]

function IntegrationsList() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const canManage = canManageSettings(context.workspace, 'integrations')
  const [registerOpen, setRegisterOpen] = useState(false)

  const connectorsQuery = useQuery({
    queryKey: connectorQueryKeys.connectors,
    queryFn: () => listConnectors(dataClient),
    enabled: Boolean(workspaceId),
  })
  const connectors = connectorsQuery.data ?? []

  return (
    <>
      <SettingsHeader
        title="Integrations"
        count={connectors.length}
        border={false}
        actions={
          canManage ? (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => setRegisterOpen(true)}
            >
              Register connector
            </Button>
          ) : null
        }
      >
        Connect instruments and storage, check recent runs and resolve failures.
      </SettingsHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        {connectorsQuery.error instanceof Error ? (
          <p
            role="alert"
            className="px-4 pt-4 text-label text-danger-text md:px-6"
          >
            {describeConnectorsError(connectorsQuery.error)}
          </p>
        ) : connectors.length ? (
          <RegistryGrid
            label="Integrations"
            rows={connectors}
            columns={connectorColumns}
            getRowId={(connector) => connector.id}
            selectable={false}
          />
        ) : connectorsQuery.isLoading ? (
          <Muted className="px-4 pt-4 md:px-6">Loading integrations…</Muted>
        ) : (
          <div className="px-4 py-4 md:px-6">
            <EmptyState
              icon="pipeline"
              title="No connectors yet"
              description="Register an instrument or storage connection to start importing data."
              action={
                canManage ? (
                  <Button
                    variant="primary"
                    icon="plus"
                    onClick={() => setRegisterOpen(true)}
                  >
                    Register connector
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
      </div>
      {canOpenSettings(context.workspace, 'integrations') ? (
        <>
          <SettingsBody className="gap-3 border-t border-border-subtle pb-0">
            <h2 className="text-section">Outgoing webhooks</h2>
          </SettingsBody>
          <OutgoingWebhooks workspaceId={workspaceId} />
          <SettingsBody className="gap-3 pb-0">
            <h2 className="text-section">Incoming webhooks</h2>
          </SettingsBody>
          <IncomingWebhooks workspaceId={workspaceId} />
        </>
      ) : null}
      <RegisterConnectorDialog
        workspaceId={workspaceId}
        open={registerOpen}
        onOpenChange={setRegisterOpen}
      />
    </>
  )
}
