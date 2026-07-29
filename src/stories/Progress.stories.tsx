import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Progress } from '#/components/ui/progress'

const meta = {
  title: 'UI/Progress',
  component: Progress,
  tags: ['autodocs'],
  args: { value: 45, className: 'w-96' },
} satisfies Meta<typeof Progress>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Values: Story = {
  render: () => (
    <div className="grid w-96 gap-4">
      <Progress value={0} />
      <Progress value={25} />
      <Progress value={75} />
      <Progress value={100} />
    </div>
  ),
}
