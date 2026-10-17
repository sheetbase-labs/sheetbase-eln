import { Link } from '@tanstack/react-router'

import { Section } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { TableBox } from '#/components/v3/ui/table'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { recordDestination } from '#/lib/navigation'
import type { RecordLinkWire } from '../$expId'
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
  const title =
    kind === 'sample' ? 'Samples' : kind === 'dataset' ? 'Datasets' : 'Files'
  const columns: RegistryColumn<RecordLinkWire>[] = [
    {
      id: 'record',
      header: 'Record',
      cell: ({ row }) =>
        row.original.target_record_id ? (
          <Link
            to={recordDestination(
              row.original.target_kind,
              row.original.target_record_id,
            )}
          >
            <span className="mono">{row.original.target_identifier}</span>
          </Link>
        ) : (
          <span className="mono">{row.original.target_identifier}</span>
        ),
    },
    {
      id: 'link',
      header: 'Link',
      cell: ({ row }) => row.original.link_type,
    },
  ]
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <Section title={title} count={rows.length}>
        {rows.length ? (
          <TableBox>
            <RegistryGrid
              label={title}
              rows={rows}
              columns={columns}
              getRowId={(l) => l.id}
              selectable={false}
            />
          </TableBox>
        ) : (
          <EmptyState
            className="py-2"
            title={emptyTitle}
            description={emptyBody}
          />
        )}
      </Section>
    </div>
  )
}
