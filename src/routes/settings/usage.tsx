import { t } from '#/copy'
import { Link, createFileRoute } from '@tanstack/react-router'
import { WorkspaceAdminsLine } from '#/components/v3/settings/workspace-admins-line'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted, Section } from '#/components/v3/ui/layout'
import { Progress } from '#/components/v3/ui/progress'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { Status } from '#/components/v3/ui/status'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { toast } from '#/components/v3/ui/sonner'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import { downloadTextFile } from '#/lib/download'
import { fetchStorageOverviewFn, fetchUsageFn } from '#/lib/admin-platform'
import type {
  StorageOverviewResult,
  UsageResult,
  UsageTrendPoint,
} from '#/lib/admin-platform'
import {
  adminQueryKeys,
  fetchWorkspaceMembers,
  WORKSPACE_ROLE_LABELS,
} from '#/lib/workspace-admin'
import { formatFileSize } from '#/lib/format-numbers'
import { cn } from '#/lib/utils'
import { now as appNow } from '#/lib/clock'
import { canOpenSettings } from '#/lib/settings-access'

/**
 * UI port (roadmap-4/ui-app3): how the workspace uses its plan. Reads the real
 * usage and storage figures. Plan limits come from deployment configuration
 * (`SHEETBASE_WORKSPACE_STORAGE_QUOTA_BYTES`, `SHEETBASE_WORKSPACE_SEAT_LIMIT`)
 * and thresholds/trends appear only for what the deployment measures; per-token
 * call metering and run minutes are not built, so those meters say so instead
 * of inventing a number. `?state=denied` drives the acceptance suite.
 */
export const Route = createFileRoute('/settings/usage')({
  validateSearch: (search: Record<string, unknown>): { state?: 'denied' } => ({
    state: search.state === 'denied' ? 'denied' : undefined,
  }),
  component: Usage,
})

const dataClient = createDataClient()

/** RFC 4180 cell: quote everything, and double any embedded quote. */
function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

/**
 * The figures this page shows, as CSV. Built from the same values the meters
 * render so the export and the screen cannot disagree: a figure the deployment
 * does not measure is left out rather than exported as an invented zero.
 */
