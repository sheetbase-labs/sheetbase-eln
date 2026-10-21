import { chunkIds } from '#/lib/chunk-ids'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Section } from '#/components/v3/ui/layout'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { toast } from '#/components/v3/ui/sonner'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { UsageBalanceBar } from '#/components/v3/samples/sample-usage'
import {
  formatQuantityAmount,
  useSampleActions,
} from '#/components/v3/samples/withdraw-dialog'
import {
  formatSampleEventDay,
  formatSampleEventTime,
} from '#/components/v3/samples/sample-history'
import {
  cancelSampleReservation,
  describeSampleError,
  fetchSampleEvents,
  fetchSampleQuantityBalances,
  fetchSampleReservations,
  sampleQueryKeys,
} from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import type { RecordWire } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'

import { sampleEventsQueryKey } from '../$sampleId'

/**
 * One row of the merged usage table: a withdrawal event or a live reservation,
 * reduced to the cells the table shows.
 */
interface UsageEntry {
  id: string
  experimentId: string | null
  title: string
  purpose: string
  volume: string
  actor: string
  when: string
  whenTitle?: string
  cancel?: () => void
}

/**
 * LAB-01 step 3 — the sample Usage tab (SampleUsage).
 *
 * Everything here is read from canonical data: the used / reserved / free bar
 * comes from `api.sample_quantity_balances`, the reservations from
 * `api.sample_reservations` and the withdrawal rows from the `consume` rows of
 * `api.sample_events`. The design shows withdrawals and planned reservations in
 * one table, so both are merged here (a reservation is labelled "Planned"),
 * with the Volume bar beneath it. The Withdraw and Reserve buttons open the
 * dialogs the sample frame owns.
 */
export const Route = createFileRoute('/samples/$sampleId/usage')({
  component: SampleUsage,
})

