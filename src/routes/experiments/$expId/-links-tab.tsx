import { Link } from '@tanstack/react-router'

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
import { recordDestination } from '#/lib/navigation'
import { useExperimentLinks } from '../$expId'

/** UI port: shared linked-records tab (Samples, Datasets, Files). */
export function LinkTab({
  expId,
  kind,
  emptyTitle,
  emptyBody,
}: {
  expId: string
  kind: 'sample' | 'dataset' | 'file'
  emptyTitle: string
  emptyBody: string
}) {
  const links = useExperimentLinks(expId)
  const rows = (links.data ?? []).filter((l) => l.target_kind === kind)
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <Section
        title={
          kind === 'sample'
            ? 'Samples'
            : kind === 'dataset'
              ? 'Datasets'
              : 'Files'
        }
        count={rows.length}
      >
        {rows.length ? (
          <TableBox>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Record</TableHead>
                  <TableHead>Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      {l.target_record_id ? (
                        <Link
                          to={recordDestination(
                            l.target_kind,
                            l.target_record_id,
                          )}
                        >
                          <span className="mono">{l.target_identifier}</span>
                        </Link>
                      ) : (
                        <span className="mono">{l.target_identifier}</span>
                      )}
                    </TableCell>
                    <TableCell>{l.link_type}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState className="py-2" title={emptyTitle} body={emptyBody} />
        )}
      </Section>
    </div>
  )
}
