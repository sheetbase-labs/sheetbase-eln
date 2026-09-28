import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Icon } from '#/components/v3/icons'
import { Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
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
import { fetchCalendarBookings } from '#/lib/calendar'
import type { CalendarBookingWire } from '#/lib/calendar'
import { notebookDataClient } from '#/lib/notebook-data'
import { useWorkItems } from '#/lib/work-items/data'
import type { WorkItem } from '#/lib/work-items/data'

/** UI port (roadmap-4/ui-app3): Home, wired to the real work items, today's
 * bookings and active dataset flags. */
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

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name
}

function todayRange(): { start: string; end: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

function bookingTone(status: string): Tone {
  if (status === 'cancelled') return 'draft'
  if (status === 'tentative') return 'none'
  return 'progress'
}

function Home() {
  const { context } = Route.useRouteContext()
  const workspaceId = context?.workspace?.id
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

  const reviews = workItems.filter(
    (i: WorkItem) => i.kind === 'review_requested',
  )
  const flags = flagsQuery.data ?? []
  const bookings = (bookingsQuery.data ?? []).filter(
    (b: CalendarBookingWire) => !b.cancelled_at,
  )
  const name = context?.user.name ?? 'there'
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-7 px-4 py-5 md:px-8 md:py-6">
        <div>
          <h1 className="text-title">Good morning, {firstName(name)}</h1>
          <p className="m-0 mt-1 text-label text-fg-muted">
            {today} · {reviews.length}{' '}
            {reviews.length === 1 ? 'review' : 'reviews'} waiting ·{' '}
            {flags.length} data {flags.length === 1 ? 'issue' : 'issues'}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Section
            title="Today"
            action={
              <Link to="/schedule" className="text-label">
                Full schedule
              </Link>
            }
          >
            {bookings.length ? (
              <ul className="m-0 flex list-none flex-col p-0">
                {bookings.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center gap-3 border-b border-border-subtle py-2"
                  >
                    <span className="num w-11 font-medium">
                      {new Date(b.starts_at).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{b.title}</div>
                      {b.location ? (
                        <div className="text-label text-fg-muted">
                          {b.location}
                        </div>
                      ) : null}
                    </div>
                    <Status tone={bookingTone(b.status)}>
                      {b.status === 'cancelled' ? 'Cancelled' : 'Next'}
                    </Status>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-label text-fg-muted">
                Nothing scheduled today.
              </p>
            )}
          </Section>

          <Section title="Needs attention">
            {flags.length ? (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {flags.map((f) => (
                  <li key={f.id} className="flex gap-2">
                    <span className="mt-px text-danger">
                      <Icon name="warn" size={14} />
                    </span>
                    <div>
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
          </Section>
        </div>

        <Section title="Awaiting your review" count={reviews.length}>
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
                            Open
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
              icon="check"
              title="Nothing awaiting your review"
              body="Submitted records assigned to you appear here."
            />
          )}
        </Section>
      </div>
    </div>
  )
}
