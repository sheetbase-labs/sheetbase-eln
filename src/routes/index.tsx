import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Icon } from '#/components/v3/icons'
import {
  Inspector,
  InspectorSection,
  PageHeader,
  Section,
} from '#/components/v3/ui/layout'
import { Dot, Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { experimentStatus } from '#/components/v3/experiments/experiments-data'
import type { ExperimentListRow } from '#/components/v3/experiments/experiments-data'
import { fetchCalendarBookings } from '#/lib/calendar'
import type { CalendarBookingWire } from '#/lib/calendar'
import { notebookDataClient } from '#/lib/notebook-data'
import { useWorkItems } from '#/lib/work-items/data'
import type { WorkItem } from '#/lib/work-items/data'
import { describeAuditEvent, fetchAuditEvents } from '#/lib/audit-history'

/** UI port (roadmap-4/ui-app3): Home, matching the reference — a status chip
 * row, Awaiting your review, Continue working, and an inspector with Today,
 * Needs attention and Recent activity — all on real data. */
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: Home,
})

interface ActiveFlag {
  id: string
  dataset_id: string
  kind: string
  reason: string
}

interface RecentRecordWire {
  id: string
  identifier: string
  title: string
  status: string
  updated_at: string
}

function todayRange(): { start: string; end: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

function toRecentRow(row: RecentRecordWire): ExperimentListRow {
  return {
    uuid: row.id,
    id: row.identifier,
    title: row.title,
    projectId: null,
    project: '—',
    ownerId: '',
    owner: '—',
    status: experimentStatus(row.status),
    protocol: '—',
    protocolRecordId: null,
    started: '',
    updated: row.updated_at.slice(0, 10),
    recent: true,
  }
}

function Home() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id
  const workItemsQuery = useWorkItems()
  const workItems = workItemsQuery.data ?? []

  const range = useMemo(() => todayRange(), [])
  const bookingsQuery = useQuery({
    queryKey: ['home-bookings', workspaceId, range.start],
    queryFn: () =>
      fetchCalendarBookings(
        notebookDataClient,
        workspaceId!,
        range.start,
        range.end,
      ),
    enabled: Boolean(workspaceId),
  })

  const flagsQuery = useQuery({
    queryKey: ['home-dataset-flags'],
    queryFn: () =>
      notebookDataClient.list<ActiveFlag>(
        'dataset_value_flags',
        '?cleared_at=is.null&select=id,dataset_id,kind,reason&order=set_at.desc&limit=5',
      ),
  })

  const recentsQuery = useQuery({
    queryKey: ['home-recent-records', workspaceId],
    queryFn: () =>
      notebookDataClient.list<RecentRecordWire>(
        'records',
        '?kind=eq.experiment&deleted_at=is.null&archived_at=is.null&order=updated_at.desc&limit=6&select=id,identifier,title,status,updated_at',
      ),
    enabled: Boolean(workspaceId),
  })

  const activityQuery = useQuery({
    queryKey: ['home-activity', workspaceId],
    queryFn: () => fetchAuditEvents(notebookDataClient, { limit: 6 }),
    enabled: Boolean(workspaceId),
  })

  const inProgressQuery = useQuery({
    queryKey: ['home-in-progress', workspaceId],
    queryFn: () =>
      notebookDataClient.list<{ id: string }>(
        'records',
        '?kind=eq.experiment&status=eq.in_progress&deleted_at=is.null&select=id&limit=1000',
      ),
    enabled: Boolean(workspaceId),
  })

  const reviews = workItems.filter(
    (i: WorkItem) => i.kind === 'review_requested',
  )
  const flags = flagsQuery.data ?? []
  const bookings = (bookingsQuery.data ?? []).filter(
    (b: CalendarBookingWire) => !b.cancelled_at,
  )
  const recents = (recentsQuery.data ?? []).map(toRecentRow)
  const activity = (activityQuery.data?.events ?? []).map(describeAuditEvent)
  const inProgress = inProgressQuery.data?.length ?? 0

  const chips = [
    {
      n: reviews.length,
      label: reviews.length === 1 ? 'to review' : 'to review',
      tone: 'review' as Tone,
      to: '/inbox' as const,
    },
    {
      n: flags.length,
      label:
        flags.length === 1 ? 'dataset with errors' : 'datasets with errors',
      tone: 'bad' as Tone,
      to: '/datasets' as const,
    },
    {
      n: inProgress,
      label: 'experiments in progress',
      tone: 'progress' as Tone,
      to: '/experiments' as const,
    },
    {
      n: bookings.length,
      label: 'bookings today',
      tone: 'none' as Tone,
      to: '/schedule' as const,
    },
  ]

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const openNotebookId = recents.at(0)?.uuid

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <PageHeader
          className="border-b-0 bg-transparent"
          title="Home"
          meta={
            <span>
              {today} · {context.workspace?.name ?? 'Workspace'}
            </span>
          }
          actions={
            <>
              {openNotebookId ? (
                <Button
                  className="max-md:hidden"
                  nativeButton={false}
                  render={
                    <Link
                      to="/records/$recordId/notebook"
                      params={{ recordId: openNotebookId }}
                    />
                  }
                >
                  Open notebook
                </Button>
              ) : null}
              <Button
                variant="primary"
                className="max-md:hidden"
                nativeButton={false}
                render={<Link to="/experiments/new" />}
              >
                New experiment
              </Button>
            </>
          }
        />
        <div className="flex flex-col gap-7 px-4 pb-8 pt-2 md:px-6">
          <nav
            aria-label="Summary"
            className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-border-subtle py-2.5"
          >
            {chips.map((c) => (
              <Link
                key={c.label}
                to={c.to}
                className="inline-flex items-center gap-2 text-body text-fg no-underline hover:underline"
              >
                <Dot tone={c.tone} />
                <span>
                  <b className="num font-semibold">{c.n}</b> {c.label}
                </span>
              </Link>
            ))}
            <span className="flex-1" />
            <Link to="/inbox" className="text-label">
              Open inbox · {workItems.length} items
            </Link>
          </nav>

          <Section
            title="Awaiting your review"
            count={reviews.length}
            action={
              <Link to="/inbox" className="text-label">
                All in inbox
              </Link>
            }
          >
            {reviews.length ? (
              <TableBox>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Record</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reviews.map((r) => (
                      <TableRow key={r.recordId ?? r.identifier ?? r.title}>
                        <TableCell className="mono">
                          {r.identifier ?? '—'}
                        </TableCell>
                        <TableCell className="font-medium">{r.title}</TableCell>
                        <TableCell className="text-fg-muted">
                          {r.dueAt ? r.dueAt.slice(0, 10) : '—'}
                        </TableCell>
                        <TableCell align="right">
                          {r.recordId ? (
                            <Button
                              size="sm"
                              nativeButton={false}
                              render={
                                <Link
                                  to="/records/$recordId"
                                  params={{ recordId: r.recordId }}
                                />
                              }
                            >
                              Review
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableBox>
            ) : (
              <EmptyState
                className="py-2"
                title="Nothing awaiting your review"
                body="Submitted records assigned to you appear here."
              />
            )}
          </Section>

          <Section
            title="Continue working"
            action={
              <Link to="/experiments" className="text-label">
                All recent
              </Link>
            }
          >
            {recents.length ? (
              <TableBox>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead align="right">Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recents.map((r) => (
                      <TableRow key={r.uuid}>
                        <TableCell>
                          <span className="mono text-fg-muted">{r.id}</span>{' '}
                          <Link
                            to="/experiments/$expId"
                            params={{ expId: r.uuid }}
                            className="text-fg hover:text-link"
                          >
                            {r.title}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Status tone={r.status.tone}>{r.status.label}</Status>
                        </TableCell>
                        <TableCell align="right" className="num text-fg-muted">
                          {r.updated}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableBox>
            ) : (
              <EmptyState
                className="py-2"
                title="Nothing worked on recently"
                body="Records you edit appear here."
              />
            )}
          </Section>
        </div>
      </div>

      <Inspector label="Today">
        <InspectorSection
          title={
            <span className="flex items-baseline">
              <span className="flex-1">Today</span>
              <Link to="/schedule" className="font-normal">
                Full schedule
              </Link>
            </span>
          }
        >
          {bookings.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {bookings.map((b) => (
                <li
                  key={b.id}
                  className="flex gap-3 border-b border-border-subtle py-2 last:border-0"
                >
                  <span className="num w-10 shrink-0 font-medium text-link">
                    {new Date(b.starts_at).toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium">{b.title}</div>
                    {b.location ? (
                      <div className="text-label text-fg-muted">
                        {b.location}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-label text-fg-muted">
              Nothing scheduled today.
            </p>
          )}
        </InspectorSection>

        <InspectorSection
          title={
            <span className="flex items-baseline">
              <span className="flex-1">Needs attention</span>
              <Link to="/inbox" className="font-normal">
                Inbox
              </Link>
            </span>
          }
        >
          {flags.length ? (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {flags.map((f) => (
                <li key={f.id} className="flex gap-2">
                  <span className="mt-0.5 text-danger">
                    <Icon name="warn" size={14} />
                  </span>
                  <div className="min-w-0">
                    <Link
                      to="/datasets"
                      search={{ dataset: f.dataset_id, archived: false }}
                    >
                      {f.kind.replace(/_/g, ' ')}
                    </Link>
                    <div className="text-label text-fg-muted">{f.reason}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-label text-fg-muted">
              No dataset issues right now.
            </p>
          )}
        </InspectorSection>

        <InspectorSection title="Recent activity">
          {activity.length ? (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {activity.map((a) => (
                <li key={a.event.id} className="flex gap-3">
                  <span className="num w-10 shrink-0 text-label text-fg-muted">
                    {new Date(a.event.createdAt).toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <div className="min-w-0 text-label">
                    <div>
                      <b className="font-medium">
                        {a.event.actorName ?? 'System'}
                      </b>{' '}
                      {a.action} {a.subject}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-label text-fg-muted">
              No activity recorded yet.
            </p>
          )}
        </InspectorSection>
      </Inspector>
    </div>
  )
}
