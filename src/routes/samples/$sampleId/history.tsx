import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Section } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableBox,
} from '#/components/v3/ui/table'
import {
  formatSampleEventTime,
  formatSampleEventTimestamp,
  sampleEventAction,
  sampleEventChange,
  sampleEventDetail,
} from '#/components/v3/samples/sample-history'
import { fetchSampleEvents } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'

/**
 * LAB-03 / step 4 — the sample History tab. It renders the canonical,
 * append-only `api.sample_events` chain of custody (who, when, action, detail
 * and the quantity/location change) and nothing else. The recent-history
 * inspector summary lives in the sample frame.
 */
export const Route = createFileRoute('/samples/$sampleId/history')({
  component: SampleHistory,
})

function SampleHistory() {
  const { sampleId } = Route.useParams()
  const events = useQuery({
    queryKey: ['ui-port', 'sample-events', sampleId],
    queryFn: () => fetchSampleEvents(notebookDataClient, sampleId),
  })
  const rows = events.data ?? []
  const names = useUserNames(
    rows.map((e) => e.actorUserId ?? '').filter(Boolean),
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <Section title="History" count={rows.length}>
        {rows.length ? (
          <>
            <TableBox>
              <Table aria-label="Sample history">
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead>Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((e) => {
                    const detail = sampleEventDetail(e)
                    const change = sampleEventChange(e)
                    return (
                      <TableRow key={e.id}>
                        <TableCell
                          className="text-fg-muted"
                          title={formatSampleEventTimestamp(e.createdAt)}
                        >
                          {formatSampleEventTime(e.createdAt)}
                        </TableCell>
                        <TableCell>
                          {e.actorUserId
                            ? names.userLabel(e.actorUserId)
                            : 'System'}
                        </TableCell>
                        <TableCell className="font-medium">
                          {sampleEventAction(e.operation)}
                        </TableCell>
                        <TableCell className="max-w-[22rem] whitespace-normal leading-[17px]">
                          {detail ?? '—'}
                        </TableCell>
                        <TableCell className="num text-fg-muted">
                          {change ?? '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableBox>
            <p className="m-0 text-label text-fg-muted">
              History is written by the system and can’t be edited or deleted.
            </p>
          </>
        ) : (
          <EmptyState
            className="py-2"
            icon="clock"
            title="No history yet"
            body="Receipts, withdrawals and moves appear here."
          />
        )}
      </Section>
    </div>
  )
}
