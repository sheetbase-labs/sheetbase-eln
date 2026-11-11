import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { toast } from '#/components/ui/sonner'
import { formatQuantityAmount } from '#/components/samples/quantity-input'
import {
  formatSampleEventDay,
  formatSampleEventTime,
} from '#/components/samples/sample-history'
import {
  cancelSampleReservation,
  describeSampleError,
  fetchSampleEvents,
  fetchSampleQuantityBalances,
  fetchSampleReservations,
  sampleQueryKeys,
} from '#/lib/samples'
import type { SampleEvent, SampleReservation } from '#/lib/samples'
import { chunkIds } from '#/lib/chunk-ids'
import { notebookDataClient } from '#/lib/notebook-data'
import type { RecordWire } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { sampleEventsQueryKey } from '#/routes/samples/-sample-keys'
import { t } from '#/copy'

/**
 * One row of the merged usage table: a withdrawal event or a live reservation,
 * reduced to the cells the table shows.
 */
export interface UsageEntry {
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
 * The Usage tab's data: the balances, the withdrawal events and live
 * reservations merged into one row list, and the experiments that name the
 * sample from their side of the link.
 */
export function useSampleUsage(sampleId: string) {
  const queryClient = useQueryClient()

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

  const experimentIds = usageExperimentIds(withdrawalEvents, reservationRows)

  const experiments = useQuery({
    queryKey: [
      'ui-port',
      'sample-usage-experiments',
      sampleId,
      experimentIds.join(','),
    ],
    enabled: experimentIds.length > 0,
    queryFn: () => fetchUsageExperiments(experimentIds),
  })

  const linkedExperiments = useQuery({
    queryKey: ['ui-port', 'sample-linked-experiments', sampleId],
    queryFn: () => fetchLinkedExperiments(sampleId),
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
      toast(t('library.samples.usage.reservationCancelled'))
    },
    onError: (error) => toast.error(describeSampleError(error)),
  })

  const experimentById = experiments.data ?? new Map<string, RecordWire>()

  return {
    balances,
    linkedExperiments,
    experimentById,
    rowCount: withdrawalEvents.length + reservationRows.length,
    rows: sampleUsageRows({
      withdrawalEvents,
      reservationRows,
      experimentById,
      unit: balances.data?.unit ? ` ${balances.data.unit}` : '',
      userLabel: names.userLabel,
      onCancel: (reservationId) => cancel.mutate(reservationId),
    }),
    cancelling: cancel.isPending,
  }
}

/** The experiments this sample's usage names, either side of the link. */
function usageExperimentIds(
  withdrawalEvents: SampleEvent[],
  reservations: SampleReservation[],
): string[] {
  return Array.from(
    new Set(
      [
        ...withdrawalEvents.map((event) => event.purposeRecordId),
        ...reservations.map((row) => row.experimentRecordId),
      ].filter((id): id is string => Boolean(id)),
    ),
  )
}

async function fetchUsageExperiments(experimentIds: string[]) {
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
}

/**
 * The experiments that name this sample, from their side of the link: an
 * experiment that lists the sample as used appears here, whether or not any
 * volume has been withdrawn for it.
 */
function fetchLinkedExperiments(sampleId: string) {
  return notebookDataClient
    .list<{ source_record_id: string }>(
      'record_links',
      `?target_record_id=eq.${sampleId}&link_type=eq.sample&select=source_record_id&order=created_at.desc`,
    )
    .then((links) => {
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
    })
}

/**
 * One row shape for a withdrawal and a reservation: the design shows both in
 * one table, so the grid renders the merged list rather than two bodies.
 */
function sampleUsageRows({
  withdrawalEvents,
  reservationRows,
  experimentById,
  unit,
  userLabel,
  onCancel,
}: {
  withdrawalEvents: SampleEvent[]
  reservationRows: SampleReservation[]
  experimentById: Map<string, RecordWire>
  unit: string
  userLabel: (userId: string) => string
  onCancel: (reservationId: string) => void
}): UsageEntry[] {
  return [
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
      actor: event.actorUserId
        ? userLabel(event.actorUserId)
        : t('library.samples.usage.system'),
      when: formatSampleEventDay(event.createdAt),
      whenTitle: formatSampleEventTime(event.createdAt),
    })),
    ...reservationRows.map((reservation) => ({
      id: reservation.id,
      experimentId: reservation.experimentRecordId,
      title: experimentById.get(reservation.experimentRecordId)?.title ?? '—',
      purpose:
        reservation.notes ??
        (reservation.planned
          ? t('library.samples.usage.plannedUse')
          : t('library.samples.usage.inProgress')),
      volume: `${formatQuantityAmount(reservation.quantity)}${unit}`,
      actor: reservation.createdByUserId
        ? userLabel(reservation.createdByUserId)
        : '—',
      when:
        reservation.state === 'active' && reservation.planned
          ? t('library.samples.usage.planned')
          : formatSampleEventDay(reservation.createdAt),
      cancel:
        reservation.state === 'active'
          ? () => onCancel(reservation.id)
          : undefined,
    })),
  ]
}