function SampleUsage() {
  const { sampleId } = Route.useParams()
  const queryClient = useQueryClient()
  const actions = useSampleActions()

  const balances = useQuery({
    queryKey: sampleQueryKeys.balances(sampleId),
    queryFn: () => fetchSampleQuantityBalances(notebookDataClient, sampleId),
  })
  const reservations = useQuery({
    queryKey: sampleQueryKeys.reservations(sampleId),
    queryFn: () => fetchSampleReservations(notebookDataClient, sampleId),
  })
  const events = useQuery({
    queryKey: sampleEventsQueryKey(sampleId),
    queryFn: () => fetchSampleEvents(notebookDataClient, sampleId),
  })

  const withdrawalEvents = (events.data ?? []).filter(
    (event) => event.operation === 'consume',
  )
  // QA-121: the list and its count are live usage — consumptions plus the
  // reservations that still hold volume. A cancelled reservation holds none, so
  // it belongs in the record's history, not in this list or its count.
  const reservationRows = (reservations.data ?? []).filter(
    (reservation) => reservation.state !== 'cancelled',
  )
  const rowCount = withdrawalEvents.length + reservationRows.length

  const experimentIds = Array.from(
    new Set(
      [
        ...withdrawalEvents.map((event) => event.purposeRecordId),
        ...reservationRows.map((row) => row.experimentRecordId),
      ].filter((id): id is string => Boolean(id)),
    ),
  )
  const experiments = useQuery({
    queryKey: [
      'ui-port',
      'sample-usage-experiments',
      sampleId,
      experimentIds.join(','),
    ],
    enabled: experimentIds.length > 0,
    queryFn: async () => {
      const rows = (
        await Promise.all(
          chunkIds(experimentIds).map((group) =>
            notebookDataClient.list<RecordWire>(
              'records',
              `?id=in.(${group.join(',')})&select=id,identifier,title`,
            ),
          ),
        )
      ).flat()
      return new Map(rows.map((row) => [row.id, row]))
    },
  })
  const experimentById = experiments.data ?? new Map<string, RecordWire>()

  // The experiments that name this sample, from their side of the link: an
  // experiment that lists the sample as used appears here, whether or not any
  // volume has been withdrawn for it.
  const linkedExperiments = useQuery({
    queryKey: ['ui-port', 'sample-linked-experiments', sampleId],
    queryFn: async () => {
      const links = await notebookDataClient.list<{ source_record_id: string }>(
        'record_links',
        `?target_record_id=eq.${sampleId}&link_type=eq.sample&select=source_record_id&order=created_at.desc`,
      )
      const ids = [...new Set(links.map((l) => l.source_record_id))].slice(
        0,
        12,
      )
      if (!ids.length) return []
      return notebookDataClient.list<{
        id: string
        identifier: string
        title: string
        status: string
        kind: string
      }>(
        'records',
        `?id=in.(${ids.join(',')})&kind=eq.experiment&deleted_at=is.null&select=id,identifier,title,status,kind&order=updated_at.desc`,
      )
    },
  })

  const names = useUserNames(
    [
      ...withdrawalEvents.map((event) => event.actorUserId ?? ''),
      ...reservationRows.map((row) => row.createdByUserId ?? ''),
    ].filter(Boolean),
  )

  const cancel = useMutation({
    mutationFn: (reservationId: string) =>
      cancelSampleReservation(notebookDataClient, { reservationId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: sampleQueryKeys.reservations(sampleId),
      })
      void queryClient.invalidateQueries({
        queryKey: sampleQueryKeys.balances(sampleId),
      })
      toast('Reservation cancelled')
    },
    onError: (error) => toast.error(describeSampleError(error)),
  })

  const unit = balances.data?.unit ? ` ${balances.data.unit}` : ''

  // One row shape for a withdrawal and a reservation: the design shows both in
  // one table, so the grid renders the merged list rather than two bodies.
  const usageRows: UsageEntry[] = [
    ...withdrawalEvents.map((event) => ({
      id: event.id,
      experimentId: event.purposeRecordId,
      title: event.purposeRecordId
        ? (experimentById.get(event.purposeRecordId)?.title ?? '—')
        : '—',
      purpose: event.notes ?? '—',
      volume:
        event.quantityDelta == null
          ? '—'
          : `${formatQuantityAmount(Math.abs(event.quantityDelta))}${unit}`,
      actor: event.actorUserId ? names.userLabel(event.actorUserId) : 'System',
      when: formatSampleEventDay(event.createdAt),
      whenTitle: formatSampleEventTime(event.createdAt),
    })),
    ...reservationRows.map((reservation) => ({
      id: reservation.id,
      experimentId: reservation.experimentRecordId,
      title: experimentById.get(reservation.experimentRecordId)?.title ?? '—',
      purpose:
        reservation.notes ??
        (reservation.planned ? 'Planned use' : 'In progress'),
      volume: `${formatQuantityAmount(reservation.quantity)}${unit}`,
      actor: reservation.createdByUserId
        ? names.userLabel(reservation.createdByUserId)
        : '—',
      when:
        reservation.state === 'active' && reservation.planned
          ? 'Planned'
          : formatSampleEventDay(reservation.createdAt),
      cancel:
        reservation.state === 'active'
          ? () => cancel.mutate(reservation.id)
          : undefined,
    })),
  ]

  const columns: RegistryColumn<UsageEntry>[] = [
    {
      id: 'experiment',
      header: 'Experiment',
      cell: ({ row }) => (
        <ExperimentLabel
          experimentId={row.original.experimentId}
          byId={experimentById}
        />
      ),
    },
    {
      id: 'title',
      header: 'Title',
      cell: ({ row }) => row.original.title,
      meta: { cellClassName: 'max-w-[20rem] whitespace-normal leading-[17px]' },
    },
    {
      id: 'purpose',
      header: 'Purpose',
      cell: ({ row }) => row.original.purpose,
      meta: { cellClassName: 'max-w-[16rem] whitespace-normal leading-[17px]' },
    },
    {
      id: 'volume',
      header: 'Volume',
      cell: ({ row }) => row.original.volume,
      meta: rightAligned<UsageEntry>().meta,
    },
    {
      id: 'by',
      header: 'By',
      cell: ({ row }) => row.original.actor,
    },
    {
      id: 'when',
      header: 'When',
      cell: ({ row }) => (
        <span className="text-fg-muted" title={row.original.whenTitle}>
          {row.original.when}
        </span>
      ),
      meta: {
        ...rightAligned<UsageEntry>().meta,
        cellClassName: 'text-right text-fg-muted',
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) =>
        row.original.cancel && !cancel.isPending ? (
          <Button size="sm" onClick={row.original.cancel}>
            Cancel
          </Button>
        ) : null,
      meta: { cellClassName: 'text-right' },
    },
  ]

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <Section
        title="Usage"
        count={rowCount}
        action={
          actions ? (
            <span className="flex flex-wrap justify-end gap-2">
              <Button size="sm" onClick={actions.openReserve}>
                Reserve volume…
              </Button>
              {actions.canWithdraw ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={actions.openWithdraw}
                >
                  Withdraw volume…
                </Button>
              ) : null}
            </span>
          ) : null
        }
      >
        {rowCount ? (
          <TableBox>
            <RegistryGrid
              label="Sample usage"
              rows={usageRows}
              columns={columns}
              getRowId={(row) => row.id}
              selectable={false}
            />
          </TableBox>
        ) : (
          <EmptyState
            className="py-2"
            icon="tube"
            title="Not used yet"
            description="Withdrawals and planned reservations appear here once someone books or consumes this sample."
          />
        )}
      </Section>

      <Section
        title="Used in experiments"
        count={linkedExperiments.data?.length ?? 0}
      >
        {linkedExperiments.data?.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {linkedExperiments.data.map((experiment) => (
              <li key={experiment.id}>
                <ObjectLink
                  kind="experiment"
                  id={experiment.id}
                  identifier={experiment.identifier}
                />{' '}
                {experiment.title}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            className="py-2"
            icon="flask"
            title="Not linked to an experiment"
            description="Experiments that list this sample as used appear here."
          />
        )}
      </Section>

      <UsageBalanceBar balances={balances.data ?? null} />
    </div>
  )
}

function ExperimentLabel({
  experimentId,
  byId,
}: {
  experimentId: string | null
  byId: Map<string, RecordWire>
}) {
  if (!experimentId) return <span className="text-fg-muted">—</span>
  const experiment = byId.get(experimentId)
  if (!experiment) return <span className="text-fg-muted">—</span>
  return (
    <Link
      to="/experiments/$expId"
      params={{ expId: experiment.id }}
      className="mono text-link"
    >
      {experiment.identifier}
    </Link>
  )
}
