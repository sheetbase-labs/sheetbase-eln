import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Info } from 'lucide-react'

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
  fetchAttentionFn,
  fetchDiagnosticsFn,
  fetchRunHealthFn,
  fetchUsageFn,
} from '#/lib/admin-platform'
import { formatRelativeTime } from '#/lib/workspace-admin'

export function AdminDashboard({ workspaceId }: { workspaceId: string }) {
  const diagnostics = useQuery({
    queryKey: ['admin-platform', workspaceId, 'diagnostics'],
    queryFn: () => fetchDiagnosticsFn({ data: { workspaceId } }),
  })
  const usage = useQuery({
    queryKey: ['admin-platform', workspaceId, 'usage'],
    queryFn: () => fetchUsageFn({ data: { workspaceId } }),
  })
  const runHealth = useQuery({
    queryKey: ['admin-platform', workspaceId, 'run-health'],
    queryFn: () => fetchRunHealthFn({ data: { workspaceId } }),
  })
  const attention = useQuery({
    queryKey: ['admin-platform', workspaceId, 'attention'],
    queryFn: () => fetchAttentionFn({ data: { workspaceId } }),
  })

  const pipelineRunning = countRuns(runHealth.data?.running, 'pipeline')
  const pipelineFailed = countRuns(runHealth.data?.failed, 'pipeline')
  const connectorRunning = countRuns(runHealth.data?.running, 'connector')
  const connectorFailed = countRuns(runHealth.data?.failed, 'connector')
  const webhookFailed = countRuns(runHealth.data?.failed, 'webhook')
  const webhookSummary = runHealth.data?.webhook
  const latestSuccess = runHealth.data?.recentlySucceeded[0]

  return (
    <div className="max-w-4xl space-y-6 text-sm">
      <Section title="Health">
        <DefinitionRows
          rows={[
            {
              label: 'App',
              value: diagnostics.data
                ? healthLabel(diagnostics.data.health.status)
                : queryPlaceholder(diagnostics),
              tone: diagnostics.data
                ? appTone(diagnostics.data.health.status)
                : undefined,
            },
            {
              label: 'Database',
              value: diagnostics.data
                ? diagnostics.data.health.database.ok
                  ? 'Healthy'
                  : 'Down'
                : queryPlaceholder(diagnostics),
              tone: diagnostics.data
                ? diagnostics.data.health.database.ok
                  ? 'healthy'
                  : 'down'
                : undefined,
            },
            {
              label: 'PostgREST',
              value: diagnostics.data
                ? diagnostics.data.health.postgrest.ok
                  ? 'Healthy'
                  : 'Down'
                : queryPlaceholder(diagnostics),
              tone: diagnostics.data
                ? diagnostics.data.health.postgrest.ok
                  ? 'healthy'
                  : 'down'
                : undefined,
            },
            {
              label: 'Scheduler',
              value: diagnostics.data
                ? `${diagnostics.data.scheduler.enabled ? 'Enabled' : 'Disabled'} (${diagnostics.data.scheduler.enabledScheduleCount} schedules)`
                : queryPlaceholder(diagnostics),
              tone: diagnostics.data
                ? diagnostics.data.scheduler.enabled
                  ? 'healthy'
                  : 'degraded'
                : undefined,
            },
          ]}
        />
      </Section>
      <Section title="Activity">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 pl-0">Run type</TableHead>
              <TableHead className="h-8">Running</TableHead>
              <TableHead className="h-8">Failed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(['Pipeline', 'Connector'] as const).map((kind) => {
              const running =
                kind === 'Pipeline' ? pipelineRunning : connectorRunning
              const failed =
                kind === 'Pipeline' ? pipelineFailed : connectorFailed
              const section = kind === 'Pipeline' ? 'pipelines' : 'connectors'
              return (
                <TableRow key={kind}>
                  <TableCell className="py-2 pl-0 font-medium">
                    {kind} runs
                  </TableCell>
                  <TableCell className="py-2">
                    {runHealth.data ? running : '—'}
                  </TableCell>
                  <TableCell className="py-2">
                    {runHealth.data ? (
                      <span className="flex items-center gap-2">
                        <Badge variant={failed ? 'danger' : 'outline'}>
                          {failed} failed
                        </Badge>
                        {failed > 0 ? (
                          <Link
                            to="/admin/$section"
                            params={{ section }}
                            search={{ model: undefined }}
                            className="font-medium text-primary hover:underline"
                          >
                            View
                          </Link>
                        ) : null}
                      </span>
                    ) : (
                      queryPlaceholder(runHealth)
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            <TableRow>
              <TableCell className="py-2 pl-0 font-medium">
                Webhook deliveries
              </TableCell>
              <TableCell className="py-2">
                {runHealth.data && webhookSummary
                  ? `${webhookSummary.retryDebt} queued`
                  : '—'}
              </TableCell>
              <TableCell className="py-2">
                {runHealth.data && webhookSummary ? (
                  <span className="flex items-center gap-2">
                    <Badge variant={webhookFailed ? 'danger' : 'outline'}>
                      {webhookFailed} dead-lettered
                    </Badge>
                    <Link
                      to="/admin/$section"
                      params={{ section: 'webhooks' }}
                      search={{ model: undefined }}
                      className="font-medium text-primary hover:underline"
                    >
                      View
                    </Link>
                  </span>
                ) : (
                  queryPlaceholder(runHealth)
                )}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        {webhookSummary && webhookSummary.autoDisabled > 0 ? (
          <p className="mt-2 text-xs text-warning">
            {webhookSummary.autoDisabled} webhook endpoint
            {webhookSummary.autoDisabled === 1 ? '' : 's'} auto-disabled —{' '}
            <Link
              to="/admin/$section"
              params={{ section: 'webhooks' }}
              search={{ model: undefined }}
              className="font-medium text-primary hover:underline"
            >
              re-enable from endpoint health
            </Link>
            .
          </p>
        ) : null}
        {latestSuccess ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Last successful run{' '}
            {formatRelativeTime(
              latestSuccess.finishedAt ?? latestSuccess.startedAt,
            )}
          </p>
        ) : null}
      </Section>

      <Section title="Usage">
        <DefinitionRows
          rows={[
            {
              label: 'Datasets',
              value: usage.data?.datasets ?? queryPlaceholder(usage),
            },
            {
              label: 'Versions',
              value: usage.data?.datasetVersions ?? queryPlaceholder(usage),
            },
            {
              label: 'Files',
              value: usage.data
                ? `${usage.data.files} / ${formatGigabytes(usage.data.fileBytes)}`
                : queryPlaceholder(usage),
            },
            {
              label: 'Members',
              value: usage.data?.members ?? queryPlaceholder(usage),
            },
          ]}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {usage.data?.limits.fileBytes.byteLimit != null ? (
            <>
              Storage quota applies — see usage for the limit and at-limit
              behaviour.
            </>
          ) : (
            <>
              No workspace storage quota is configured — figures are observed
              usage, not quota consumption. Nothing is blocked at any size.
            </>
          )}{' '}
          <Link
            to="/admin/$section"
            params={{ section: 'usage' }}
            search={{ model: undefined }}
            className="font-medium text-primary hover:underline"
          >
            Details
          </Link>
        </p>
      </Section>

      <Section title="Attention">
        {attention.isPending ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : attention.isError ? (
          <p className="text-destructive">
            Unable to load attention indicators.
          </p>
        ) : // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        attention.data && attention.data.length > 0 ? (
          <ul className="divide-y border-y">
            {attention.data.map((item, index) => {
              const Icon = item.level === 'warning' ? AlertTriangle : Info
              return (
                <li
                  key={`${item.category}-${index}`}
                  className="flex items-start gap-2 py-2"
                >
                  <Icon
                    aria-hidden="true"
                    className={
                      item.level === 'warning'
                        ? 'mt-0.5 size-4 text-warning'
                        : 'mt-0.5 size-4 text-info'
                    }
                  />
                  <span className="min-w-0 flex-1">{item.message}</span>
                  {item.runbook ? (
                    <Link
                      to="/docs/$name"
                      params={{ name: item.runbook }}
                      className="shrink-0 text-muted-foreground hover:underline"
                    >
                      Runbook
                    </Link>
                  ) : null}
                  {item.link ? (
                    <Link
                      to={item.link}
                      className="shrink-0 font-medium text-primary hover:underline"
                    >
                      View
                    </Link>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground">No items need attention.</p>
        )}
      </Section>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

type Tone = 'healthy' | 'down' | 'degraded'

function DefinitionRows({
  rows,
}: {
  rows: Array<{ label: string; value: React.ReactNode; tone?: Tone }>
}) {
  return (
    <dl className="divide-y border-y">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[9rem_1fr] gap-3 py-2">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd
            className={
              row.tone === 'healthy'
                ? 'font-medium text-success'
                : row.tone === 'down'
                  ? 'font-medium text-destructive'
                  : row.tone === 'degraded'
                    ? 'font-medium text-warning'
                    : 'font-medium'
            }
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
function countRuns(
  runs: Array<{ kind: 'pipeline' | 'connector' | 'webhook' }> | undefined,
  kind: 'pipeline' | 'connector' | 'webhook',
) {
  return runs?.filter((run) => run.kind === kind).length ?? 0
}

function healthLabel(status: 'ready' | 'not_ready' | 'degraded') {
  if (status === 'ready') return 'Healthy'
  if (status === 'not_ready') return 'Not ready'
  return 'Degraded'
}

function appTone(status: 'ready' | 'not_ready' | 'degraded'): Tone {
  if (status === 'ready') return 'healthy'
  if (status === 'not_ready') return 'down'
  return 'degraded'
}

function formatGigabytes(bytes: number) {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

function queryPlaceholder(query: { isError: boolean }) {
  return query.isError ? 'Unavailable' : 'Loading…'
}
