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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { RegisterConnectorDialog } from '#/components/integrations/register-connector-dialog'
import { createDataClient } from '#/lib/data-client'
import { hasCapability } from '#/lib/capability'
import {
  connectorQueryKeys,
  describeConnectorsError,
  listConnectors,
} from '#/lib/connectors/client'

// Register built-in instrument parsers before the catalogue renders.
import '#/lib/connectors/plate-reader'

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

function IntegrationsList() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const canManage = hasCapability(
    context.workspace?.role,
    'integrations.manage',
  )
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
          <Table aria-label="Integrations">
            <TableHeader>
              <TableRow>
                <TableHead>Connector</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connectors.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      to="/settings/integrations/$connectorId"
                      params={{ connectorId: c.id }}
                    >
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="mono">{c.key}</TableCell>
                  <TableCell>{c.connector_type}</TableCell>
                  <TableCell>{c.direction}</TableCell>
                  <TableCell>
                    <Status tone={c.status === 'active' ? 'ok' : 'stored'}>
                      {c.status}
                    </Status>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : connectorsQuery.isLoading ? (
          <Muted className="px-4 pt-4 md:px-6">Loading integrations…</Muted>
        ) : (
          <div className="px-4 py-4 md:px-6">
            <EmptyState
              icon="pipeline"
              title="No connectors yet"
              body="Register an instrument or storage connection to start importing data."
            />
          </div>
        )}
      </div>
      <SettingsBody className="border-t border-border-subtle">
        <Muted>
          {canManage
            ? 'Connector configuration is non-secret; third-party credentials are sealed secrets managed by stewards.'
            : 'You can view integrations; only owners, admins and stewards register or pause connectors.'}
        </Muted>
      </SettingsBody>
      <RegisterConnectorDialog
        workspaceId={workspaceId}
        open={registerOpen}
        onOpenChange={setRegisterOpen}
      />
    </>
  )
}
