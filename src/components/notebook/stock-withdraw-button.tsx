import { t } from '#/copy'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { toast } from '#/components/ui/sonner'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { isWithdrawn, withdrawItemFromStock } from '#/lib/stock-withdraw'
import type { WithdrawableItem } from '#/lib/stock-withdraw'

/**
 * Withdraw a materials-block item from stock for this experiment. Once done
 * the item carries the withdrawal note, so the same row cannot be withdrawn
 * twice by accident, and the stock ledger shows the use.
 */
export function StockWithdrawButton({
  item,
  experimentId,
  note,
  onWithdrawn,
  client = notebookDataClient,
}: {
  item: WithdrawableItem
  experimentId: string
  /** The item's current note, which holds the withdrawn marker. */
  note?: string
  onWithdrawn: (note: string) => void
  client?: DataClient
}) {
  const queryClient = useQueryClient()

  const withdraw = useMutation({
    mutationFn: () => withdrawItemFromStock(client, item, { id: experimentId }),
    onSuccess: (result) => {
      // Both registry generations still have readers. Refresh their stock and
      // ledger families, not the notebook alone. Sample withdrawal also links
      // the sample to the experiment.
      const affectedKeys =
        item.kind === 'material'
          ? [
              ['ui-port', 'materials'],
              ['reg-003', 'reagents'],
            ]
          : [
              ['ui-port', 'samples', 'page'],
              ['reg-002', 'samples'],
              ['ui-port', 'sample', item.materialRecordId],
              ['ui-port', 'sample-events', item.materialRecordId],
              ['ui-port', 'sample-linked-experiments', item.materialRecordId],
              ['ui-port', 'sample-used-in', item.materialRecordId],
              ['ui-port', 'experiment-links', experimentId],
              ['ui-port', 'experiment-samples-table', experimentId],
            ]

      for (const queryKey of affectedKeys) {
        void queryClient.invalidateQueries({ queryKey })
      }

      toast(
        t('notebook.stockWithdrawButton.identifierWithdrawnFromStock', {
          identifier: item.identifier,
        }),
      )
      onWithdrawn(result.note)
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('notebook.stockWithdrawButton.couldNotWithdraw'),
      ),
  })

  if (isWithdrawn({ note })) {
    return <span className="text-xs text-fg-muted">{note}</span>
  }

  return (
    <Button
      type="button"
      size="sm"
      disabled={withdraw.isPending}
      onClick={() => withdraw.mutate()}
    >
      {withdraw.isPending
        ? t('notebook.stockWithdrawButton.withdrawing')
        : t('notebook.stockWithdrawButton.withdrawFromStock')}
    </Button>
  )
}
