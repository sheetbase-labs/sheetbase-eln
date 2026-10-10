import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { DescriptionList, Muted, Section } from '#/components/v3/ui/layout'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { CapabilityGap } from '#/components/v3/ui/capability-gap'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { toast } from '#/components/v3/ui/sonner'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import {
  fetchConnectorDiagnosticsFn,
  fetchDiagnosticsFn,
  fetchRunHealthFn,
} from '#/lib/admin-platform'
import type {
  ConnectorDiagnosticsResult,
  DiagnosticsResult,
  RunHealthResult,
} from '#/lib/admin-platform'
import { useHelp } from '#/lib/help'
import { cn } from '#/lib/utils'

const diagnosticsKey = (workspaceId: string) => [
  'admin-diagnostics',
  workspaceId,
]
const runHealthKey = (workspaceId: string) => [
  'admin',
  workspaceId,
  'run-health',
]
const connectorsKey = (workspaceId: string) => [
  'admin',
  workspaceId,
  'connector-diagnostics',
]

/**
 * UI port (roadmap-4/ui-app3): workspace health for admins. Reads the real
 * deployment diagnostics, run health and connector diagnostics. The support
 * bundle needs a redacted bundle builder, which is not built, so it shows the
 * honest gap. `?state=denied|clear` drives the acceptance suite.
 */
export const Route = createFileRoute('/settings/diagnostics')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { state?: 'denied' | 'clear' } => ({
    state:
      search.state === 'denied' || search.state === 'clear'
        ? search.state
        : undefined,
  }),
  component: Diagnostics,
})

type Check = {
  key: string
  name: string
  status: string
  tone: Tone
  detail: string
  link?: { to: string; label: string }
}

