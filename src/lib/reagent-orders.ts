/**
 * Reagent ordering: a reorder is requested from a material, placed with the
 * supplier, and received as a new lot (migration 0058).
 *
 * Reads go straight to `api.reagent_orders` under row-level security; every
 * change goes through an RPC so the steps, who may take them and the
 * notifications stay in the database.
 */

import type { DataClient } from '#/lib/data-client'

export const REAGENT_ORDER_STATUSES = [
  'requested',
  'ordered',
  'received',
  'cancelled',
] as const

export type ReagentOrderStatus = (typeof REAGENT_ORDER_STATUSES)[number]

/** An order that has not reached the shelf or been called off. */
export function isOpenOrder(status: ReagentOrderStatus): boolean {
  return status === 'requested' || status === 'ordered'
}

export interface ReagentOrderWire {
  id: string
  number: number
  material_record_id: string | null
  material_title: string
  supplier: string | null
  supplier_record_id: string | null
  catalog_no: string | null
  quantity: string | number
  unit: string | null
  status: string
  note: string | null
  order_reference: string | null
  expected_on: string | null
  cancel_reason: string | null
  received_record_id: string | null
  received_lot: string | null
  requested_by: string | null
  requested_at: string
  ordered_at: string | null
  received_at: string | null
  cancelled_at: string | null
}

export interface ReagentOrder {
  id: string
  /** "RO-0007": the number a person quotes to the supplier or a colleague. */
  reference: string
  materialRecordId: string | null
  materialTitle: string
  supplier: string | null
  supplierRecordId: string | null
  catalogNo: string | null
  quantity: number
  unit: string | null
  status: ReagentOrderStatus
  note: string | null
  orderReference: string | null
  /** ISO date YYYY-MM-DD. */
  expectedOn: string | null
  cancelReason: string | null
  receivedRecordId: string | null
  receivedLot: string | null
  requestedBy: string | null
  requestedAt: string
  orderedAt: string | null
  receivedAt: string | null
  cancelledAt: string | null
}

export function orderReference(number: number): string {
  return `RO-${String(number).padStart(4, '0')}`
}

function asStatus(value: string): ReagentOrderStatus {
  return (REAGENT_ORDER_STATUSES as readonly string[]).includes(value)
    ? (value as ReagentOrderStatus)
    : 'requested'
}

export function toReagentOrder(row: ReagentOrderWire): ReagentOrder {
  return {
    id: row.id,
    reference: orderReference(row.number),
    materialRecordId: row.material_record_id,
    materialTitle: row.material_title,
    supplier: row.supplier,
    supplierRecordId: row.supplier_record_id ?? null,
    catalogNo: row.catalog_no,
    quantity: Number(row.quantity),
    unit: row.unit,
    status: asStatus(row.status),
    note: row.note,
    orderReference: row.order_reference,
    expectedOn: row.expected_on,
    cancelReason: row.cancel_reason,
    receivedRecordId: row.received_record_id,
    receivedLot: row.received_lot,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    orderedAt: row.ordered_at,
    receivedAt: row.received_at,
    cancelledAt: row.cancelled_at,
  }
}

export const reagentOrderQueryKeys = {
  all: ['ui-port', 'materials', 'orders'] as const,
  prices: ['ui-port', 'materials', 'orders', 'prices'] as const,
}

/** What an order cost. Only the people who place orders can read it. */
export interface OrderPrice {
  totalPrice: number
  currency: string
}

/** Prices by order id; empty for anyone who may not read them. */
export async function fetchReagentOrderPrices(
  client: DataClient,
): Promise<Map<string, OrderPrice>> {
  const rows = await client.list<{
    order_id: string
    total_price: string | number
    currency: string
  }>('reagent_order_prices', '?limit=5000')

  return new Map(
    rows.map((row) => [
      row.order_id,
      { totalPrice: Number(row.total_price), currency: row.currency },
    ]),
  )
}

export function setReagentOrderPrice(
  client: DataClient,
  input: {
    orderId: string
    totalPrice: number | null
    currency: string | null
  },
): Promise<unknown> {
  return client.rpc('set_reagent_order_price', {
    p_order_id: input.orderId,
    p_total_price: input.totalPrice,
    p_currency: input.currency,
  })
}

/** Newest first; a lab's order history is short enough to read in one go. */
export async function fetchReagentOrders(
  client: DataClient,
): Promise<ReagentOrder[]> {
  const rows = await client.list<ReagentOrderWire>(
    'reagent_orders',
    '?order=requested_at.desc&limit=500',
  )

  return rows.map(toReagentOrder)
}

export interface RequestReagentOrderInput {
  materialRecordId: string
  quantity: number
  unit?: string | null
  note?: string | null
}

export function requestReagentOrder(
  client: DataClient,
  input: RequestReagentOrderInput,
): Promise<ReagentOrderWire> {
  return client.rpc<ReagentOrderWire>('request_reagent_order', {
    p_material_record_id: input.materialRecordId,
    p_quantity: input.quantity,
    p_unit: input.unit ?? null,
    p_note: input.note ?? null,
  })
}

export interface MarkReagentOrderedInput {
  orderId: string
  orderReference?: string | null
  /** ISO date YYYY-MM-DD. */
  expectedOn?: string | null
  supplier?: string | null
  /** A record from the supplier list; its name becomes the order's supplier. */
  supplierRecordId?: string | null
  totalPrice?: number | null
  /** Three-letter code, such as GBP. */
  currency?: string | null
}

export function markReagentOrdered(
  client: DataClient,
  input: MarkReagentOrderedInput,
): Promise<ReagentOrderWire> {
  return client.rpc<ReagentOrderWire>('mark_reagent_ordered', {
    p_order_id: input.orderId,
    p_order_reference: input.orderReference ?? null,
    p_expected_on: input.expectedOn || null,
    p_supplier: input.supplier ?? null,
    p_supplier_record_id: input.supplierRecordId ?? null,
    p_total_price: input.totalPrice ?? null,
    p_currency: input.currency ?? null,
  })
}

export interface ReceiveReagentOrderInput {
  orderId: string
  lot: string
  /** ISO date YYYY-MM-DD. */
  expiry: string
  /** Defaults to the quantity that was ordered. */
  quantity?: number | null
}

export function receiveReagentOrder(
  client: DataClient,
  input: ReceiveReagentOrderInput,
): Promise<ReagentOrderWire> {
  return client.rpc<ReagentOrderWire>('receive_reagent_order', {
    p_order_id: input.orderId,
    p_lot: input.lot,
    p_expiry: input.expiry,
    p_quantity: input.quantity ?? null,
  })
}

export function cancelReagentOrder(
  client: DataClient,
  orderId: string,
  reason?: string | null,
): Promise<ReagentOrderWire> {
  return client.rpc<ReagentOrderWire>('cancel_reagent_order', {
    p_order_id: orderId,
    p_reason: reason ?? null,
  })
}
