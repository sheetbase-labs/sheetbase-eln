import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Section } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { TableBox } from '#/components/v3/ui/table'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { recordDestination } from '#/lib/navigation'
import type { RecordLinkWire } from '../$expId'
import { useExperimentLinks } from '../$expId'

const LINK_SECTIONS: { kind: string; title: string }[] = [
  { kind: 'sample', title: 'Samples' },
  { kind: 'dataset', title: 'Datasets' },
  { kind: 'file', title: 'Files' },
]

/** Everything linked to the experiment, grouped by what it is: Samples,
 * Datasets, Files, then any other kind. */
export function LinksPanel({ expId }: { expId: string }) {
  const links = useExperimentLinks(expId)
  const all = links.data ?? []
  const named = new Set(LINK_SECTIONS.map((section) => section.kind))
  const sections = [
    ...LINK_SECTIONS.map((section) => ({
      ...section,
      rows: all.filter((l) => l.target_kind === section.kind),
    })),
    {
      kind: 'other',
      title: 'Other records',
      rows: all.filter((l) => !named.has(l.target_kind)),
    },
  ].filter((section) => section.rows.length > 0 || section.kind === 'dataset')
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
      id: 'kind',
      header: 'Kind',
      meta: { cellClassName: 'capitalize text-fg-muted' },
      cell: ({ row }) => row.original.target_kind.replace(/_/g, ' '),
    },
    {
      id: 'link',
      header: 'Link',
      cell: ({ row }) => row.original.link_type,
    },
  ]
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      {sections.map((section) => (
        <Section
          key={section.kind}
          title={section.title}
          count={section.rows.length}
          action={
            section.kind === 'dataset' ? (
              <Button
                size="sm"
                nativeButton={false}
                render={<Link to="/import" search={{ experiment: expId }} />}
              >
                Import data
              </Button>
            ) : undefined
          }
        >
          {section.rows.length ? (
            <TableBox>
              <RegistryGrid
                label={section.title}
                rows={section.rows}
                columns={columns}
                getRowId={(l) => l.id}
                selectable={false}
              />
            </TableBox>
          ) : (
            <EmptyState
              className="py-2"
              title="No datasets linked"
              description="Datasets produced by this experiment appear here when they are linked."
            />
          )}
        </Section>
      ))}
    </div>
  )
}
