import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Spinner } from '#/components/ui/spinner'

const meta = {
  title: 'UI/Spinner',
  component: Spinner,
  tags: ['autodocs'],
} satisfies Meta<typeof Spinner>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-5">
      <Spinner className="size-3" />
      <Spinner className="size-5" />
      <Spinner className="size-8" />
    </div>
  ),
}
export const WithLabel: Story = {
  render: () => (
    <div className="flex items-center gap-2 text-sm">
      <Spinner />
      Loading results…
    </div>
  ),
}
