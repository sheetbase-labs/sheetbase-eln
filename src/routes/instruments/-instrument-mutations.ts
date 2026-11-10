import { useMutation, useQueryClient } from '@tanstack/react-query'

import { toast } from '#/components/ui/sonner'
import {
  instrumentQueryKeys,
  recordInstrumentCalibration,
} from '#/components/instruments/instruments-data'
import {
  dismissQualificationRequest,
  qualificationRequestsQueryKey,
} from '#/lib/instrument-qualification-requests'
import { notebookDataClient } from '#/lib/notebook-data'
import { t } from '#/copy'

import { qualificationQueryKey } from './-instrument-queries'

/**
 * The four writes the instrument record offers: record a calibration, grant a
 * qualification, dismiss a request for one, and revoke one.
 */
export function useInstrumentMutations({
  instrumentId,
  onRecorded,
  onGranted,
  onRevoked,
}: {
  instrumentId: string
  /** Closes the calibration dialog and clears what was typed into it. */
  onRecorded: () => void
  /** Closes the grant dialog and clears what was typed into it. */
  onGranted: () => void
  onRevoked: () => void
}) {
  const queryClient = useQueryClient()

  const record = useMutation({
    mutationFn: (input: {
      performedAt: string
      dueAt: string
      certificateFileId: string | null
      notes: string | null
    }) =>
      recordInstrumentCalibration({
        instrumentId,
        performedAt: input.performedAt,
        dueAt: input.dueAt,
        certificateFileId: input.certificateFileId,
        notes: input.notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: instrumentQueryKeys.calibrations(instrumentId),
      })
      onRecorded()
      toast(t('library.instruments.record.calibrationRecorded'))
    },
    onError: (failure: Error) => {
      toast(t('library.instruments.record.couldNotRecordTheCalibration'), {
        description:
          failure.message ||
          t('library.instruments.record.theDatabaseRefusedIt'),
      })
    },
  })

  // LAB-06.3 — the booking path refuses an unqualified booker, so the record
  // page is where a qualification is granted and revoked.
  const grant = useMutation({
    mutationFn: (input: {
      userId: string
      validUntil: string
      qualifiedFor: string | null
    }) =>
      notebookDataClient.rpc('set_instrument_qualification', {
        p_instrument_id: instrumentId,
        p_user_id: input.userId,
        p_valid_until: input.validUntil,
        p_qualified_for: input.qualifiedFor,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qualificationQueryKey(instrumentId),
      })
      onGranted()
      toast(t('library.instruments.record.qualificationGranted'))
    },
    onError: (failure: Error) => {
      toast(t('library.instruments.record.couldNotGrantTheQualification'), {
        description:
          failure.message ||
          t('library.instruments.record.theDatabaseRefusedIt'),
      })
    },
  })

  const dismissRequest = useMutation({
    mutationFn: (requestId: string) =>
      dismissQualificationRequest(notebookDataClient, requestId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qualificationRequestsQueryKey(instrumentId),
      })
      toast(t('library.instruments.record.requestDismissed'))
    },
    onError: (failure: Error) => {
      toast(t('library.instruments.record.couldNotDismissTheRequest'), {
        description:
          failure.message ||
          t('library.instruments.record.theDatabaseRefusedIt'),
      })
    },
  })

  const revoke = useMutation({
    mutationFn: (userId: string) =>
      notebookDataClient.rpc('revoke_instrument_qualification', {
        p_instrument_id: instrumentId,
        p_user_id: userId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qualificationQueryKey(instrumentId),
      })
      onRevoked()
      toast(t('library.instruments.record.qualificationRevoked'))
    },
    onError: (failure: Error) => {
      toast(t('library.instruments.record.couldNotRevokeTheQualification'), {
        description:
          failure.message ||
          t('library.instruments.record.theDatabaseRefusedIt'),
      })
    },
  })

  return { record, grant, dismissRequest, revoke }
}
