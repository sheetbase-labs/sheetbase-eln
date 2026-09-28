import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import {
  fetchConnectorDiagnosticsFn,
  retryConnectorRunFn,
} from '#/lib/admin-platform'
import { hasCapability } from '#/lib/capability'

import {
  connectorQueryKeys,
  describeConnectorsError,
  listConnectorRuns,
  listConnectors,
  updateConnector,
} from '#/lib/connectors/client'
import { createDataClient } from '#/lib/data-client'
import { formatRelativeTime } from '#/lib/workspace-admin'

const dataClient = createDataClient()

const statusClass: Record<string, string> = {
  active: 'bg-success-wash text-success-text',
  paused: 'bg-warning-wash text-warning-text',
  archived: 'bg-muted text-muted-foreground',
}

export function AdminConnectors({
  workspaceId,
  role,
}: {
  workspaceId: string
  role: string
}) {
  const queryClient = useQueryClient()
  const canManage = hasCapability(role, 'integrations.manage')
  const connectorsQuery = useQuery({
    queryKey: connectorQueryKeys.connectors,
    queryFn: () => listConnectors(dataClient),
  })
  const connectors = connectorsQuery.data ?? []
  const runsQuery = useQuery({
    queryKey: [...connectorQueryKeys.connectors, 'admin-runs'],
    queryFn: async () =>
      new Map(
        await Promise.all(
          connectors.map(
            async (connector) =>
              [
                connector.id,
                (await listConnectorRuns(dataClient, connector.id, 1))[0],
              ] as const,
          ),
        ),
      ),
    enabled: connectors.length > 0,
  })
  const diagnosticsQuery = useQuery({
    queryKey: [...connectorQueryKeys.connectors, 'diagnostics', workspaceId],
    queryFn: () => fetchConnectorDiagnosticsFn({ data: { workspaceId } }),
    enabled: canManage,
  })
  const toggleMutation = useMutation({
    mutationFn: (connector: (typeof connectors)[number]) =>
      updateConnector(dataClient, {
        workspaceId,
        connectorId: connector.id,
        status: connector.status === 'active' ? 'paused' : 'active',
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: connectorQueryKeys.connectors,
      }),
  })
  const retryMutation = useMutation({
    mutationFn: (runId: string) =>
      retryConnectorRunFn({ data: { workspaceId, runId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: connectorQueryKeys.connectors,
      })
    },
  })
  const diagnostics = diagnosticsQuery.data
  const diagnosticById = new Map(
    diagnostics?.connectors.map((item) => [item.id, item]),
  )
  const error =
    connectorsQuery.error ?? diagnosticsQuery.error ?? toggleMutation.error

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {canManage
          ? [
              ['Active connectors', diagnostics?.activeConnectors ?? 0],
              ['Paused', diagnostics?.pausedConnectors ?? 0],
              ['Recent failures', diagnostics?.recentFailures ?? 0],
              ['Missing secrets', diagnostics?.missingSecrets ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-background p-3">
                <div className="text-2xl font-semibold">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))
          : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {describeConnectorsError(error)}
        </p>
      ) : null}
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead>Last result</TableHead>
              <TableHead>Secrets</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connectors.map((connector) => {
              const run = runsQuery.data?.get(connector.id)
              const diagnostic = diagnosticById.get(connector.id)
              const canRetry = canManage && run?.status === 'failed'
              return (
                <TableRow key={connector.id}>
                  <TableCell className="font-medium">
                    <Link
                      to="/settings/integrations/$connectorId"
                      params={{ connectorId: connector.id }}
                      className="hover:underline"
                    >
                      {connector.name}
                    </Link>
                  </TableCell>
                  <TableCell>{connector.connector_type}</TableCell>
                  <TableCell>{connector.direction}</TableCell>
                  <TableCell>
                    <Badge className={statusClass[connector.status]}>
                      {connector.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {formatRelativeTime(
                      run?.started_at ?? diagnostic?.lastRunAt,
                    )}
                  </TableCell>
                  <TableCell>
                    {run?.status ?? diagnostic?.lastRunStatus ?? '—'}
                  </TableCell>
                  <TableCell>
                    {canManage
                      ? diagnostic?.hasSecrets
                        ? 'Configured'
                        : 'Missing'
                      : '—'}
                  </TableCell>
                  <TableCell className="space-x-2">
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          toggleMutation.isPending ||
                          connector.status === 'archived'
                        }
                        onClick={() => toggleMutation.mutate(connector)}
                      >
                        {connector.status === 'active' ? 'Disable' : 'Enable'}
                      </Button>
                    ) : null}
                    {canRetry ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          retryMutation.isPending &&
                          retryMutation.variables === run.id
                        }
                        onClick={() => retryMutation.mutate(run.id)}
                      >
                        Retry
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Button size="sm" variant="ghost" asChild>
                        <Link
                          to="/settings/integrations/$connectorId"
                          params={{ connectorId: connector.id }}
                        >
                          Details
                        </Link>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
            {!connectors.length ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-muted-foreground"
                >
                  No connectors configured.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
