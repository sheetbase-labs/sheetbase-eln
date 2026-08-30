import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { SampleDataTable } from '#/components/sheetbase/data-table'

const meta = { title: 'Scientific/Data table', component: SampleDataTable, tags: ['autodocs'], parameters: { layout: 'padded' } } satisfies Meta<typeof SampleDataTable>
export default meta
type Story = StoryObj<typeof meta>
export const Samples: Story = { render: () => <div className='min-w-[900px]'><SampleDataTable/></div> }