function Diagnostics() {
  const { context } = Route.useRouteContext()
  const { state } = Route.useSearch()
  const workspaceId = context.workspace?.id ?? ''
  const role = context.workspace?.role
  const admin = role === 'owner' || role === 'admin'
  const help = useHelp()
  const queryClient = useQueryClient()
  const [running, setRunning] = useState(false)

  const diagnostics = useQuery({
    queryKey: diagnosticsKey(workspaceId),
    queryFn: () => fetchDiagnosticsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId) && admin,
  })
  const runHealth = useQuery({
    queryKey: runHealthKey(workspaceId),
    queryFn: () => fetchRunHealthFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId) && admin,
  })
  const connectors = useQuery({
    queryKey: connectorsKey(workspaceId),
    queryFn: () => fetchConnectorDiagnosticsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId) && admin,
  })

  if (!admin || state === 'denied') {
    return (
      <>
        <SettingsHeader title="Diagnostics" />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title="Only workspace admins can see diagnostics"
            body="Diagnostics show system checks and error details across every project. Ask a workspace admin if something isn’t working; they can send a support bundle to Sheetbase."
          />
        </div>
      </>
    )
  }

  if (diagnostics.isPending) {
    return (
      <>
        <SettingsHeader title="Diagnostics" />
        <div
          className="flex flex-col gap-3 px-6 py-5"
          aria-busy="true"
          aria-label="Loading diagnostics"
        >
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-80" />
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      </>
    )
  }

  if (diagnostics.isError) {
    return (
      <>
        <SettingsHeader title="Diagnostics" />
        <SettingsBody>
          <EmptyState
            icon="warn"
            title="Diagnostics could not be loaded"
            body="Check the connection and try again."
          />
        </SettingsBody>
      </>
    )
  }

  const d = diagnostics.data
  const checks = buildChecks(d, runHealth.data, connectors.data)
  const problems = checks.filter(
    (c) => c.tone === 'bad' || c.tone === 'warn',
  ).length
  const failures =
    state === 'clear'
      ? []
      : (runHealth.data?.failed ?? []).slice(0, 20).map((run) => ({
          id: run.id,
          area:
            run.kind === 'pipeline'
              ? 'Pipeline run'
              : run.kind === 'connector'
                ? 'Connector run'
                : 'Webhook delivery',
          message: run.error_message ?? run.error_code ?? 'Failed',
          record: run.label ?? run.id,
          requestId: run.error_code ?? run.id,
          time: formatTime(run.finishedAt ?? run.startedAt),
        }))

  async function runAll() {
    setRunning(true)
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: diagnosticsKey(workspaceId),
      }),
      queryClient.invalidateQueries({
        queryKey: runHealthKey(workspaceId),
      }),
      queryClient.invalidateQueries({
        queryKey: connectorsKey(workspaceId),
      }),
    ])
    setRunning(false)
    toast('Checks finished', {
      description: `${problems} need attention.`,
    })
  }

  return (
    <>
      <SettingsHeader
        title="Diagnostics"
        actions={
          <>
            <SupportBundle />
            <Button
              variant="primary"
              icon="play"
              disabled={running}
              onClick={() => void runAll()}
            >
              {running ? 'Running checks…' : 'Run checks'}
            </Button>
          </>
        }
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {problems ? (
            <Status tone="warn">{problems} checks need attention</Status>
          ) : null}
          <span>
            Checks read live from the deployment ·{' '}
            {help?.release.validation.label ?? 'running here'}
          </span>
        </span>
      </SettingsHeader>

      <Section title="System checks" className="px-4 pt-5 md:px-6">
        <div
          aria-busy={running || undefined}
          className="rounded-md border border-border"
        >
          <ul className="m-0 list-none p-0">
            {checks.map((c, i) => (
              <CheckRow
                key={c.key}
                c={c}
                running={running}
                last={i === checks.length - 1}
              />
            ))}
          </ul>
        </div>
      </Section>

      <SettingsBody className="gap-6">
        <Section
          title="Recent failures"
          count={failures.length}
          action={
            <Link to="/settings/audit" className="text-label">
              Audit log
            </Link>
          }
        >
          {failures.length ? (
            <>
              <ul className="m-0 list-none rounded-md border border-border p-0 md:hidden">
                {failures.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-col gap-0.5 border-b border-border-subtle px-3 py-2.5 last:border-b-0"
                  >
                    <span className="flex justify-between gap-2 text-label text-fg-muted">
                      <span>{e.area}</span>
                      <span className="num">{e.time}</span>
                    </span>
                    <span className="text-body leading-5">{e.message}</span>
                    <span className="mono text-label text-fg-muted">
                      {e.record}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="overflow-x-auto rounded-md border border-border max-md:hidden">
                <Table className="max-xl:min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      {['Time', 'Area', 'Message', 'Run'].map((h) => (
                        <TableHead key={h} className="first:pl-3">
                          {h}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {failures.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="first:pl-3">{e.time}</TableCell>
                        <TableCell>{e.area}</TableCell>
                        <TableCell className="min-w-[260px] whitespace-normal py-1.5 leading-[17px]">
                          {e.message}
                        </TableCell>
                        <TableCell className="mono">{e.record}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Muted>
                Failures from recent pipeline and connector runs. Messages never
                include record content.
              </Muted>
            </>
          ) : (
            <EmptyState
              icon="check"
              title="No recent failures"
              body="Anything that fails, from an import to a delivery, shows here so you can give support the run ID."
              className="py-4"
            />
          )}
        </Section>

        <Section title="Release">
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-md border border-border p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <DescriptionList
              labelWidth={130}
              className="text-body"
              items={[
                [
                  'Release',
                  <span>
                    <span className="mono">{d.deployment.artifactVersion}</span>{' '}
                    <span className="text-fg-muted">
                      build{' '}
                      <span className="mono">
                        {d.deployment.artifactDigest
                          .replace(/^sha256:/, '')
                          .slice(0, 12)}
                      </span>
                    </span>
                  </span>,
                ],
                [
                  'Validation',
                  <Status
                    tone={
                      help?.release.validation.tone === 'ok' ? 'ok' : 'warn'
                    }
                  >
                    {help?.release.validation.label ?? 'Development build'}
                  </Status>,
                ],
                [
                  'Environment',
                  <span className="mono">{d.deployment.environment}</span>,
                ],
              ]}
            />
            <DescriptionList
              labelWidth={130}
              className="text-body"
              items={[
                [
                  'Migration',
                  <span>
                    <span className="mono">{d.migration.expected}</span>{' '}
                    <Status
                      tone={
                        d.migration.status === 'compatible'
                          ? 'ok'
                          : d.migration.status === 'incompatible'
                            ? 'bad'
                            : 'warn'
                      }
                    >
                      {d.migration.status}
                    </Status>
                  </span>,
                ],
                ['Secret source', d.deployment.secretSource],
                ['File backend', d.config.fileBackend],
              ]}
            />
          </div>
          <Muted>
            Releases are validated before they reach this workspace. Nothing is
            updated without a change control approved by QA.
          </Muted>
        </Section>
      </SettingsBody>
    </>
  )
}

function buildChecks(
  d: DiagnosticsResult,
  runHealth: RunHealthResult | undefined,
  connectors: ConnectorDiagnosticsResult | undefined,
): Check[] {
  const healthTone: Tone =
    d.health.status === 'ready'
      ? 'ok'
      : d.health.status === 'degraded'
        ? 'warn'
        : 'bad'
  const checks: Check[] = [
    {
      key: 'database',
      name: 'Database',
      status: d.health.database.ok ? 'Healthy' : 'Down',
      tone: d.health.database.ok ? 'ok' : 'bad',
      detail: `PostgreSQL · ${d.health.database.latencyMs} ms`,
    },
    {
      key: 'postgrest',
      name: 'REST API',
      status: d.health.postgrest.ok ? 'Healthy' : 'Down',
      tone: d.health.postgrest.ok ? 'ok' : 'bad',
      detail: `PostgREST · ${d.health.postgrest.latencyMs} ms`,
    },
    {
      key: 'migration',
      name: 'Schema migration',
      status:
        d.migration.status === 'compatible'
          ? 'Compatible'
          : d.migration.status === 'incompatible'
            ? 'Incompatible'
            : 'Not checked',
      tone:
        d.migration.status === 'compatible'
          ? 'ok'
          : d.migration.status === 'incompatible'
            ? 'bad'
            : 'warn',
      detail: `Expected ${d.migration.expected}`,
    },
    {
      key: 'scheduler',
      name: 'Scheduler',
      status: d.scheduler.enabled ? 'Running' : 'Disabled',
      tone: d.scheduler.enabled ? 'ok' : 'warn',
      detail: `${d.scheduler.enabledScheduleCount} enabled schedules · sweep every ${d.scheduler.sweepIntervalSeconds}s`,
    },
    {
      key: 'executor',
      name: 'Pipeline executor',
      status: d.pipelineExecutor.recentFailures ? 'Failures' : 'Healthy',
      tone: d.pipelineExecutor.recentFailures ? 'warn' : 'ok',
      detail: `${d.pipelineExecutor.activeRuns} active · ${d.pipelineExecutor.recentFailures} recent failures`,
    },
    {
      key: 'connectors',
      name: 'Connector deliveries',
      status: connectors
        ? connectors.recentFailures
          ? 'Failures'
          : 'Healthy'
        : 'Not monitored',
      tone: connectors ? (connectors.recentFailures ? 'warn' : 'ok') : 'none',
      detail: connectors
        ? `${connectors.activeConnectors} active · ${connectors.recentFailures} recent failures${connectors.missingSecrets ? ` · ${connectors.missingSecrets} missing secrets` : ''}`
        : 'No check exists for this yet',
      link: { to: '/settings/integrations', label: 'Integrations' },
    },
    {
      key: 'webhooks',
      name: 'Webhook deliveries',
      status:
        runHealth && runHealth.webhook.deadLetter24h
          ? 'Dead letters'
          : runHealth
            ? 'Healthy'
            : 'Not monitored',
      tone: runHealth
        ? runHealth.webhook.deadLetter24h
          ? 'warn'
          : 'ok'
        : 'none',
      detail: runHealth
        ? `${runHealth.webhook.deadLetter24h} dead-letter in 24h · ${runHealth.webhook.retryDebt} awaiting retry`
        : 'No check exists for this yet',
    },
    {
      key: 'config',
      name: 'Configuration',
      status: d.config.connectorSecretEncryptionConfigured
        ? 'Healthy'
        : 'Review',
      tone: d.config.connectorSecretEncryptionConfigured ? 'ok' : 'warn',
      detail: `Auth ${d.config.authMode} · external API ${d.config.externalApiEnabled ? 'on' : 'off'} · metrics ${d.config.metricsEnabled ? 'on' : 'off'}`,
    },
  ]
  // Surface the overall health tone in the first row's status label so a
  // degraded deployment is never shown as fully healthy.
  if (healthTone === 'warn' && checks[0]) checks[0].status = 'Degraded'
  return checks
}

function CheckRow({
  c,
  running,
  last,
}: {
  c: Check
  running: boolean
  last: boolean
}) {
  const cls =
    c.tone === 'bad'
      ? 'text-danger-text'
      : c.tone === 'warn'
        ? 'text-warning-text'
        : undefined
  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 px-3 py-2.5 md:grid-cols-[200px_150px_minmax(0,1fr)] md:items-center',
        !last && 'border-b border-border-subtle',
      )}
    >
      <span className="text-body font-medium">{c.name}</span>
      <span className="text-label">
        {running ? (
          <Status tone="progress">Checking…</Status>
        ) : (
          <span className={cn('inline-flex', cls)}>
            <Status tone={c.tone}>{c.status}</Status>
          </span>
        )}
      </span>
      <span className="col-span-2 text-label leading-[18px] text-fg-muted md:col-span-1">
        {c.detail}
        {c.link ? (
          <>
            {' '}
            · <Link to={c.link.to}>{c.link.label}</Link>
          </>
        ) : null}
      </span>
    </li>
  )
}

function SupportBundle() {
  return (
    <CapabilityGap
      variant="inline"
      className="max-w-[520px]"
      title="Support bundles aren’t built yet"
      will="A redacted bundle (check results, error logs, job queue, configuration — secrets never included) will be downloadable for Sheetbase support."
      instead={[
        { label: 'Audit and retention', link: { to: '/settings/audit' } },
      ]}
    />
  )
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
