import { Link } from '@tanstack/react-router'

import { Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { sampleStatus } from '#/components/samples/samples-data'
import { groupDerivedSamples } from '#/lib/samples'
import type { DerivedDisplayEntry, DerivedSample } from '#/lib/samples'
import { t } from '#/copy'

/** The lineage-derived samples, indented as the tree they came from. */
export function DerivedSamplesSection({
  derived,
  sampleId,
}: {
  derived: DerivedSample[] | undefined
  sampleId: string
}) {
  const columns: RegistryColumn<DerivedDisplayEntry>[] = [
    {
      id: 'identifier',
      header: t('library.samples.summary.id'),
      cell: ({ row }) => (
        // The tree indent the bespoke row carried as an inline cell padding.
        <span
          className="mono"
          style={row.original.depth > 0 ? { marginLeft: 2 } : undefined}
        >
          {row.original.depth > 0 ? '↳ ' : ''}
          {row.original.recordId ? (
            <Link
              to="/samples/$sampleId"
              params={{ sampleId: row.original.recordId }}
              className="text-link"
            >
              {row.original.identifier}
            </Link>
          ) : (
            row.original.identifier
          )}
        </span>
      ),
    },
    {
      id: 'name',
      header: t('library.samples.summary.name'),
      cell: ({ row }) => row.original.title,
    },
    {
      id: 'relation',
      header: t('library.samples.summary.relation'),
      cell: ({ row }) => row.original.relation ?? '—',
    },
    {
      id: 'status',
      header: t('library.samples.summary.status'),
      cell: ({ row }) => {
        const status = row.original.status
          ? sampleStatus(row.original.status)
          : null

        return status ? <Status tone={status.tone}>{status.label}</Status> : '—'
      },
    },
  ]

  return (
    <Section
      title={t('library.samples.summary.derivedSamples')}
      count={derived?.length ?? 0}
      action={
        <Link
          to="/samples/$sampleId/lineage"
          params={{ sampleId }}
          className="text-caption text-link"
        >
          {t('library.samples.summary.showAsTree')}
        </Link>
      }
    >
      {derived?.length ? (
        <TableBox>
          <RegistryGrid
            label={t('library.samples.summary.derivedSamples')}
            rows={groupDerivedSamples(derived)}
            columns={columns}
            getRowId={(entry) => entry.linkIds.join(',')}
            selectable={false}
          />
        </TableBox>
      ) : (
        <p className="m-0 text-caption text-fg-muted">
          {t('library.samples.summary.noDerivedSamplesRecorded')}
        </p>
      )}
    </Section>
  )
}
