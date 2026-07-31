import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { StorageMetrics } from '#/components/storage/storage-metrics'

const box: any = {
  id: 'box',
  name: 'Plasma cohort B',
  code: 'FZ2-R3-B04',
  rows: 3,
  cols: 4,
  capacity: 12,
}
const statuses = [
  'occupied',
  'occupied',
  'occupied',
  'occupied',
  'occupied',
  'quarantined',
  'available',
  'available',
  'available',
  'missing',
  'available',
  'occupied',
]
const positions: any[] = statuses.map((status, i) => ({
  id: `p${i}`,
  boxId: 'box',
  rowIndex: Math.floor(i / 4),
  colIndex: i % 4,
  label: `${String.fromCharCode(65 + Math.floor(i / 4))}${(i % 4) + 1}`,
  status,
  sample:
    status === 'occupied'
      ? {
          identifier: `SMP-2026-${140 + i}`,
          title: 'Plasma aliquot',
          properties: {
            quantity: i === 1 ? 0.5 : 2,
            expiryDate: i === 2 ? '2026-08-10' : '2027-01-01',
          },
        }
      : null,
}))
const meta = {
  title: 'Storage/Storage metrics',
  component: StorageMetrics,
  tags: ['autodocs'],
  args: { box, positions },
} satisfies Meta<typeof StorageMetrics>
export default meta
type Story = StoryObj<typeof meta>
export const Populated: Story = {}
export const Empty: Story = { args: { box: null, positions: [] } }
