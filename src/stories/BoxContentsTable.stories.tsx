import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { BoxContentsTable } from '#/components/storage/box-contents-table'
import type { BoxPositionWithSample } from '#/lib/storage'

const positions = [
  {
    id: 'position-1',
    boxId: 'box',
    label: 'A1',
    rowIndex: 0,
    colIndex: 0,
    status: 'occupied',
    occupiedRecordId: 'sample-1',
    reservedForRecordId: null,
    metadata: {},
    createdAt: '2026-07-29T00:00:00Z',
    updatedAt: '2026-07-29T00:00:00Z',
    sample: {
      id: 'sample-1',
      identifier: 'SMP-001',
      title: 'Control serum',
      status: 'active',
      barcode: '0001',
      sampleType: 'Serum',
      properties: { quantity: '250 µL' },
    },
  },
  {
    id: 'position-2',
    boxId: 'box',
    label: 'A2',
    rowIndex: 0,
    colIndex: 1,
    status: 'available',
    occupiedRecordId: null,
    reservedForRecordId: null,
    metadata: {},
    createdAt: '2026-07-29T00:00:00Z',
    updatedAt: '2026-07-29T00:00:00Z',
    sample: null,
  },
] as unknown as BoxPositionWithSample[]
const meta = {
  title: 'Features/BoxContentsTable',
  component: BoxContentsTable,
  tags: ['autodocs'],
  args: { positions, onSelectPosition: () => undefined },
} satisfies Meta<typeof BoxContentsTable>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Selected: Story = { args: { selectedPositionId: 'position-1' } }
export const Empty: Story = { args: { positions: [] } }
