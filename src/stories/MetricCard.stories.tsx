import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Database, FlaskConical, ShieldCheck, TestTube2 } from 'lucide-react'

import { MetricCard } from '#/components/scientific/metric-card'

const meta = {
  title: 'Scientific/Metric card',
  component: MetricCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof MetricCard>

export default meta
type Story = StoryObj<typeof meta>

export const Grid: Story = {
  args: { label: 'Metric', value: '0' },
  render: () => (
    <div className="grid min-w-[760px] grid-cols-4 gap-3">
      <MetricCard
        label="Active experiments"
        value="12"
        hint="+3 this week"
        hintTone="success"
        icon={FlaskConical}
      />
      <MetricCard
        label="Linked samples"
        value="248"
        hint="+18 this week"
        hintTone="success"
        icon={TestTube2}
      />
      <MetricCard
        label="Datasets"
        value="43"
        hint="2 need attention"
        hintTone="warning"
        icon={Database}
      />
      <MetricCard
        label="Pending reviews"
        value="4"
        hint="No change"
        icon={ShieldCheck}
      />
    </div>
  ),
}
