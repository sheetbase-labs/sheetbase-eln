import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Skeleton } from '#/components/ui/skeleton'

const meta = {
  title: 'UI/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
} satisfies Meta<typeof Skeleton>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = { args: { className: 'h-5 w-64' } }
export const Card: Story = {
  render: () => (
    <div className="flex w-80 gap-3 rounded-lg border p-4">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  ),
}
