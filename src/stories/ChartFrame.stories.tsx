import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ChartFrame } from '#/components/viz/chart-frame'
const meta = {
  title: 'Visualization/Chart frame',
  component: ChartFrame,
  tags: ['autodocs'],
  args: {
    title: 'Growth curve',
    subtitle: 'E. coli DH5α at 37 °C',
    provenance: 'Source: OD600 plate reader · 29 July 2026',
    alt: 'Optical density rises from 0.05 to 0.82 over eight hours',
  },
} satisfies Meta<typeof ChartFrame>
export default meta
type Story = StoryObj<typeof meta>
export const Live: Story = {
  render: (args) => (
    <ChartFrame {...args}>
      <div className="grid h-48 place-items-center rounded bg-muted/30 text-muted-foreground">
        Chart plotting region
      </div>
    </ChartFrame>
  ),
}
export const Snapshot: Story = { args: { mode: 'snapshot' } }
export const Loading: Story = { args: { loading: true } }
