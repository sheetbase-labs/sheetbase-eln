import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Kbd } from '#/components/ui/kbd'

const meta = {
  title: 'UI/Kbd',
  component: Kbd,
  tags: ['autodocs'],
  args: { children: 'K' },
} satisfies Meta<typeof Kbd>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Shortcut: Story = {
  render: () => (
    <span className="flex items-center gap-1">
      <Kbd>⌘</Kbd>
      <Kbd>Shift</Kbd>
      <Kbd>P</Kbd>
    </span>
  ),
}
