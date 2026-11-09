import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  NewShipmentDialog,
  ShipmentDialog,
} from '#/components/shipments/shipment-dialogs'
import { ShipmentsPage } from '#/components/shipments/shipments-page'
import { shipmentKeys } from '#/lib/shipments'
import type { ShipmentRow } from '#/lib/shipments'
import { screenQueryClient, withApiReads } from './screen-stories'

/**
 * Shipments: samples and materials sent out or expected in, with a manifest
 * and a status of draft, in transit or received. The list is seeded; the
 * manifest read is held, so the dialog shows its loading state.
 */
const shipment: ShipmentRow = {
  id: 'ship-1',
  number: 1,
  direction: 'inbound',
  status: 'in_transit',
  counterparty: 'Partner Lab Ltd',
  carrier: 'DHL',
  tracking_reference: 'JD0123',
  shipped_on: '2026-11-03',
  expected_on: '2026-11-06',
  received_at: null,
  condition_note: null,
  notes: 'Keep on dry ice',
  cancel_reason: null,
  created_by: 'user-1',
  created_at: '2026-11-03T09:00:00Z',
  project_id: null,
}

const meta = {
  title: 'Shipments/Shipments',
  component: ShipmentsPage,
  decorators: [
    withApiReads('pending'),
    (Story) => (
      <QueryClientProvider
        client={screenQueryClient({
          data: [
            { key: shipmentKeys.list, value: [shipment] },
            { key: shipmentKeys.counts, value: {} },
          ],
        })}
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
  args: { canWrite: true },
} satisfies Meta<typeof ShipmentsPage>

export default meta

type Story = StoryObj<typeof meta>

/** The shipments list for a writer. */
export const Page: Story = {}

/** Creating a shipment. */
export const New: Story = {
  render: () => <NewShipmentDialog open onOpenChange={() => {}} />,
}

/** An in-transit shipment open, manifest loading. */
export const Open: Story = {
  render: () => (
    <ShipmentDialog shipment={shipment} canWrite onClose={() => {}} />
  ),
}
