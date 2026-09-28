import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Section } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { notebookDataClient } from '#/lib/notebook-data'
import { experimentQueryKeys } from '../$expId'

interface RevisionWire {
  id: string
  reason: string
  created_at: string
  integrity_digest: string | null
}

/** UI port: the experiment History tab (submitted revisions). */
export const Route = createFileRoute('/experiments/$expId/history')({
  component: History,
})

function History() {
  const { expId } = Route.useParams()
  const revisions = useQuery({
    queryKey: experimentQueryKeys.revisions(expId),
    queryFn: () =>
      notebookDataClient.list<RevisionWire>(
        'revisions',
        `?record_id=eq.${expId}&select=id,reason,created_at,integrity_digest&order=created_at.desc&limit=50`,
      ),
  })
  const rows = revisions.data ?? []
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <Section title="History" count={rows.length}>
        {rows.length ? (
          <TableBox>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Integrity digest</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-fg-muted">
                      {r.created_at.slice(0, 16).replace('T', ' ')}
                    </TableCell>
                    <TableCell className="font-medium">{r.reason}</TableCell>
                    <TableCell className="mono text-[11px] text-fg-muted">
                      {r.integrity_digest
                        ? `${r.integrity_digest.slice(0, 12)}…`
                        : '—'}
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
            body="Submitted revisions appear here with their integrity digest."
          />
        )}
      </Section>
    </div>
  )
}
