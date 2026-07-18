import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Database, FlaskConical, ShieldCheck, TestTube2 } from 'lucide-react'
import { MetricCard } from '#/components/sheetbase/metric-card'

const meta = { title: 'Scientific/Metric card', component: MetricCard, tags: ['autodocs'], parameters: { layout: 'padded' } } satisfies Meta<typeof MetricCard>
export default meta
type Story = StoryObj<typeof meta>
export const Grid: Story = { render: () => <div className='grid min-w-[760px] grid-cols-4 gap-3'><MetricCard label='Active experiments' value='12' change='+3 this week' icon={FlaskConical}/><MetricCard label='Linked samples' value='248' change='+18 this week' icon={TestTube2}/><MetricCard label='Datasets' value='43' change='2 need attention' trend='down' icon={Database}/><MetricCard label='Pending reviews' value='4' change='No change' trend='neutral' icon={ShieldCheck}/></div> }
