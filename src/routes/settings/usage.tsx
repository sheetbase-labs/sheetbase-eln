import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted, Section } from '#/components/v3/ui/layout'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { Status } from '#/components/v3/ui/status'
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
  const role = context.workspace?.role
  const admin = role === 'owner' || role === 'admin'

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
        <SettingsHeader title="Usage" />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title="Only workspace admins can see usage"
            body="Usage shows seats, storage and activity for the whole workspace. Ask a workspace admin for the numbers you need."
          />
        </div>
      </>
    )
  }

  if (usage.isPending) {
    return (
      <>
        <SettingsHeader title="Usage" />
        <div
          className="flex flex-col gap-3 px-6 py-5"
          aria-busy="true"
          aria-label="Loading usage"
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
        <SettingsHeader title="Usage" />
        <SettingsBody>
          <EmptyState
            icon="warn"
            title="Usage could not be loaded"
            body="Check the connection and try again."
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
        title="Usage"
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
                toast('sheetbase-usage.csv exported', {
                  description:
                    'Current totals for this workspace. Run counts have a six-month trend; other history is not measured yet.',
                })
              } catch (error) {
                toast('Could not export usage', {
                  description:
                    error instanceof Error
                      ? error.message
                      : 'The browser blocked the download.',
                })
              }
            }}
          >
            Export CSV
          </Button>
        }
      >
        {formatPeriod()} · current workspace
      </SettingsHeader>
      <SettingsBody>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MeterCard
            label="Seats"
            value={d.members.toLocaleString('en-GB')}
            limit={
              seatLimit ? `${seatLimit.toLocaleString('en-GB')} seats` : null
            }
            percent={seatPercent}
            note={
              seatLimit
                ? 'Everyone with workspace access, including client viewers.'
                : 'Everyone with workspace access, including client viewers. No seat limit is configured.'
            }
          />
          <MeterCard
            label="Storage"
            value={formatFileSize(storageBytes)}
            limit={byteLimit ? formatFileSize(byteLimit) : null}
            percent={storagePercent}
            note={
              byteLimit
                ? `${(s ? s.fileCount : d.files).toLocaleString('en-GB')} files · ${d.limits.fileBytes.atLimitBehaviour ?? ''}`.trim()
                : s
                  ? `${s.fileCount.toLocaleString('en-GB')} files. No storage quota is configured.`
                  : 'Files and instrument exports. No storage quota is configured.'
            }
          />
          <MeterCard
            label="API calls"
            value="Not measured yet"
            limit={null}
            percent={null}
            note="Per-token call metering is not built in this deployment."
          />
          <MeterCard
            label="Run minutes"
            value="Not measured yet"
            limit={null}
            percent={null}
            note={`${d.pipelineRuns.toLocaleString('en-GB')} pipeline runs · ${d.connectorRuns.toLocaleString('en-GB')} connector runs. Run duration is not metered.`}
          />
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-2">
          <Section
            title="Seats by role"
            action={
              <Link to="/settings/members" className="text-label">
                Members and roles
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
              <Muted>No members to break down yet.</Muted>
            )}
          </Section>

          <Section title="Storage by kind">
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
                <Muted>
                  Snapshots cited by records are kept for the retention period
                  and can’t be deleted to free space. Per-kind bytes are not
                  measured; dataset versions are counted, not weighed.
                </Muted>
              </>
            ) : (
              <Muted>Storage is not measured yet.</Muted>
            )}
          </Section>

          <Section
            title="API calls by token"
            action={
              <Link to="/settings/api" className="text-label">
                API and SDK
              </Link>
            }
          >
            <Muted>
              Per-token call metering is not built in this deployment. Manage
              tokens in API and SDK.
            </Muted>
          </Section>

          <Section
            title="Run activity"
            action={
              <Link to="/pipelines" className="text-label">
                Pipelines
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
            <Muted>
              Run minutes are not measured yet; the counts and the six-month
              trend above are the real runs.
            </Muted>
          </Section>
        </div>

        {d.capacityWarnings.length ? (
          <Section title="Capacity warnings">
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
          <div
            role="progressbar"
            aria-label={`${label} used`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            className="h-1.5 overflow-hidden rounded-full bg-skeleton"
          >
            <div
              className={cn(
                'h-1.5',
                level === 'danger'
                  ? 'bg-danger-text'
                  : level === 'warning'
                    ? 'bg-warning-text'
                    : 'bg-chart-1',
              )}
              style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            />
          </div>
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
        aria-label={`Runs per month — ${series}`}
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
        Last 6 months · latest {monthLabel(trend[trend.length - 1].month)}{' '}
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
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((h, i) => (
              <TableHead
                key={h}
                align={i > 0 ? 'right' : undefined}
                className="first:pl-3 last:pr-3"
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, k) => (
            <TableRow key={k}>
              {r.map((c, i) => (
                <TableCell
                  key={i}
                  align={i > 0 ? 'right' : undefined}
                  className={
                    'first:pl-3 last:pr-3' +
                    (i === 0
                      ? ' min-w-[150px] whitespace-normal py-1.5 leading-[17px]'
                      : '')
                  }
                >
                  {c}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function formatPeriod(): string {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${fmt(first)} – ${fmt(now)} ${now.getFullYear()}`
}
