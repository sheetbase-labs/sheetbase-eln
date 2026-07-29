import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { BoxGrid } from '#/components/storage/box-grid'
const box: any = {
  id: 'box',
  name: 'Plasma cohort B',
  code: 'FZ2-R3-B04',
  rows: 3,
  cols: 4,
  capacity: 12,
}
const positions: any[] = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i}`,
  boxId: 'box',
  rowIndex: Math.floor(i / 4),
  colIndex: i % 4,
  label: `${String.fromCharCode(65 + Math.floor(i / 4))}${(i % 4) + 1}`,
  status: i === 5 ? 'quarantined' : i < 7 ? 'occupied' : 'available',
  sample:
    i < 7
      ? {
          identifier: `SMP-2026-${140 + i}`,
          title: 'Plasma aliquot',
          properties: { quantity: i === 1 ? 0.5 : 2 },
        }
      : null,
}))
const meta = {
  title: 'Storage/Box grid',
  component: BoxGrid,
  tags: ['autodocs'],
  args: {
    box,
    positions,
    selectedPositionId: 'p2',
    onSelectPosition: () => {},
    context: 'Freezer 2 / Rack 3',
  },
} satisfies Meta<typeof BoxGrid>
export default meta
type Story = StoryObj<typeof meta>
export const Populated: Story = {}
export const Loading: Story = { args: { loading: true } }
export const NoBoxSelected: Story = { args: { box: null, positions: [] } }
