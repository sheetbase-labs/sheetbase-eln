import { t } from '#/copy'
import { useState } from 'react'
import { getDisplayTimeZone } from '#/lib/display-time-zone'
import { WorkspaceAdminsLine } from '#/components/v3/settings/workspace-admins-line'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { CopyButton } from '#/components/v3/ui/copy-button'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { DescriptionList, Muted, Section } from '#/components/v3/ui/layout'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
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
import { sentenceCase } from '#/lib/sentence-case'
import { cn } from '#/lib/utils'
import { canOpenSettings } from '#/lib/settings-access'

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
  /**
   * R5-CONFIG-01 — when this check last actually ran. `checked` is a live
   * probe evaluated with this request; `ran` is the timestamp of the real
   * record the check reads. Null when no record exists yet.
   */
  lastRunAt: string | null
  lastRunKind: 'checked' | 'ran'
  link?: { to: string; label: string }
}

function Diagnostics() {
  const { context } = Route.useRouteContext()
  const { state } = Route.useSearch()
  const workspaceId = context.workspace?.id ?? ''
  const admin = canOpenSettings(context.workspace, 'diagnostics')
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
        <SettingsHeader title={t('settings.diagnostics.diagnostics')} />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title={t('settings.diagnostics.onlyWorkspaceAdmins')}
            description={
              <>
                {t('settings.diagnostics.diagnosticsShowSystem')}
                <WorkspaceAdminsLine workspaceId={workspaceId} />
              </>
            }
          />
        </div>
      </>
    )
  }

  if (diagnostics.isPending) {
    return (
      <>
        <SettingsHeader title={t('settings.diagnostics.diagnostics')} />
        <div
          className="flex flex-col gap-3 px-6 py-5"
          aria-busy="true"
          aria-label={t('settings.diagnostics.loadingDiagnosticsAria')}
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
        <SettingsHeader title={t('settings.diagnostics.diagnostics')} />
        <SettingsBody>
          <EmptyState
            icon="warn"
            title={t('settings.diagnostics.diagnosticsCouldLoaded')}
            description={t(
              'settings.diagnostics.checkConnectionTryDescription',
            )}
            action={
              <Button
                onClick={() => {
                  void diagnostics.refetch()
                  void runHealth.refetch()
                  void connectors.refetch()
                }}
              >
                {t('common.actions.tryAgain')}
              </Button>
            }
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
              ? t('settings.diagnostics.pipelineRun')
              : run.kind === 'connector'
                ? t('settings.diagnostics.connectorRun')
                : t('settings.diagnostics.webhookDelivery'),
          message: run.error_message ?? run.error_code ?? 'Failed',
          record: run.label,
          /**
           * R5-CONFIG-01 — the durable correlation identity support can quote
           * (observability.md: a failed ingestion is traced by its run id).
           * It is the same id the run's logs are keyed by.
           */
          requestId: run.id,
          time: formatTime(run.finishedAt ?? run.startedAt),
        }))
  const failureColumns: RegistryColumn<(typeof failures)[number]>[] = [
    {
      id: 'time',
      header: 'Time',
      meta: { headerClassName: 'pl-3!', cellClassName: 'pl-3!' },
      cell: ({ row }) => row.original.time,
    },
    {
      id: 'area',
      header: 'Area',
      cell: ({ row }) => row.original.area,
    },
    {
      id: 'message',
      header: 'Message',
      meta: {
        cellClassName: 'min-w-[260px] whitespace-normal py-1.5! leading-[17px]',
      },
      cell: ({ row }) => row.original.message,
    },
    {
      id: 'record',
      header: 'Record',
      meta: { cellClassName: 'mono' },
      cell: ({ row }) => row.original.record ?? '—',
    },
    {
      id: 'requestId',
      header: t('settings.diagnostics.requestId'),
      cell: ({ row }) => <RequestIdCell id={row.original.requestId} />,
    },
  ]

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
    toast(t('settings.diagnostics.checksFinishedToast'), {
      description: t('settings.diagnostics.needAttentionDescription', {
        problems,
      }),
    })
  }

  return (
    <>
      <SettingsHeader
        title={t('settings.diagnostics.diagnostics')}
        actions={
          <>
            <Button
              variant="primary"
              icon="play"
              disabled={running}
              onClick={() => void runAll()}
            >
              {running
                ? t('settings.diagnostics.runningChecks')
                : t('settings.diagnostics.runChecks')}
            </Button>
          </>
        }
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {problems ? (
            <Status tone="warn">
              {problems === 1
                ? '1 check needs attention'
                : `${problems} checks need attention`}
            </Status>
          ) : null}
          <span>
            Checks run live against this workspace ·{' '}
            {help?.release.validation.label ?? 'running here'}
          </span>
        </span>
      </SettingsHeader>

      <Section
        title={t('settings.diagnostics.systemChecks')}
        className="px-4 pt-5 md:px-6"
      >
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
          title={t('settings.diagnostics.recentFailures')}
          count={failures.length}
          action={
            <Link to="/settings/audit" className="text-label">
              {t('settings.diagnostics.auditLog')}
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
                    {e.record ? (
                      <span className="mono text-label text-fg-muted">
                        {e.record}
                      </span>
                    ) : null}
                    <span className="mt-0.5 flex items-center gap-1 text-label text-fg-muted">
                      <span>{t('settings.diagnostics.requestId')}</span>
                      <RequestIdCell id={e.requestId} />
                    </span>
                  </li>
                ))}
              </ul>
              <div className="overflow-x-auto rounded-md border border-border max-md:hidden">
                <RegistryGrid
                  label={t('settings.diagnostics.recentFailures')}
                  rows={failures}
                  columns={failureColumns}
                  getRowId={(failure) => failure.id}
                  selectable={false}
                />
              </div>
              <Muted>{t('settings.diagnostics.failuresRecentPipeline')}</Muted>
            </>
          ) : (
            <EmptyState
              icon="check"
              title={t('settings.diagnostics.recentFailures2')}
              description={t(
                'settings.diagnostics.anythingFailsImportDescription',
              )}
              className="py-4"
            />
          )}
        </Section>

        <Section title={t('settings.diagnostics.release')}>
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-md border border-border p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <DescriptionList
              labelWidth={130}
              className="text-body"
              items={[
                [
                  'Release',
                  <span>
                    <span className="mono">{d.deployment.artifactVersion}</span>{' '}
                    {d.deployment.artifactDigest === 'untracked' ? null : (
                      <span className="text-fg-muted">
                        build{' '}
                        <span className="mono">
                          {d.deployment.artifactDigest
                            .replace(/^sha256:/, '')
                            .slice(0, 12)}
                        </span>
                      </span>
                    )}
                  </span>,
                ],
                [
                  'Validation',
                  <Status
                    tone={
                      help?.release.validation.tone === 'ok' ? 'ok' : 'warn'
                    }
                  >
                    {help?.release.validation.label ??
                      t('settings.diagnostics.developmentBuild')}
                  </Status>,
                ],
                ['Environment', sentenceCase(d.deployment.environment)],
              ]}
            />
            <DescriptionList
              labelWidth={130}
              className="text-body"
              items={[
                [
                  'Migration',
                  <span>
                    {d.migration.expected === 'untracked' ? null : (
                      <span className="mono">{d.migration.expected} </span>
                    )}
                    <Status
                      tone={
                        d.migration.status === 'compatible'
                          ? 'ok'
                          : d.migration.status === 'incompatible'
                            ? 'bad'
                            : 'warn'
                      }
                    >
                      {sentenceCase(d.migration.status)}
                    </Status>
                  </span>,
                ],
                ...(d.deployment.secretSource === 'local-env'
                  ? []
                  : [
                      [
                        'Secrets kept in',
                        sentenceCase(d.deployment.secretSource),
                      ] as [string, React.ReactNode],
                    ]),
                ['File storage', sentenceCase(d.config.fileBackend)],
              ]}
            />
          </div>
          <Muted>{t('settings.diagnostics.releasesValidatedBefore')}</Muted>
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
      detail: `Responds in ${d.health.database.latencyMs} ms`,
      lastRunAt: d.checkedAt,
      lastRunKind: 'checked',
    },
    {
      key: 'postgrest',
      name: 'REST API',
      status: d.health.postgrest.ok ? 'Healthy' : 'Down',
      tone: d.health.postgrest.ok ? 'ok' : 'bad',
      detail: `Responds in ${d.health.postgrest.latencyMs} ms`,
      lastRunAt: d.checkedAt,
      lastRunKind: 'checked',
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
      detail:
        d.migration.expected === 'untracked'
          ? 'This build does not report a schema version'
          : `Release schema ${d.migration.expected}`,
      lastRunAt: d.migration.status === 'not_checked' ? null : d.checkedAt,
      lastRunKind: 'checked',
    },
    {
      key: 'scheduler',
      name: 'Scheduler',
      status: d.scheduler.enabled ? 'Running' : 'Disabled',
      tone: d.scheduler.enabled ? 'ok' : 'warn',
      detail: `${d.scheduler.enabledScheduleCount} enabled schedules · sweep every ${d.scheduler.sweepIntervalSeconds}s`,
      lastRunAt: d.scheduler.lastSweepAt,
      lastRunKind: 'ran',
    },
    {
      key: 'executor',
      name: 'Pipeline executor',
      status: d.pipelineExecutor.recentFailures ? 'Failures' : 'Healthy',
      tone: d.pipelineExecutor.recentFailures ? 'warn' : 'ok',
      detail: `${d.pipelineExecutor.activeRuns} active · ${d.pipelineExecutor.recentFailures} recent failures`,
      lastRunAt: d.lastPipelineRunAt,
      lastRunKind: 'ran',
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
        : t('settings.diagnostics.checkExistsYet'),
      lastRunAt: connectors ? d.lastConnectorRunAt : null,
      lastRunKind: 'ran',
      link: {
        to: '/settings/integrations',
        label: t('settings.diagnostics.integrations'),
      },
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
        : t('settings.diagnostics.checkExistsYet'),
      lastRunAt: runHealth ? d.lastWebhookDeliveryAt : null,
      lastRunKind: 'ran',
    },
    {
      key: 'config',
      name: 'Configuration',
      status: d.config.connectorSecretEncryptionConfigured
        ? 'Healthy'
        : 'Review',
      tone: d.config.connectorSecretEncryptionConfigured ? 'ok' : 'warn',
      detail: `${d.config.authMode === 'github_oauth' ? 'GitHub sign-in' : 'No sign-in required'} · external API ${d.config.externalApiEnabled ? 'on' : 'off'} · metrics ${d.config.metricsEnabled ? 'on' : 'off'}`,
      lastRunAt: d.checkedAt,
      lastRunKind: 'checked',
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
        'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 px-3 py-2.5 md:grid-cols-[200px_150px_minmax(0,1fr)_auto] md:items-center',
        !last && 'border-b border-border-subtle',
      )}
    >
      <span className="text-body font-medium">{c.name}</span>
      <span className="text-label">
        {running ? (
          <Status tone="progress">{t('settings.diagnostics.checking')}</Status>
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
      <span className="num text-label text-fg-muted md:text-right">
        {running ? null : c.lastRunAt ? (
          <>
            {c.lastRunKind === 'ran'
              ? t('settings.diagnostics.lastRan')
              : 'Checked'}{' '}
            {formatTime(c.lastRunAt)}
          </>
        ) : (
          <span className="text-fg-faint">
            {t('settings.diagnostics.recordYet')}
          </span>
        )}
      </span>
    </li>
  )
}

/**
 * R5-CONFIG-01 — the quotable correlation identity for a failed run, with a
 * copy affordance so an admin can paste it into a support ticket.
 */
function RequestIdCell({ id }: { id: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="mono text-label">{id}</span>
      <CopyButton
        value={id}
        size="icon"
        aria-label={t('settings.diagnostics.copyRequestIdAria', { id })}
        copiedMessage={t('settings.diagnostics.copied', { id })}
      />
    </span>
  )
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date
    .toLocaleString('en-GB', {
      timeZone: getDisplayTimeZone(),
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace('Sept', 'Sep')
}
