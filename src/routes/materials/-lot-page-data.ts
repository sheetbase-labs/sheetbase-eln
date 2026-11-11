/**
 * Every read and write the reagent lot page makes, bound to one lot: the lot
 * itself, its ledger, the certificate, the solution its stock came from and
 * went into, and the three stock moves. The page owns the dialogs; this module
 * owns the transport and the refresh they share.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { toast } from '#/components/ui/sonner'
import { materialListQueryKeys } from '#/components/materials/materials-data'
import {
  fetchCertificateFile,
  fetchReagent,
  fetchReagentMovements,
  fetchReagentUsage,
  fetchReplacementLot,
  recordReagentMovement,
  registerReplacementLot,
} from '#/lib/reagent-data'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchMadeFrom,
  fetchPreparedWith,
  solutionQueryKeys,
} from '#/lib/solution-prep'
import { useUserNames } from '#/lib/user-names'
import { t } from '#/copy'
import { failureMessage } from '../-materials-page-model'

import { lotLedgerQueryKey, lotQueryKey } from './-lot-page-model'

/** What the page does when a dialog's write answers. */
export interface LotPageAfterWrite {
  onStockUsed: () => void
  onLotHeld: () => void
  onReplacementRegistered: () => void
}

export function useLotPageData(lotId: string, after: LotPageAfterWrite) {
  const queryClient = useQueryClient()

  const lot = useQuery({
    queryKey: lotQueryKey(lotId),
    queryFn: () => fetchReagent(notebookDataClient, lotId),
  })

  const reagent = lot.data ?? null

  const ledger = useQuery({
    queryKey: lotLedgerQueryKey(lotId),
    queryFn: () => fetchReagentMovements(notebookDataClient, lotId, 200),
  })

  const usage = useQuery({
    queryKey: ['ui-port', 'materials', 'usage', reagent?.identifier ?? ''],
    queryFn: () => fetchReagentUsage(notebookDataClient, reagent!.identifier),
    enabled: Boolean(reagent),
  })

  const certificate = useQuery({
    queryKey: ['ui-port', 'materials', 'certificate', lotId],
    queryFn: () => fetchCertificateFile(notebookDataClient, lotId),
  })

  const replacementLink = useQuery({
    queryKey: [
      'ui-port',
      'materials',
      'replacement',
      reagent?.identifier ?? '',
    ],
    queryFn: () => fetchReplacementLot(notebookDataClient, reagent!.identifier),
    enabled: Boolean(reagent),
  })

  const madeFrom = useQuery({
    queryKey: solutionQueryKeys.madeFrom(lotId),
    queryFn: () => fetchMadeFrom(notebookDataClient, lotId),
    enabled: Boolean(reagent),
  })

  const preparedWith = useQuery({
    queryKey: solutionQueryKeys.preparedWith(lotId),
    queryFn: () => fetchPreparedWith(notebookDataClient, lotId),
    enabled: Boolean(reagent),
  })

  const { userLabel } = useUserNames(
    (ledger.data ?? []).map((m) => m.actorUserId ?? '').filter(Boolean),
  )

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: lotQueryKey(lotId) })
    void queryClient.invalidateQueries({ queryKey: lotLedgerQueryKey(lotId) })
    void queryClient.invalidateQueries({
      queryKey: materialListQueryKeys.page,
    })
  }

  const useStock = useMutation({
    mutationFn: (input: { quantity: number; reason?: string }) =>
      recordReagentMovement(notebookDataClient, {
        recordId: lotId,
        operation: 'consume',
        quantityDelta: input.quantity,
        reason: input.reason,
        expectedMetadataVersion: reagent!.metadataVersion,
      }),
    onSuccess: () => {
      refresh()
      toast(t('library.materials.lot.useRecorded'))
      after.onStockUsed()
    },
    onError: (error) =>
      toast(
        failureMessage(error, t('library.materials.lot.couldNotRecordUse')),
      ),
  })

  // A quarantined lot is isolated, not gone: the same call restores it.
  const hold = useMutation({
    mutationFn: (input: {
      operation: 'quarantine' | 'restore'
      reason?: string
    }) =>
      recordReagentMovement(notebookDataClient, {
        recordId: lotId,
        operation: input.operation,
        quantityDelta: 0,
        reason: input.reason?.trim() || undefined,
        expectedMetadataVersion: reagent!.metadataVersion,
      }),
    onSuccess: (_result, input) => {
      refresh()
      toast(
        input.operation === 'quarantine'
          ? t('library.materials.lot.lotQuarantined')
          : t('library.materials.lot.lotRestored'),
      )
      after.onLotHeld()
    },
    onError: (error) =>
      toast(
        failureMessage(error, t('library.materials.lot.couldNotChangeTheLot')),
      ),
  })

  const replacement = useMutation({
    mutationFn: (input: {
      lot: string
      expiry: string
      quantity: number
      unit?: string
      reason?: string
    }) =>
      registerReplacementLot(notebookDataClient, {
        recordId: lotId,
        lot: input.lot,
        expiry: input.expiry,
        quantity: input.quantity,
        unit: input.unit ?? reagent!.unit,
        reason: input.reason,
      }),
    onSuccess: () => {
      refresh()
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'materials', 'replacement'],
      })
      toast(t('library.materials.lot.replacementLotRegistered'))
      after.onReplacementRegistered()
    },
    onError: (error) =>
      toast(
        failureMessage(
          error,
          t('library.materials.lot.couldNotRegisterTheReplacement'),
        ),
      ),
  })

  return {
    lot,
    reagent,
    ledger,
    usage,
    certificate,
    replacementLink,
    madeFrom,
    preparedWith,
    userLabel,
    refresh,
    useStock,
    hold,
    replacement,
  }
}
