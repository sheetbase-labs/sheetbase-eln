import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Separator } from '#/components/ui/separator'

const meta = {
  title: 'UI/Separator',
  component: Separator,
  tags: ['autodocs'],
} satisfies Meta<typeof Separator>
export default meta
type Story = StoryObj<typeof meta>
export const Horizontal: Story = {
  render: () => (
    <div className="w-80">
      <strong>Experiment</strong>
      <Separator className="my-3" />
      <p className="text-sm text-muted-foreground">
        Supporting metadata and results.
      </p>
    </div>
  ),
}
export const Vertical: Story = {
  render: () => (
    <div className="flex h-6 items-center gap-3">
      <span>Overview</span>
      <Separator orientation="vertical" />
      <span>Methods</span>
      <Separator orientation="vertical" />
      <span>Results</span>
    </div>
  ),
}
