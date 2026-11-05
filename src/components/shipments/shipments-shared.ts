import { t } from '#/copy'
import type { Tone } from '#/components/ui/status'
import type { ShipmentRow, ShipmentStatus } from '#/lib/shipments'

export function shipmentTone(status: ShipmentStatus): Tone {
  switch (status) {
    case 'draft':
      return 'draft'
    case 'in_transit':
      return 'progress'
    case 'received':
      return 'ok'
    default:
      return 'none'
  }
}

/** "Received" for a delivery in, "Delivered" for a box sent out. */
export function shipmentStatusLabel(shipment: ShipmentRow): string {
  return shipment.status === 'received'
    ? t(`shipments.receivedWord.${shipment.direction}`)
    : t(`shipments.statuses.${shipment.status}`)
}

/** In transit and later than expected. */
export function isLate(shipment: ShipmentRow, today: string): boolean {
  return (
    shipment.status === 'in_transit' &&
    shipment.expected_on !== null &&
    shipment.expected_on < today
  )
}

export function shipmentText(shipment: ShipmentRow): string {
  return [
    `SHP-${String(shipment.number).padStart(4, '0')}`,
    shipment.counterparty,
    shipment.carrier ?? '',
    shipment.tracking_reference ?? '',
  ]
    .join(' ')
    .toLowerCase()
}
