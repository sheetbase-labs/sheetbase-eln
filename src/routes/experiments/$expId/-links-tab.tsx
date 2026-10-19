import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Section } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { TableBox } from '#/components/v3/ui/table'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { objectPath } from '#/lib/navigation'
import { ObjectLink } from '#/components/v3/ui/object-link'
import type { RecordLinkWire } from '../$expId'
import { useExperimentLinks } from '../$expId'

const LINK_SECTIONS: { kind: string; title: string }[] = [
  { kind: 'sample', title: 'Samples' },
  { kind: 'dataset', title: 'Datasets' },
  { kind: 'file', title: 'Files' },
]

/** A link's `target_kind` is a record kind or an object family; records that
 * have no page of their own kind open as records. */
function linkObjectKind(targetKind: string): string {
  return objectPath(targetKind, 'x') ? targetKind : 'record'
}

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
      cell: ({ row }) => (
        <ObjectLink
          kind={linkObjectKind(row.original.target_kind)}
          id={row.original.target_record_id}
          identifier={row.original.target_identifier}
        />
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
              <span className="flex items-center gap-2">
                <Button
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link
                      to="/analysis/new"
                      search={{
                        mode: 'chart',
                        experiment: expId,
                        returnTo: `/experiments/${expId}/links`,
                      }}
                    />
                  }
                >
                  Analyse
                </Button>
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link to="/import" search={{ experiment: expId }} />}
                >
                  Import data
                </Button>
              </span>
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
