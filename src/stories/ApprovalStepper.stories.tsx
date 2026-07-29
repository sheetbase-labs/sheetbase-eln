import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ApprovalStepper } from '#/components/audit/approval-stepper'
const steps = [
  { id: 'author', title: 'Author sign-off', role: 'Study owner' },
  { id: 'science', title: 'Scientific review', role: 'Principal scientist' },
  { id: 'quality', title: 'Quality approval', role: 'QA manager' },
]
const meta = {
  title: 'Audit/Approval stepper',
  component: ApprovalStepper,
  tags: ['autodocs'],
  args: {
    steps,
    reviewState: {
      author: {
        state: 'completed',
        actor: { name: 'Ava Chen' },
        at: '29 Jul 10:22',
      },
      science: { state: 'active', actor: { name: 'Dr. Liu' } },
    },
  },
} satisfies Meta<typeof ApprovalStepper>
export default meta
type Story = StoryObj<typeof meta>
export const InProgress: Story = {}
export const Approved: Story = {
  args: {
    reviewState: Object.fromEntries(
      steps.map((s) => [
        s.id,
        { state: 'completed', actor: { name: 'Reviewer' }, at: '29 Jul' },
      ]),
    ),
  },
}
export const Rejected: Story = {
  args: {
    reviewState: {
      author: { state: 'completed' },
      science: {
        state: 'rejected',
        actor: { name: 'Dr. Liu' },
        at: '29 Jul 14:31',
      },
      quality: { state: 'unavailable' },
    },
  },
}
export const Returned: Story = {
  args: {
    reviewState: {
      author: { state: 'completed' },
      science: { state: 'returned', actor: { name: 'Dr. Liu' } },
    },
  },
}
