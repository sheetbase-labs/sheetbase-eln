import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Section } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { TableBox } from '#/components/v3/ui/table'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { RecordPickerDialog } from '#/components/v3/record-picker/record-picker'
import { toast } from '#/components/v3/ui/sonner'
import { fetchExperimentBookings } from '#/lib/calendar'
import { linkExperimentToSample } from '#/lib/notebook-create'
import type { CalendarBookingWire } from '#/lib/calendar'
import { notebookDataClient } from '#/lib/notebook-data'
import { objectPath } from '#/lib/navigation'
import { ObjectLink } from '#/components/v3/ui/object-link'
import type { RecordLinkWire } from '../$expId'
import { experimentQueryKeys, useExperimentLinks } from '../$expId'

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

/** The instrument bookings made for this experiment, and the way to make one
 * that comes back here. A booking is not a record, so it is read from the
 * booking itself rather than from `record_links`. */
export function ExperimentBookings({ expId }: { expId: string }) {
  const bookings = useQuery({
    queryKey: ['ui-port', 'experiment-bookings', expId],
    queryFn: () => fetchExperimentBookings(notebookDataClient, expId),
  })
  const rows = bookings.data ?? []
  const columns: RegistryColumn<CalendarBookingWire>[] = [
    {
      id: 'booking',
      header: 'Booking',
      cell: ({ row }) => row.original.title,
    },
    {
      id: 'when',
      header: 'When',
      meta: { cellClassName: 'num text-fg-muted' },
      cell: ({ row }) => row.original.starts_at.slice(0, 16).replace('T', ' '),
    },
    {
      id: 'status',
      header: 'Status',
      meta: { cellClassName: 'capitalize text-fg-muted' },
      cell: ({ row }) => row.original.status,
    },
  ]
  return (
    <Section
      title="Bookings"
      count={rows.length}
      action={
        <Button
          size="sm"
          nativeButton={false}
          render={
            <Link
              to="/schedule"
              search={{
                experiment: expId,
                returnTo: `/experiments/${expId}/links`,
              }}
            />
          }
        >
          Book an instrument
        </Button>
      }
    >
      {bookings.isError ? (
        <EmptyState
          className="py-2"
          title="Bookings could not be read"
          description="Reload the page to try again. If it keeps failing, ask a workspace admin."
        />
      ) : rows.length ? (
        <TableBox>
          <RegistryGrid
            label="Bookings"
            rows={rows}
            columns={columns}
            getRowId={(b) => b.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <EmptyState
          className="py-2"
          title="No instrument booked"
          description="Instruments booked for this experiment appear here."
        />
      )}
    </Section>
  )
}

/** "Link a sample": pick samples and write one link each. The experiment's
 * Samples list refreshes in place, so the tab that shows the links is also
 * the tab that makes them. */
function LinkSamplesAction({ expId }: { expId: string }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const link = useMutation({
    mutationFn: async (
      items: { id: string; identifier: string }[],
    ): Promise<number> => {
      for (const item of items) {
        await linkExperimentToSample(notebookDataClient, expId, {
          identifier: item.identifier,
          recordId: item.id,
        })
      }
      return items.length
    },
    onSuccess: (count) => {
      void queryClient.invalidateQueries({
        queryKey: experimentQueryKeys.links(expId),
      })
      toast(count === 1 ? 'Sample linked' : `${count} samples linked`)
    },
    onError: (error: unknown) =>
      toast('Could not link the sample', {
        description:
          error instanceof Error ? error.message : 'The link was refused.',
      }),
  })
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Link a sample
      </Button>
      {open ? (
        <RecordPickerDialog
          open={open}
          onOpenChange={setOpen}
          title="Link samples"
          allowed={['Sample']}
          multiple
          confirmLabel={(n) => `Link ${n}`}
          onPick={(items) => link.mutate(items)}
        />
      ) : null}
    </>
  )
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
  ].filter(
    (section) =>
      section.rows.length > 0 ||
      section.kind === 'dataset' ||
      section.kind === 'sample',
  )
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
            section.kind === 'sample' ? (
              <LinkSamplesAction expId={expId} />
            ) : section.kind === 'dataset' ? (
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
              title={
                section.kind === 'sample'
                  ? 'No samples linked'
                  : 'No datasets linked'
              }
              description={
                section.kind === 'sample'
                  ? 'Samples used in this experiment appear here when they are linked or withdrawn for it.'
                  : 'Datasets produced by this experiment appear here when they are linked.'
              }
            />
          )}
        </Section>
      ))}
      <ExperimentBookings expId={expId} />
    </div>
  )
}
