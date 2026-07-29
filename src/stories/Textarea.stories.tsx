import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Textarea } from '#/components/ui/textarea'

const meta = {
  title: 'UI/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  args: { placeholder: 'Record your observations…', className: 'max-w-md' },
} satisfies Meta<typeof Textarea>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const States: Story = {
  render: () => (
    <div className="grid max-w-md gap-3">
      <Textarea disabled value="This field is disabled." readOnly />
      <Textarea aria-invalid="true" value="Invalid observation" readOnly />
    </div>
  ),
}