export function buildUsageCsv(input: {
  workspaceName: string
  period: string
  usage: UsageResult
  storage: StorageOverviewResult | null
}): string {
  const { usage: d, storage: s } = input
  const rows: Array<[string, string | number]> = [
    ['Workspace', input.workspaceName],
    ['Period', input.period],
    ['Seats', d.members],
    ['Storage bytes', s ? s.fileBytes : d.fileBytes],
    ['Files', s ? s.fileCount : d.files],
    ['Dataset versions', s ? s.datasetVersionCount : d.datasetVersions],
    ['Datasets', s ? s.datasetCount : d.datasets],
    ['Pipeline definitions', d.pipelineDefinitions],
    ['Pipeline runs', d.pipelineRuns],
    ['Connector runs', d.connectorRuns],
    ['Connectors', d.connectors],
  ]
  for (const point of d.trend) {
    rows.push([`Runs ${point.month}`, point.pipelineRuns + point.connectorRuns])
  }
  return [
    ['metric', 'value'].map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n')
}

const usageKey = (workspaceId: string) => ['admin-usage', workspaceId]
const storageKey = (workspaceId: string) => [
  'admin',
  workspaceId,
  'storage-overview',
]

function Usage() {
  const { context } = Route.useRouteContext()
  const { state } = Route.useSearch()
  const workspaceId = context.workspace?.id ?? ''
  const admin = canOpenSettings(context.workspace, 'usage')

  const usage = useQuery({
    queryKey: usageKey(workspaceId),
    queryFn: () => fetchUsageFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId) && admin,
  })
  const storage = useQuery({
    queryKey: storageKey(workspaceId),
    queryFn: () => fetchStorageOverviewFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId) && admin,
  })
  const members = useQuery({
    queryKey: adminQueryKeys.members(workspaceId),
    queryFn: () => fetchWorkspaceMembers(dataClient, workspaceId),
    enabled: Boolean(workspaceId) && admin,
  })

  if (!admin || state === 'denied') {
    return (
      <>
        <SettingsHeader title={t('settings.usage.usage')} />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title={t('settings.usage.onlyWorkspaceAdmins')}
            description={
              <>
                {t('settings.usage.usageShowsSeats')}
                <WorkspaceAdminsLine workspaceId={workspaceId} />
              </>
            }
          />
        </div>
      </>
    )
  }

  if (usage.isPending) {
    return (
      <>
        <SettingsHeader title={t('settings.usage.usage')} />
        <div
          className="flex flex-col gap-3 px-6 py-5"
          aria-busy="true"
          aria-label={t('settings.usage.loadingUsageAria')}
        >
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-80" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        </div>
      </>
    )
  }

  if (usage.isError) {
    return (
      <>
        <SettingsHeader title={t('settings.usage.usage')} />
        <SettingsBody>
          <EmptyState
            icon="warn"
            title={t('settings.usage.usageCouldLoaded')}
            description={t('settings.usage.checkConnectionTryDescription')}
            action={
              <Button
                onClick={() => {
                  void usage.refetch()
                  void storage.refetch()
                  void members.refetch()
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

  const d = usage.data
  const membersByRole = new Map<string, number>()
  for (const m of members.data ?? []) {
    const key = m.clientId ? 'client' : m.role
    membersByRole.set(key, (membersByRole.get(key) ?? 0) + 1)
  }
  const seatsByRole = [...membersByRole.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )
  const s = storage.data
  const seatLimit = d.limits.seats.seatLimit
  const byteLimit = d.limits.fileBytes.byteLimit
  const storageBytes = s ? s.fileBytes : d.fileBytes
  // Percent and thresholds only appear where a limit is actually configured;
  // an unmeasured or unlimited figure never gets a bar or a colour.
  const seatPercent = seatLimit ? (d.members / seatLimit) * 100 : null
  const storagePercent = byteLimit ? (storageBytes / byteLimit) * 100 : null
  const storageRows = s
    ? [
        ['Files and instrument exports', formatFileSize(s.fileBytes)],
        [
          'Dataset versions',
          `${s.datasetVersionCount.toLocaleString('en-GB')} versions · ${s.datasetCount.toLocaleString('en-GB')} datasets`,
        ],
        ['Snapshots kept for retention', 'Included in dataset versions'],
      ]
    : []

  return (
    <>
      <SettingsHeader
        title={t('settings.usage.usage')}
        actions={
          <Button
            icon="download"
            onClick={() => {
              try {
                downloadTextFile(
                  'sheetbase-usage.csv',
                  buildUsageCsv({
                    workspaceName: context.workspace?.name ?? 'Workspace',
                    period: formatPeriod(),
                    usage: d,
                    storage: s ?? null,
                  }),
                  'text/csv',
                )
                toast(t('settings.usage.sheetbaseUsageCsvToast'), {
                  description: t(
                    'settings.usage.currentTotalsWorkspaceDescription',
                  ),
                })
              } catch (error) {
                toast(t('settings.usage.couldExportUsageToast'), {
                  description:
                    error instanceof Error
                      ? error.message
                      : t('settings.usage.browserBlockedDownload'),
                })
              }
            }}
          >
            {t('settings.usage.exportCsv')}
          </Button>
        }
      >
        {t('settings.usage.currentWorkspace', { formatPeriod: formatPeriod() })}
      </SettingsHeader>
      <SettingsBody>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MeterCard
            label={t('settings.usage.seats')}
            value={d.members.toLocaleString('en-GB')}
            limit={
              seatLimit ? `${seatLimit.toLocaleString('en-GB')} seats` : null
            }
            percent={seatPercent}
            note={
              seatLimit
                ? t('settings.usage.everyoneWorkspaceAccess')
                : t('settings.usage.everyoneWorkspaceAccess2')
            }
          />
          <MeterCard
            label={t('settings.usage.storage')}
            value={formatFileSize(storageBytes)}
            limit={byteLimit ? formatFileSize(byteLimit) : null}
            percent={storagePercent}
            note={
              byteLimit
                ? `${(s ? s.fileCount : d.files).toLocaleString('en-GB')} files · ${d.limits.fileBytes.atLimitBehaviour ?? ''}`.trim()
                : s
                  ? `${s.fileCount.toLocaleString('en-GB')} files. No storage quota is configured.`
                  : t('settings.usage.filesInstrumentExports')
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-2">
          <Section
            title={t('settings.usage.seatsRole')}
            action={
              <Link to="/settings/members" className="text-label">
                {t('settings.usage.membersRoles')}
              </Link>
            }
          >
            {seatsByRole.length ? (
              <BreakdownTable
                head={['Role', 'People']}
                rows={seatsByRole.map(([roleKey, n]) => [
                  roleKey === 'client'
                    ? 'Client viewer'
                    : WORKSPACE_ROLE_LABELS[
                        roleKey as keyof typeof WORKSPACE_ROLE_LABELS
                      ],
                  String(n),
                ])}
              />
            ) : (
              <Muted>{t('settings.usage.membersBreakDown')}</Muted>
            )}
          </Section>

          <Section title={t('settings.usage.storageKind')}>
            {storageRows.length ? (
              <>
                {/*
                 * R5-CONFIG-01: the design's four kinds (datasets, retained
                 * snapshots, files and instrument exports, evidence packages)
                 * are not all real here. Bytes are measured per file, and
                 * dataset versions are counted, not weighed — so this table
                 * keeps the honest kinds and does not invent evidence-package
                 * bytes.
                 */}
                <BreakdownTable
                  head={['Kind', 'Size']}
                  rows={storageRows.map(([kind, size]) => [kind, size])}
                />
                <Muted>{t('settings.usage.snapshotsCitedRecords2')}</Muted>
              </>
            ) : (
              <Muted>{t('settings.usage.nothingStoredYet')}</Muted>
            )}
          </Section>

          <Section
            title={t('settings.usage.runActivity')}
            action={
              <Link to="/pipelines" className="text-label">
                {t('settings.usage.pipelines')}
              </Link>
            }
          >
            <BreakdownTable
              head={['What', 'Runs']}
              rows={[
                ['Pipeline runs', String(d.pipelineRuns)],
                ['Connector runs', String(d.connectorRuns)],
                ['Pipelines', `${d.pipelineDefinitions} definitions`],
              ]}
            />
            <RunTrend trend={d.trend} />
          </Section>
        </div>

        {d.capacityWarnings.length ? (
          <Section title={t('settings.usage.capacityWarnings')}>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {d.capacityWarnings.map((w) => (
                <li
                  key={w.category + w.message}
                  className="flex items-start gap-2 rounded-md border border-border p-3 text-label"
                >
                  <Status tone={w.level === 'warning' ? 'warn' : 'none'}>
                    {w.level === 'warning' ? 'Warning' : 'Info'}
                  </Status>
                  <span>{w.message}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </SettingsBody>
    </>
  )
}

function MeterCard({
  label,
  value,
  limit,
  percent,
  note,
}: {
  label: string
  value: string
  /** Display form of a configured limit, or null when none is configured. */
  limit: string | null
  /** Usage percent against the configured limit, or null when unmeasured. */
  percent: number | null
  note: string
}) {
  const level =
    percent == null
      ? null
      : percent >= 90
        ? 'danger'
        : percent >= 80
          ? 'warning'
          : 'ok'
  return (
    <section
      className="flex flex-col gap-2 rounded-md border border-border p-3.5"
      aria-label={label}
    >
      <h2 className="text-label font-medium text-fg-muted">{label}</h2>
      <div className="flex flex-col">
        <span className="num whitespace-nowrap font-heading text-[22px] font-semibold leading-7">
          {value}
        </span>
        {limit ? (
          <span className="num text-label text-fg-muted">of {limit}</span>
        ) : null}
      </div>
      {percent != null ? (
        <div className="flex flex-col gap-1">
          <Progress
            label={t('settings.usage.used', { label })}
            value={percent}
            tone={
              level === 'danger'
                ? 'danger'
                : level === 'warning'
                  ? 'warning'
                  : 'accent'
            }
          />
          {level === 'danger' || level === 'warning' ? (
            <span
              className={cn(
                'num text-label',
                level === 'danger' ? 'text-danger-text' : 'text-warning-text',
              )}
            >
              ⚠ {Math.round(percent)}%
            </span>
          ) : null}
        </div>
      ) : null}
      <Muted>{note}</Muted>
    </section>
  )
}

function monthLabel(month: string): string {
  const [year, m] = month.split('-')
  const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1))
  return date.toLocaleDateString('en-GB', { month: 'short' })
}

/**
 * R5-CONFIG-01 — six-month run-count trend, the only usage series this
 * deployment can measure. The full series is in the SVG's aria-label; no
 * series is drawn for a quantity without real monthly records.
 */
function RunTrend({ trend }: { trend: UsageTrendPoint[] }) {
  if (!trend.length) return null
  const totals = trend.map((p) => p.pipelineRuns + p.connectorRuns)
  const max = Math.max(1, ...totals)
  const width = 240
  const height = 40
  const pad = 3
  const step = totals.length > 1 ? (width - pad * 2) / (totals.length - 1) : 0
  const points = totals
    .map((value, i) => {
      const x = pad + i * step
      const y = height - pad - (value / max) * (height - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const series = trend
    .map(
      (p, i) =>
        `${monthLabel(p.month)} ${p.month.slice(0, 4)}: ${totals[i]} runs`,
    )
    .join('; ')
  const latest = totals[totals.length - 1] ?? 0
  return (
    <div className="mt-2 flex flex-col gap-1">
      <svg
        role="img"
        aria-label={t('settings.usage.runsPerMonthAria', { series })}
        viewBox={`0 0 ${width} ${height}`}
        className="h-10 w-full"
        preserveAspectRatio="none"
      >
        <polyline
          points={points}
          fill="none"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          className="stroke-chart-1"
        />
      </svg>
      <span className="text-label text-fg-muted">
        {t('settings.usage.last6Months')}
        {monthLabel(trend[trend.length - 1].month)}{' '}
        {latest.toLocaleString('en-GB')} {latest === 1 ? 'run' : 'runs'}
      </span>
    </div>
  )
}

function BreakdownTable({
  head,
  rows,
}: {
  head: string[]
  rows: React.ReactNode[][]
}) {
  const gridRows = rows.map((cells, index) => ({ id: String(index), cells }))
  const columns: RegistryColumn<(typeof gridRows)[number]>[] = head.map(
    (heading, index) => ({
      id: `column-${index}`,
      header: heading,
      meta: {
        ...(index > 0 ? rightAligned<(typeof gridRows)[number]>().meta : {}),
        ...(index === 0
          ? {
              headerClassName: `pl-3!${index === head.length - 1 ? ' pr-3!' : ''}`,
              cellClassName:
                'pl-3! min-w-[150px] whitespace-normal py-1.5! leading-[17px]',
            }
          : {}),
        ...(index === head.length - 1 && index > 0
          ? { headerClassName: 'pr-3! text-right', cellClassName: 'pr-3!' }
          : {}),
      },
      cell: ({ row }) => row.original.cells[index] ?? null,
    }),
  )
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <RegistryGrid
        label={head.join(' · ')}
        rows={gridRows}
        columns={columns}
        getRowId={(row) => row.id}
        selectable={false}
      />
    </div>
  )
}

function formatPeriod(): string {
  const now = appNow()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${fmt(first)} – ${fmt(now)} ${now.getFullYear()}`
}
