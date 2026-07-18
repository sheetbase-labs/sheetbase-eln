import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ChartFrame } from '#/components/sheetbase/chart-frame'
import { SampleChart } from '#/components/sheetbase/sample-chart'

const meta = { title: 'Scientific/Chart frame', component: ChartFrame, tags: ['autodocs'], parameters: { layout: 'padded' } } satisfies Meta<typeof ChartFrame>
export default meta
type Story = StoryObj<typeof meta>
export const LineChart: Story = { render: () => <div className='w-[760px]'><ChartFrame title='Vector genome copies over time' subtitle='Mean ± SD · Log Y'><SampleChart/></ChartFrame></div> }
