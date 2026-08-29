import { useQuery } from '@tanstack/react-query'

import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import {
  fetchConnectorDiagnosticsFn,
  fetchDiagnosticsFn,
} from '#/lib/admin-platform'
import { hasCapability } from '#/lib/capability'
import { formatRelativeTime } from '#/lib/workspace-admin'

function DefinitionTable({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <Table>
      <TableBody>
        {rows.map(([label, value]) => (
          <TableRow key={label}>
            <TableCell className="w-64 text-muted-foreground">
              {label}
            </TableCell>
            <TableCell className="font-medium">{value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function BooleanValue({ value }: { value: boolean }) {
  return (
    <span className={value ? 'text-success' : 'text-muted-foreground'}>
      {value ? 'Yes' : 'No'}
    </span>
  )
}

function HealthBadge({ ok }: { ok: boolean }) {
  return (
    <Badge variant={ok ? 'success' : 'danger'}>{ok ? 'Healthy' : 'Down'}</Badge>
  )
}

export function AdminDiagnostics({
  workspaceId,
  role,
}: {
  workspaceId: string
  role: string
}) {
  const diagnostics = useQuery({
    queryKey: ['admin-diagnostics', workspaceId],
    queryFn: () => fetchDiagnosticsFn({ data: { workspaceId } }),
  })
  const canManageConnectors = hasCapability(role, 'integrations.manage')
  const connectorDiagnostics = useQuery({
    queryKey: ['admin-connector-diagnostics', workspaceId],
    queryFn: () => fetchConnectorDiagnosticsFn({ data: { workspaceId } }),
    enabled: canManageConnectors,
  })

  if (diagnostics.isPending) {
    return <p className="text-sm text-muted-foreground">Loading diagnostics…</p>
  }
  if (diagnostics.isError) {
    return (
      <p className="text-sm text-destructive">
        Diagnostics could not be loaded.
      </p>
    )
  }

  const data = diagnostics.data
  const connectorData = connectorDiagnostics.data
  const overall =
    data.health.status === 'ready'
      ? { label: 'Ready', variant: 'success' as const }
      : data.health.status === 'degraded'
        ? { label: 'Degraded', variant: 'warning' as const }
        : { label: 'Not ready', variant: 'danger' as const }
  const migration =
    data.migration.status === 'compatible'
      ? { label: 'Compatible', variant: 'success' as const }
      : data.migration.status === 'incompatible'
        ? { label: 'Behind', variant: 'warning' as const }
        : { label: 'Not checked', variant: 'outline' as const }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="font-semibold">Health checks</h2>
        <DefinitionTable
          rows={[
            [
              'Database',
              <span className="flex items-center gap-3">
                <HealthBadge ok={data.health.database.ok} />
                <span className="tabular-nums text-muted-foreground">
                  {data.health.database.latencyMs}ms
                </span>
              </span>,
            ],
            [
              'PostgREST',
              <span className="flex items-center gap-3">
                <HealthBadge ok={data.health.postgrest.ok} />
                <span className="tabular-nums text-muted-foreground">
                  {data.health.postgrest.latencyMs}ms
                </span>
              </span>,
            ],
            [
              'Overall',
              <Badge variant={overall.variant}>{overall.label}</Badge>,
            ],
          ]}
        />
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Scheduler diagnostics</h2>
        <DefinitionTable
          rows={[
            [
              'Enabled',
              data.scheduler.enabled ? (
                <Badge variant="success">Enabled</Badge>
              ) : (
                <Badge variant="warning">Disabled</Badge>
              ),
            ],
            ['Sweep interval', `${data.scheduler.sweepIntervalSeconds}s`],
            [
              'Enabled schedules',
              data.scheduler.enabledScheduleCount.toLocaleString(),
            ],
            [
              'Last sweep',
              data.scheduler.lastSweepAt
                ? formatRelativeTime(data.scheduler.lastSweepAt)
                : data.scheduler.enabled
                  ? 'No schedules evaluated yet'
                  : '—',
            ],
            [
              'Recovered stale',
              data.scheduler.recoveredStaleCount.toLocaleString(),
            ],
          ]}
        />
        {!data.scheduler.enabled ? (
          <p className="text-xs text-muted-foreground">
            The pipeline scheduler is disabled. Schedules will not be evaluated
            until it is re-enabled.
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Pipeline executor diagnostics</h2>
        <DefinitionTable
          rows={[
            ['Active runs', data.pipelineExecutor.activeRuns.toLocaleString()],
            [
              'Recent failures',
              data.pipelineExecutor.recentFailures.toLocaleString(),
            ],
            [
              'Concurrency limit',
              data.pipelineExecutor.concurrencyLimit.toLocaleString(),
            ],
            [
              'Execution timeout',
              `${data.pipelineExecutor.executionTimeoutSeconds}s`,
            ],
            ['Row cap', data.pipelineExecutor.rowCap.toLocaleString()],
            ['Input cap', data.pipelineExecutor.inputCap.toLocaleString()],
          ]}
        />
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Configuration diagnostics</h2>
        <DefinitionTable
          rows={[
            ['File backend', data.config.fileBackend],
            ['Auth mode', data.config.authMode],
            [
              'External API enabled',
              <BooleanValue value={data.config.externalApiEnabled} />,
            ],
            [
              'Connector secret encryption',
              <Badge
                variant={
                  data.config.connectorSecretEncryptionConfigured
                    ? 'success'
                    : 'danger'
                }
              >
                {data.config.connectorSecretEncryptionConfigured
                  ? 'Configured'
                  : 'Not configured'}
              </Badge>,
            ],
            [
              'Metrics enabled',
              <BooleanValue value={data.config.metricsEnabled} />,
            ],
            [
              'Collaboration enabled',
              <BooleanValue value={data.config.collaborationEnabled} />,
            ],
          ]}
        />
      </section>

      {canManageConnectors ? (
        <section className="space-y-3">
          <h2 className="font-semibold">Connector diagnostics</h2>
          {connectorDiagnostics.isError ? (
            <p className="text-sm text-destructive">
              Connector diagnostics could not be loaded.
            </p>
          ) : connectorDiagnostics.isPending ? (
            <p className="text-sm text-muted-foreground">
              Loading connector diagnostics…
            </p>
          ) : connectorData ? (
            <>
              <DefinitionTable
                rows={[
                  ['Active connectors', connectorData.activeConnectors],
                  ['Paused', connectorData.pausedConnectors],
                  ['Recent failures', connectorData.recentFailures],
                  ['Missing secrets', connectorData.missingSecrets],
                  ['Repeated failures', connectorData.repeatedFailures],
                ]}
              />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead>Last result</TableHead>
                    <TableHead>Secrets</TableHead>
                    <TableHead className="text-right">Recent failures</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connectorData.connectors.map((connector) => (
                    <TableRow key={connector.id}>
                      <TableCell className="font-medium">
                        {connector.name}
                      </TableCell>
                      <TableCell>{connector.connectorType}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            connector.status === 'active'
                              ? 'success'
                              : 'warning'
                          }
                        >
                          {connector.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {connector.lastRunAt
                          ? formatRelativeTime(connector.lastRunAt)
                          : 'Never'}
                      </TableCell>
                      <TableCell>
                        {connector.lastRunStatus ?? 'Not run'}
                        {connector.lastErrorCode
                          ? ` (${connector.lastErrorCode})`
                          : ''}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={connector.hasSecrets ? 'success' : 'danger'}
                        >
                          {connector.hasSecrets ? 'Configured' : 'Missing'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {connector.recentFailureCount}
                      </TableCell>
                    </TableRow>
                  ))}
                  {connectorData.connectors.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-muted-foreground"
                      >
                        No connectors configured.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="font-semibold">Migration state</h2>
        <DefinitionTable
          rows={[
            ['Expected migration', data.migration.expected],
            ['Applied migration', data.migration.applied ?? 'Not checked'],
            [
              'Status',
              <Badge variant={migration.variant}>{migration.label}</Badge>,
            ],
          ]}
        />
      </section>
    </div>
  )
}
