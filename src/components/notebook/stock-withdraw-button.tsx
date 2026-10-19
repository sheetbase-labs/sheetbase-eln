import { useMutation } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { toast } from '#/components/v3/ui/sonner'
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
  const withdraw = useMutation({
    mutationFn: () => withdrawItemFromStock(client, item, { id: experimentId }),
    onSuccess: (result) => {
      toast(`${item.identifier} withdrawn from stock`)
      onWithdrawn(result.note)
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Could not withdraw.',
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
      {withdraw.isPending ? 'Withdrawing…' : 'Withdraw from stock'}
    </Button>
  )
}
