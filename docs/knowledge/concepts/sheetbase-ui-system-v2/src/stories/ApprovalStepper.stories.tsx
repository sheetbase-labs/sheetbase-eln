import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ApprovalStepper } from '#/components/sheetbase/approval-stepper'

const meta = { title: 'Scientific/Approval stepper', component: ApprovalStepper, tags: ['autodocs'] } satisfies Meta<typeof ApprovalStepper>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = { render: () => <div className='w-[360px] rounded-lg border p-5'><ApprovalStepper/></div> }
