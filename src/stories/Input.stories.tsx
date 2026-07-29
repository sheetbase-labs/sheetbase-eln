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
    <div className="grid max-w-sm gap-5">
      <div className="grid gap-1.5">
        <label htmlFor="disabled-input" className="text-sm font-medium">
          Disabled
        </label>
        <Input id="disabled-input" disabled value="Unavailable value" readOnly />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="invalid-input" className="text-sm font-medium">
          Invalid
        </label>
        <Input
          id="invalid-input"
          aria-invalid="true"
          aria-describedby="invalid-input-error"
          value="Invalid value"
          readOnly
        />
        <p id="invalid-input-error" className="text-sm text-destructive">
          Enter a valid value.
        </p>
      </div>
    </div>
  ),
}
