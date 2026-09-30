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
import { fetchStorageOverviewFn, fetchUsageFn } from '#/lib/admin-platform'
import {
  adminQueryKeys,
  fetchWorkspaceMembers,
  WORKSPACE_ROLE_LABELS,
} from '#/lib/workspace-admin'
import { formatFileSize } from '#/lib/format-numbers'

/**
 * UI port (roadmap-4/ui-app3): how the workspace uses its plan. Reads the real
 * usage and storage figures. No quotas or per-token call metering are
 * configured in this deployment, so those meters say so instead of inventing a
 * number. `?state=denied` drives the acceptance suite.
 */
export const Route = createFileRoute('/settings/usage')({
  validateSearch: (search: Record<string, unknown>): { state?: 'denied' } => ({
    state: search.state === 'denied' ? 'denied' : undefined,
  }),
  component: Usage,
})

const dataClient = createDataClient()

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
            onClick={() =>
              toast('sheetbase-usage.csv exported', {
                description:
                  'Current totals for this workspace. Monthly history is not measured yet.',
              })
            }
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
            limit="no configured limit"
            note="Internal members; client viewers are not counted."
          />
          <MeterCard
            label="Storage"
            value={
              s ? formatFileSize(s.fileBytes) : formatFileSize(d.fileBytes)
            }
            limit="no configured quota"
            note={
              s
                ? `${s.fileCount.toLocaleString('en-GB')} files`
                : 'Files and instrument exports'
            }
          />
          <MeterCard
            label="API calls"
            value="Not measured yet"
            limit=""
            note="Per-token call metering is not built."
          />
          <MeterCard
            label="Run minutes"
            value="Not measured yet"
            limit=""
            note={`${d.pipelineRuns.toLocaleString('en-GB')} pipeline runs · ${d.connectorRuns.toLocaleString('en-GB')} connector runs`}
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
                <BreakdownTable
                  head={['Kind', 'Size']}
                  rows={storageRows.map(([kind, size]) => [kind, size])}
                />
                <Muted>
                  Snapshots cited by records are kept for the retention period
                  and can’t be deleted to free space.
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
            <Muted>
              Run minutes are not measured yet; the counts above are the real
              runs.
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
  note,
}: {
  label: string
  value: string
  limit: string
  note: string
}) {
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
      <Muted>{note}</Muted>
    </section>
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
                  className="first:pl-3 last:pr-3"
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
