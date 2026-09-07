import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { MetricSummary } from '#/components/scientific/metric-summary'

const meta = {
  title: 'Scientific/Metric summary',
  component: MetricSummary,
  tags: ['autodocs'],
} satisfies Meta<typeof MetricSummary>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  args: {
    label: 'Assigned experiments',
    value: 2,
    hint: '1 in progress',
    valueDescription: 'Current assigned experiments',
  },
}
export const OverviewStrip: Story = {
  args: Default.args,
  render: () => (
    <div className="grid grid-cols-1 gap-x-5 gap-y-3 border-y border-border py-3 sm:grid-cols-2 xl:grid-cols-5">
      <MetricSummary
        label="Assigned experiments"
        value={2}
        hint="1 in progress"
      />
      <MetricSummary label="Pending reviews" value={0} />
      <MetricSummary label="In progress" value={1} hint="Open work items" />
      <MetricSummary
        label="Recent activity"
        value={25}
        hint="Across all projects"
      />
      <MetricSummary label="Open mentions" value={0} hint="No mentions" />
    </div>
  ),
}
