import { describe, expect, it } from 'vitest'

import {
  isOpenOrder,
  orderReference,
  toReagentOrder,
} from '#/lib/reagent-orders'
import type { ReagentOrderWire } from '#/lib/reagent-orders'

const wire: ReagentOrderWire = {
  id: 'o-1',
  number: 7,
  material_record_id: 'm-1',
  material_title: 'Tris buffer',
  supplier: 'Sigma',
  supplier_record_id: null,
  catalog_no: 'T9285',
  quantity: '4.000000',
  unit: 'mL',
  status: 'ordered',
  note: null,
  order_reference: 'PO-1',
  expected_on: '2026-11-10',
  cancel_reason: null,
  received_record_id: null,
  received_lot: null,
  requested_by: 'u-1',
  requested_at: '2026-11-04T09:00:00Z',
  ordered_at: '2026-11-04T10:00:00Z',
  received_at: null,
  cancelled_at: null,
}

describe('reagent orders', () => {
  it('numbers an order the way a person quotes it', () => {
    expect(orderReference(7)).toBe('RO-0007')
    expect(orderReference(12345)).toBe('RO-12345')
  })

  it('reads the wire shape, turning the numeric string into a number', () => {
    const order = toReagentOrder(wire)
    expect(order.reference).toBe('RO-0007')
    expect(order.quantity).toBe(4)
    expect(order.status).toBe('ordered')
  })

  it('treats an unknown status as requested rather than losing the row', () => {
    expect(toReagentOrder({ ...wire, status: 'weird' }).status).toBe(
      'requested',
    )
  })

  it('counts requested and ordered as open', () => {
    expect(isOpenOrder('requested')).toBe(true)
    expect(isOpenOrder('ordered')).toBe(true)
    expect(isOpenOrder('received')).toBe(false)
    expect(isOpenOrder('cancelled')).toBe(false)
  })
})
