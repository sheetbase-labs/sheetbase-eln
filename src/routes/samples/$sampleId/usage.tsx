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
import { notebookDataClient } from '#/lib/notebook-data'

interface LinkWire {
  id: string
  target_record_id: string | null
  target_kind: string
  target_identifier: string
  link_type: string
  created_at: string
}

/** UI port: the sample Usage tab (records that link to this sample). */
export const Route = createFileRoute('/samples/$sampleId/usage')({
  component: SampleUsage,
})

function SampleUsage() {
  const { sampleId } = Route.useParams()
  const links = useQuery({
    queryKey: ['ui-port', 'sample-usage', sampleId],
    queryFn: () =>
      notebookDataClient.list<LinkWire>(
        'record_links',
        `?source_record_id=eq.${sampleId}&select=id,target_record_id,target_kind,target_identifier,link_type,created_at&order=created_at.desc`,
      ),
  })
  const rows = links.data ?? []
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <Section title="Usage" count={rows.length}>
        {rows.length ? (
          <TableBox>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Record</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="mono">
                      {l.target_identifier}
                    </TableCell>
                    <TableCell>{l.target_kind}</TableCell>
                    <TableCell>{l.link_type}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            className="py-2"
            icon="link"
            title="Not used anywhere yet"
            body="Records that reference this sample appear here."
          />
        )}
      </Section>
    </div>
  )
}
