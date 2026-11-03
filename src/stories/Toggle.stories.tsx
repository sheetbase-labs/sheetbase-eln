import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Icon } from '#/components/icons'
import { Toggle } from '#/components/ui/toggle'

const meta = {
  title: 'UI/Toggle',
  component: Toggle,
  tags: ['autodocs'],
} satisfies Meta<typeof Toggle>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <Toggle aria-label="Toggle bold">
      <Icon name="bold" />
    </Toggle>
  ),
}
export const Pressed: Story = {
  render: () => (
    <Toggle defaultPressed variant="outline" aria-label="Toggle italic">
      <Icon name="italic" />
      Italic
    </Toggle>
  ),
}
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Toggle size="sm">Small</Toggle>
      <Toggle>Default</Toggle>
      <Toggle size="lg">Large</Toggle>
    </div>
  ),
}
