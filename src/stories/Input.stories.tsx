import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Input } from '#/components/ui/input'

const meta = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
  args: { placeholder: 'Enter a value…', className: 'max-w-sm' },
} satisfies Meta<typeof Input>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Types: Story = {
  render: () => (
    <div className="grid max-w-sm gap-3">
      <Input type="email" placeholder="scientist@example.com" />
      <Input type="number" placeholder="Volume" />
      <Input type="file" />
    </div>
  ),
}
export const States: Story = {
  render: () => (
    <div className="grid max-w-sm gap-3">
      <Input disabled value="Disabled" readOnly />
      <Input aria-invalid="true" value="Invalid value" readOnly />
    </div>
  ),
}
