/**
 * What an order's status and its open/closed state mean to the screens that
 * list orders, kept beside the components but out of their module so Fast
 * Refresh can preserve those screens.
 */
import type { Tone } from '#/components/ui/status'
import { isOpenOrder } from '#/lib/reagent-orders'
import type { ReagentOrder, ReagentOrderStatus } from '#/lib/reagent-orders'
import { t } from '#/copy'

/** The open order for a material, if one is waiting. */
export function openOrderFor(
  orders: readonly ReagentOrder[] | undefined,
  materialRecordId: string,
): ReagentOrder | undefined {
  return orders?.find(
    (order) =>
      order.materialRecordId === materialRecordId && isOpenOrder(order.status),
  )
}

/** How each order status is painted. */
export const ORDER_TONE: Record<ReagentOrderStatus, Tone> = {
  requested: 'warn',
  ordered: 'progress',
  received: 'ok',
  cancelled: 'none',
}

export function orderStatusLabel(status: ReagentOrderStatus): string {
  return t(`library.materials.orders.status.${status}`)
}
