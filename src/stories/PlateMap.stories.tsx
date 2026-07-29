import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { PlateMap } from '#/components/viz/plate-map'
const wells = Array.from({ length: 96 }, (_, i) => ({
  row: Math.floor(i / 12),
  col: i % 12,
  value: i < 12 ? 0.95 : i < 24 ? 0.08 : Math.max(0, Math.sin(i) * 0.4 + 0.5),
  label: `${String.fromCharCode(65 + Math.floor(i / 12))}${(i % 12) + 1} absorbance`,
}))
const meta = {
  title: 'Visualization/Plate map',
  component: PlateMap,
  tags: ['autodocs'],
  args: { wells, ariaLabel: '96-well ELISA plate' },
} satisfies Meta<typeof PlateMap>
export default meta
type Story = StoryObj<typeof meta>
export const Heatmap96Well: Story = {}
export const Compact: Story = { args: { compact: true, selectedIndex: 25 } }
export const ReadOnly: Story = { args: { readOnly: true } }
export const Empty: Story = { args: { wells: [] } }
