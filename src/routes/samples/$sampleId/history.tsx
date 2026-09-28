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
import { fetchSampleEvents } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'

/** UI port: the sample History tab (chain-of-custody events). */
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
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <Section title="History" count={rows.length}>
        {rows.length ? (
          <TableBox>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead align="right">Change</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-fg-muted">
                      {e.createdAt.slice(0, 16).replace('T', ' ')}
                    </TableCell>
                    <TableCell className="font-medium">{e.operation}</TableCell>
                    <TableCell align="right" className="num">
                      {e.quantityDelta != null
                        ? `${e.quantityDelta > 0 ? '+' : ''}${e.quantityDelta}${e.quantityUnit ? ` ${e.quantityUnit}` : ''}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {e.fromLocation || e.toLocation
                        ? `${e.fromLocation ?? ''} → ${e.toLocation ?? ''}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {e.notes ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
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
