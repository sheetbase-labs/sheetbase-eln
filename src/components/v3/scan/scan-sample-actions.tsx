import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { toast } from '#/components/v3/ui/sonner'
import { ReleaseChecksPanel } from '#/components/v3/samples/release-checks-panel'
import { MoveSampleDialog } from '#/components/v3/samples/move-dialog'
import { canWithdrawSample } from '#/components/v3/samples/sample-state'
import {
  WithdrawDialog,
  describeWithdrawError,
  formatQuantityAmount,
} from '#/components/v3/samples/withdraw-dialog'
import type { WithdrawDialogInput } from '#/components/v3/samples/withdraw-dialog'
import {
  sampleListQueryKeys,
  storageLocationsQueryKey,
} from '#/components/v3/samples/samples-data'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  describeSampleError,
  fetchSample,
  sampleQueryKeys,
  transferSample,
  withdrawSample,
} from '#/lib/samples'
import { t } from '#/copy'

/**
 * What a person standing at the bench does after scanning a sample: withdraw
 * volume, move it, record a reading. Each opens in place and the scan stays on
 * screen with the sample's new quantity and place, so a run of scans is not a
 * run of page loads. Record reading leaves for the reading form and returns
 * here (`returnTo`) with the code still resolved.
 */
export function ScanSampleActions({
  sampleId,
  returnTo,
  client = notebookDataClient,
  onChanged,
}: {
  sampleId: string
  /** The in-app path a detour comes back to (this scan, code included). */
  returnTo: string
  client?: DataClient
  /** Called after a withdrawal or move, so the scan can refresh its result. */
  onChanged?: () => void
}) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<'withdraw' | 'move' | null>(null)
  const key = sampleQueryKeys.detail(sampleId)
  const sample = useQuery({
    queryKey: key,
    queryFn: () => fetchSample(client, sampleId),
  })
  const record = sample.data

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key })
    void queryClient.invalidateQueries({ queryKey: sampleListQueryKeys.page })
    void queryClient.invalidateQueries({ queryKey: storageLocationsQueryKey })
    onChanged?.()
  }

  const withdraw = useMutation({
    mutationFn: (input: WithdrawDialogInput) =>
      withdrawSample(client, {
        recordId: sampleId,
        quantity: input.quantity,
        unit: input.unit,
        purposeExperimentId: input.purposeExperimentId,
        notes: input.notes,
        newContainer: input.newContainer,
        expectedMetadataVersion: record!.metadataVersion,
      }),
    onSuccess: (result) => {
      refresh()
      toast(
        result.derivedSample
          ? t('library.scan.sampleActions.volumeWithdrawnAndContainerCreated')
          : t('library.scan.sampleActions.volumeWithdrawn'),
      )
      setDialog(null)
    },
    onError: (error) =>
      toast.error(describeWithdrawError(error, record?.quantityUnit ?? null)),
  })
  const move = useMutation({
    mutationFn: (toLocation: string) =>
      transferSample(client, {
        recordId: sampleId,
        toLocation,
        expectedMetadataVersion: record!.metadataVersion,
      }),
    onSuccess: () => {
      refresh()
      toast(t('library.scan.sampleActions.sampleMoved'))
      setDialog(null)
    },
    onError: (error) => toast.error(describeSampleError(error)),
  })

  if (sample.isPending) return null
  if (!record) {
    return (
      <p role="alert" className="m-0 text-label text-danger-text">
        {t('library.scan.sampleActions.thisSampleCouldNotBe')}
      </p>
    )
  }

  const quantity =
    record.quantity != null
      ? `${formatQuantityAmount(record.quantity)}${record.quantityUnit ? ` ${record.quantityUnit}` : ''}`
      : null
  const archived = Boolean(record.archivedAt)
  const withdrawable = !archived && canWithdrawSample(record.status)
  const movable = !archived && !['consumed', 'disposed'].includes(record.status)

  return (
    <>
      <p className="m-0 text-body" data-slot="scan-sample-facts">
        {[quantity, record.storageLocation].filter(Boolean).join(' · ') ||
          t('library.scan.sampleActions.noQuantityOrLocationRecorded')}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Button
          size="lg"
          disabled={!withdrawable}
          onClick={() => setDialog('withdraw')}
        >
          {t('library.scan.sampleActions.withdraw')}
        </Button>
        <Button size="lg" disabled={!movable} onClick={() => setDialog('move')}>
          {t('library.scan.sampleActions.move')}
        </Button>
        <Button
          size="lg"
          nativeButton={false}
          render={
            <Link to="/readings/new" search={{ sample: sampleId, returnTo }} />
          }
        >
          {t('library.scan.sampleActions.recordReading')}
        </Button>
      </div>
      {record.status === 'quarantined' && !archived ? (
        <section
          aria-label={t('library.scan.sampleActions.releaseChecks')}
          className="flex flex-col gap-1.5 rounded-md border border-border p-3"
        >
          <h2 className="m-0 text-label font-semibold">
            {t('library.scan.sampleActions.releaseChecks')}
          </h2>
          <ReleaseChecksPanel sampleId={sampleId} client={client} />
        </section>
      ) : null}
      {!withdrawable && !archived ? (
        <p className="m-0 text-label text-fg-muted">
          {t('library.scan.sampleActions.withdrawIsUnavailableWhileThis', {
            status: record.status.replace(/_/g, ' '),
          })}
        </p>
      ) : null}
      {dialog === 'withdraw' ? (
        <WithdrawDialog
          open
          onOpenChange={(open) => setDialog(open ? 'withdraw' : null)}
          sample={record}
          busy={withdraw.isPending}
          onSubmit={(input) => withdraw.mutate(input)}
        />
      ) : null}
      {dialog === 'move' ? (
        <MoveSampleDialog
          open
          onOpenChange={(open) => setDialog(open ? 'move' : null)}
          sample={record}
          busy={move.isPending}
          onSubmit={(toLocation) => move.mutate(toLocation)}
        />
      ) : null}
    </>
  )
}
