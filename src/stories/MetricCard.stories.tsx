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
export const Tones: Story = { args: { label: 'Metric', value: '0' }, render: () => <div className="grid grid-cols-3 gap-3">{(['default','info','success','warning','danger'] as const).map((tone,i)=><MetricCard key={tone} label={`${tone} metric`} value={[7.42,98.6,24,3,1][i]} hint={`${tone} observation`} hintTone={tone} icon={FlaskConical}/>)}</div> }
export const WithSparkline: Story = { args: { label: 'OD₆₀₀', value: '0.82', hint: '+12% over 4 h', hintTone: 'success', icon: TestTube2, sparkline: <svg viewBox="0 0 100 30" className="h-10 w-28" aria-label="Increasing trend"><polyline points="0,27 20,25 40,19 60,17 80,8 100,3" fill="none" stroke="currentColor" strokeWidth="2"/></svg> } }
