import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Section } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { toast } from '#/components/v3/ui/sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableBox,
} from '#/components/v3/ui/table'
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
import type { SampleEvent, SampleReservation } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import type { RecordWire } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'

import { sampleEventsQueryKey } from '../$sampleId'

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
  const reservationRows = reservations.data ?? []
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
      const rows = await notebookDataClient.list<RecordWire>(
        'records',
        `?id=in.(${experimentIds.join(',')})&select=id,identifier,title`,
      )
      return new Map(rows.map((row) => [row.id, row]))
    },
  })
  const experimentById = experiments.data ?? new Map<string, RecordWire>()

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
              <Button size="sm" variant="primary" onClick={actions.openWithdraw}>
                Withdraw volume…
              </Button>
            </span>
          ) : null
        }
      >
        {rowCount ? (
          <TableBox>
            <Table aria-label="Sample usage">
              <TableHeader>
                <TableRow>
                  <TableHead>Experiment</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead align="right">Volume</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead align="right">When</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withdrawalEvents.map((event) => (
                  <UsageRow
                    key={event.id}
                    event={event}
                    experiment={experimentById}
                    unit={unit}
                    actor={
                      event.actorUserId
                        ? names.userLabel(event.actorUserId)
                        : 'System'
                    }
                  />
                ))}
                {reservationRows.map((reservation) => (
                  <ReservationRow
                    key={reservation.id}
                    reservation={reservation}
                    experiment={experimentById}
                    unit={unit}
                    actor={
                      reservation.createdByUserId
                        ? names.userLabel(reservation.createdByUserId)
                        : '—'
                    }
                    busy={cancel.isPending}
                    onCancel={() => cancel.mutate(reservation.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            className="py-2"
            icon="tube"
            title="Not used yet"
            body="Withdrawals and planned reservations appear here."
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

function UsageRow({
  event,
  experiment,
  unit,
  actor,
}: {
  event: SampleEvent
  experiment: Map<string, RecordWire>
  unit: string
  actor: string
}) {
  const title = event.purposeRecordId
    ? (experiment.get(event.purposeRecordId)?.title ?? '—')
    : '—'
  const volume =
    event.quantityDelta == null
      ? '—'
      : `${formatQuantityAmount(Math.abs(event.quantityDelta))}${unit}`
  return (
    <TableRow>
      <TableCell>
        <ExperimentLabel
          experimentId={event.purposeRecordId}
          byId={experiment}
        />
      </TableCell>
      <TableCell className="max-w-[20rem] whitespace-normal leading-[17px]">
        {title}
      </TableCell>
      <TableCell className="max-w-[16rem] whitespace-normal leading-[17px]">
        {event.notes ?? '—'}
      </TableCell>
      <TableCell align="right">{volume}</TableCell>
      <TableCell>{actor}</TableCell>
      <TableCell
        align="right"
        className="text-fg-muted"
        title={formatSampleEventTime(event.createdAt)}
      >
        {formatSampleEventDay(event.createdAt)}
      </TableCell>
      <TableCell />
    </TableRow>
  )
}

function ReservationRow({
  reservation,
  experiment,
  unit,
  actor,
  busy,
  onCancel,
}: {
  reservation: SampleReservation
  experiment: Map<string, RecordWire>
  unit: string
  actor: string
  busy: boolean
  onCancel: () => void
}) {
  const title = experiment.get(reservation.experimentRecordId)?.title ?? '—'
  const active = reservation.state === 'active'
  const when =
    active && reservation.planned
      ? 'Planned'
      : formatSampleEventDay(reservation.createdAt)
  return (
    <TableRow>
      <TableCell>
        <ExperimentLabel
          experimentId={reservation.experimentRecordId}
          byId={experiment}
        />
      </TableCell>
      <TableCell className="max-w-[20rem] whitespace-normal leading-[17px]">
        {title}
      </TableCell>
      <TableCell className="max-w-[16rem] whitespace-normal leading-[17px]">
        {reservation.notes ?? (reservation.planned ? 'Planned use' : 'In progress')}
      </TableCell>
      <TableCell align="right">
        {formatQuantityAmount(reservation.quantity)}
        {unit}
      </TableCell>
      <TableCell>{actor}</TableCell>
      <TableCell align="right" className="text-fg-muted">
        {when}
      </TableCell>
      <TableCell align="right">
        {active ? (
          <Button size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  )
}
